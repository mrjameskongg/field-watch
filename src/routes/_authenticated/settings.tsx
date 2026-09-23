import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ok } from "@/lib/supabase-helpers";
import type { Json } from "@/integrations/supabase/types";
import { resetFxCache } from "@/lib/fx";
import { DEFAULT_KHR_PER_USD } from "@/lib/money-core";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { hasRole } = useAuth();
  const [orgName, setOrgName] = useState("BRM Agro");
  const [saved, setSaved] = useState(false);
  const [khrPerUsd, setKhrPerUsd] = useState<number>(DEFAULT_KHR_PER_USD);
  const [fxSaved, setFxSaved] = useState(false);

  useEffect(() => {
    supabase.from("app_settings").select("*").eq("key", "org_name").single().then(({ data }) => {
      if (data?.value && typeof data.value === "object" && data.value !== null && "name" in data.value) {
        setOrgName(String((data.value as Record<string, unknown>).name || "BRM Agro"));
      }
    });
    supabase.from("app_settings").select("value").eq("key", "fx").maybeSingle().then(({ data }) => {
      const v = data?.value;
      if (v && typeof v === "object" && "khr_per_usd" in v) {
        const n = Number((v as { khr_per_usd: unknown }).khr_per_usd);
        if (Number.isFinite(n) && n > 0) setKhrPerUsd(n);
      }
    });
  }, []);

  const handleSaveFx = async () => {
    if (!Number.isFinite(khrPerUsd) || khrPerUsd <= 0) return;
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "fx", value: { khr_per_usd: khrPerUsd } as unknown as Json }, { onConflict: "key" });
    if (!ok(error, "Save exchange rate")) return;
    resetFxCache();
    setFxSaved(true);
    setTimeout(() => setFxSaved(false), 2000);
  };

  const handleSave = async () => {
    const { error } = await supabase.from("app_settings").upsert({ key: "org_name", value: { name: orgName } as unknown as Json });
    if (!ok(error, "Save settings")) return;
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!hasRole("admin")) {
    return <div className="text-muted-foreground">Admin access required.</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Organization</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Organization Name</Label>
            <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Logo</Label>
            <div className="h-20 w-20 rounded-lg border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">Logo</div>
          </div>
          <Button onClick={handleSave}>{saved ? "Saved ✓" : "Save Settings"}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Exchange rate</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Riel per US dollar (KHR / USD)</Label>
            <Input
              type="number"
              step="1"
              min="1"
              value={khrPerUsd}
              onChange={(e) => setKhrPerUsd(Number(e.target.value))}
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              Display only. KHR contracts are settled in riel; this rate draws the grey dollar equivalent beside them.
            </p>
          </div>
          <Button onClick={handleSaveFx}>{fxSaved ? "Saved ✓" : "Save rate"}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Default Options</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p><strong>Crop Types:</strong> rice, cassava, corn, sugarcane, rubber, pepper, vegetable, fruit, other</p>
          <p><strong>Farmer Status:</strong> active, inactive, suspended</p>
          <p><strong>Farm Status:</strong> active, inactive, fallow, harvested</p>
          <p><strong>Risk Levels:</strong> low, medium, high, critical</p>
        </CardContent>
      </Card>
    </div>
  );
}
