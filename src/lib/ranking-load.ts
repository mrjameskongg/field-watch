// Whole-operation data behind the farmer ranking, shared by the ranking page
// and the farmer file (which shows "Rank N of M"). Each query is capped at
// 1000 rows, same scoped pattern as the farmers-list dots; move to a DB view
// past that scale.

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { ok } from "@/lib/supabase-helpers";
import type { RankInput } from "@/lib/ranking-core";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

export type RankingData = {
  farmers: Pick<Row<"farmers">, "id" | "full_name" | "farmer_code">[];
  farms: Pick<Row<"farms">, "farmer_id" | "latitude" | "boundary_geojson">[];
  contracts: Pick<Row<"contracts">, "id" | "farmer_id" | "status" | "expected_yield_kg" | "currency" | "season_closed" | "season_label">[];
  /** Open possible_burn alerts. */
  burnAlerts: Pick<Row<"alerts">, "farmer_id">[];
  deliveries: Pick<Row<"deliveries">, "id" | "contract_id" | "gross_weight_kg" | "moisture_flagged" | "price_per_kg_applied">[];
  qc: Pick<Row<"qc_tests">, "delivery_id" | "passed">[];
};

/** Loads everything the ranking needs; null (after a toast) if any query failed. */
export async function loadRankingData(): Promise<RankingData | null> {
  const [farmersRes, farmsRes, contractsRes, alertsRes] = await Promise.all([
    supabase.from("farmers").select("id, full_name, farmer_code").limit(1000),
    supabase.from("farms").select("farmer_id, latitude, boundary_geojson").limit(1000),
    supabase.from("contracts").select("id, farmer_id, status, expected_yield_kg, currency, season_closed, season_label").limit(1000),
    supabase
      .from("alerts")
      .select("farmer_id")
      .eq("alert_type", "possible_burn")
      .in("status", ["new", "investigating"])
      .limit(1000),
  ]);
  const contractIds = (contractsRes.data ?? []).map((c) => c.id);
  const deliveriesRes = contractIds.length
    ? await supabase
        .from("deliveries")
        .select("id, contract_id, gross_weight_kg, moisture_flagged, price_per_kg_applied")
        .in("contract_id", contractIds)
        .limit(1000)
    : { data: [], error: null };
  const deliveryIds = (deliveriesRes.data ?? []).map((d) => d.id);
  const qcRes = deliveryIds.length
    ? await supabase
        .from("qc_tests")
        .select("delivery_id, passed")
        .eq("test_type", "moisture")
        .in("delivery_id", deliveryIds)
        .limit(1000)
    : { data: [], error: null };

  const failed = [farmersRes, farmsRes, contractsRes, alertsRes, deliveriesRes, qcRes].find((r) => r.error);
  if (failed) {
    ok(failed.error, "Load ranking");
    return null;
  }
  return {
    farmers: farmersRes.data ?? [],
    farms: farmsRes.data ?? [],
    contracts: contractsRes.data ?? [],
    burnAlerts: alertsRes.data ?? [],
    deliveries: deliveriesRes.data ?? [],
    qc: qcRes.data ?? [],
  };
}

/** One RankInput per supplier for the open season. Pure. */
export function currentSeasonInputs(d: RankingData): RankInput[] {
  // A delivery may carry several moisture tests; count it passed if any passed.
  const testedByDelivery = new Map<string, boolean>();
  for (const q of d.qc) {
    if (!q.delivery_id) continue;
    testedByDelivery.set(q.delivery_id, (testedByDelivery.get(q.delivery_id) ?? false) || q.passed === true);
  }

  // The estate's own block is not a supplier — it never competes with contract farmers.
  const suppliers = d.farmers.filter((f) => f.farmer_code !== "FRM-BRM-OWN");
  return suppliers.map((f) => {
    const myContracts = d.contracts.filter((c) => c.farmer_id === f.id && c.status !== "cancelled" && !c.season_closed);
    const myContractIds = new Set(myContracts.map((c) => c.id));
    const myDeliveries = d.deliveries.filter((x) => myContractIds.has(x.contract_id));
    const tested = myDeliveries.filter((x) => testedByDelivery.has(x.id));
    return {
      farmerId: f.id,
      name: f.full_name,
      expectedKg: myContracts.reduce((s, c) => s + (c.expected_yield_kg ?? 0), 0),
      deliveredKg: myDeliveries.reduce((s, x) => s + x.gross_weight_kg, 0),
      totalLoads: myDeliveries.length,
      testedLoads: tested.length,
      passedLoads: tested.filter((x) => testedByDelivery.get(x.id)).length,
      wetLoads: myDeliveries.filter((x) => x.moisture_flagged).length,
      activeBurnAlerts: d.burnAlerts.filter((a) => a.farmer_id === f.id).length,
      mapped: d.farms.some((x) => x.farmer_id === f.id && (x.latitude !== null || x.boundary_geojson !== null)),
      hasLiveContract: myContracts.length > 0,
    };
  });
}
