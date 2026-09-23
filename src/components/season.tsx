// Season card + dialogs + ledger for a parcel (Stage 3, crop cycles spec).
// The card is "stats first": active-season header, three stat tiles, the last
// few events, and Start/Log/Close actions. The ledger is the full dated event
// table an auditor is shown.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n, type I18nKey } from "@/lib/i18n";
import { ok } from "@/lib/supabase-helpers";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Bug,
  CalendarDays,
  Droplets,
  Leaf,
  NotebookPen,
  Plus,
  Sprout,
  Wheat,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import {
  KG_PER_BAG,
  bagsToKg,
  canCloseSeason,
  canLogEvent,
  daysInSeason,
  drySpellCount,
  eventFields,
  eventSummary,
  fertiliserTotalKg,
  offerPlanting,
  seasonProgress,
  suggestSeasonLabel,
  type EventType,
} from "@/lib/season-core";

type Cycle = Database["public"]["Tables"]["crop_cycles"]["Row"];
type FieldEvent = Database["public"]["Tables"]["field_events"]["Row"];
type CropType = Database["public"]["Enums"]["crop_type"];

const CROP_TYPES: CropType[] = ["rice", "cassava", "corn", "sugarcane", "rubber", "pepper", "vegetable", "fruit", "other"];

const EVENT_ICONS: Record<string, typeof Droplets> = {
  water: Droplets,
  fertiliser: Leaf,
  pesticide: Bug,
  planting: Sprout,
  other: NotebookPen,
};

const today = () => new Date().toISOString().slice(0, 10);

function EventIcon({ type, className }: { type: string; className?: string }) {
  const Icon = EVENT_ICONS[type] ?? NotebookPen;
  return <Icon className={className ?? "h-4 w-4"} />;
}

/* ------------------------------------------------------------------ */
/* Season card                                                         */
/* ------------------------------------------------------------------ */

export function SeasonCard({
  farmId,
  farmCropType,
  onChanged,
}: {
  farmId: string;
  farmCropType: CropType | null;
  /** Fires after any successful mutation so siblings (the ledger tab) can refetch. */
  onChanged?: () => void;
}) {
  const { user, hasAnyRole } = useAuth();
  const { t } = useI18n();
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [events, setEvents] = useState<FieldEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const active = cycles.find((c) => c.status === "active") ?? null;
  const past = cycles.filter((c) => c.status !== "active");

  const reload = useCallback(async () => {
    const { data: cycleRows, error } = await supabase
      .from("crop_cycles")
      .select("*")
      .eq("farm_id", farmId)
      .order("planting_date", { ascending: false });
    // Even on error, land on the empty state — an eternal "Loading…" hides the toast's story.
    setLoaded(true);
    if (!ok(error, "Load seasons")) return;
    setCycles(cycleRows ?? []);
    const act = (cycleRows ?? []).find((c) => c.status === "active");
    if (act) {
      const { data: eventRows, error: evErr } = await supabase
        .from("field_events")
        .select("*")
        .eq("cycle_id", act.id)
        .order("event_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (!ok(evErr, "Load season events")) return;
      setEvents(eventRows ?? []);
    } else {
      setEvents([]);
    }
  }, [farmId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const stats = useMemo(() => {
    if (!active) return null;
    return {
      days: daysInSeason(active, today()),
      drySpells: drySpellCount(events),
      fertKg: fertiliserTotalKg(events),
      progress: seasonProgress(active, today()),
    };
  }, [active, events]);

  const changed = useCallback(() => {
    reload();
    onChanged?.();
  }, [reload, onChanged]);

  const reopen = async (cycle: Cycle) => {
    const { error } = await supabase.from("crop_cycles").update({ status: "active" }).eq("id", cycle.id);
    if (!ok(error, "Reopen season")) return;
    toast.success(`${cycle.season_label} reopened`);
    changed();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{t("season.title")}</CardTitle>
          {active && (
            <>
              <span className="text-sm font-medium">{active.season_label}</span>
              <Badge className="bg-chart-2/15 text-chart-2 hover:bg-chart-2/15">{t("season.active")}</Badge>
              {active.seed_variety && (
                <span className="text-xs text-muted-foreground">{active.seed_variety}</span>
              )}
              <span className="text-xs text-muted-foreground">
                {t("season.planted")} {active.planting_date}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" onClick={() => setLogOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  {t("season.logEvent")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setCloseOpen(true)}>
                  {t("season.closeSeason")}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!loaded ? (
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : active && stats ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: t("season.daysInSeason"), value: stats.days, icon: CalendarDays },
                { label: t("season.drySpells"), value: stats.drySpells, icon: Droplets },
                { label: t("season.fertKg"), value: stats.fertKg, icon: Leaf },
              ].map((t) => (
                <div key={t.label} className="rounded-lg border bg-muted/30 p-3">
                  <t.icon className="h-4 w-4 text-muted-foreground" />
                  <div className="mt-1 text-xl font-bold leading-none">{t.value}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{t.label}</div>
                </div>
              ))}
            </div>

            {stats.progress != null && (
              <div className="space-y-1">
                <Progress value={stats.progress * 100} className="h-1.5" />
                <p className="text-xs text-muted-foreground">
                  {Math.round(stats.progress * 100)}% {t("season.progressTo")} ({active.expected_harvest_date})
                </p>
              </div>
            )}

            {events.length > 0 ? (
              <div className="space-y-1.5">
                {events.slice(0, 3).map((e) => (
                  <div key={e.id} className="flex items-center gap-2 text-sm">
                    <EventIcon type={e.event_type} className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">{e.event_date}</span>
                    <span className="truncate">{eventSummary(e)}</span>
                  </div>
                ))}
                {events.length > 3 && (
                  <p className="text-xs text-muted-foreground">
                    + {events.length - 3} {t("season.moreInTab")}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("season.nothingLogged")}
              </p>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {t("season.noActive")}
              </p>
              <Button size="sm" onClick={() => setStartOpen(true)}>
                <Sprout className="h-4 w-4 mr-1" />
                {t("season.startSeason")}
              </Button>
            </div>
          </div>
        )}

        {past.length > 0 && (
          <div className="border-t pt-3 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("season.pastSeasons")}</p>
            {past.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <Wheat className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium">{c.season_label}</span>
                {c.seed_variety && <span className="text-xs text-muted-foreground">{c.seed_variety}</span>}
                <span className="text-xs text-muted-foreground">
                  {c.planting_date} → {c.harvest_date ?? "—"}
                </span>
                <span className="ml-auto tabular-nums">
                  {c.yield_kg != null ? `${c.yield_kg.toLocaleString()} kg` : "—"}
                </span>
                {hasAnyRole(["admin", "manager"]) && !active && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => reopen(c)}>
                    {t("season.reopen")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <StartSeasonDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        farmId={farmId}
        farmCropType={farmCropType}
        userId={user?.id ?? null}
        onDone={changed}
      />
      {active && (
        <>
          <LogEventDialog
            open={logOpen}
            onOpenChange={setLogOpen}
            cycle={active}
            events={events}
            userId={user?.id ?? null}
            onDone={changed}
          />
          <CloseSeasonDialog
            open={closeOpen}
            onOpenChange={setCloseOpen}
            cycle={active}
            onDone={changed}
          />
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Start season                                                        */
/* ------------------------------------------------------------------ */

function StartSeasonDialog({
  open,
  onOpenChange,
  farmId,
  farmCropType,
  userId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  farmId: string;
  farmCropType: CropType | null;
  userId: string | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [plantingDate, setPlantingDate] = useState(today());
  const [label, setLabel] = useState(suggestSeasonLabel(today()));
  const [labelTouched, setLabelTouched] = useState(false);
  const [crop, setCrop] = useState<CropType>(farmCropType ?? "rice");
  const [variety, setVariety] = useState("");
  const [expected, setExpected] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const d = today();
      setPlantingDate(d);
      setLabel(suggestSeasonLabel(d));
      setLabelTouched(false);
      setCrop(farmCropType ?? "rice");
      setVariety("");
      setExpected("");
    }
  }, [open, farmCropType]);

  const onDateChange = (d: string) => {
    setPlantingDate(d);
    if (!labelTouched && d) setLabel(suggestSeasonLabel(d));
  };

  const save = async () => {
    if (!plantingDate || !label.trim()) {
      toast.error("Planting date and season label are required.");
      return;
    }
    setSaving(true);
    const { data: cycle, error } = await supabase
      .from("crop_cycles")
      .insert({
        farm_id: farmId,
        season_label: label.trim(),
        crop_type: crop,
        seed_variety: variety.trim() || null,
        planting_date: plantingDate,
        expected_harvest_date: expected || null,
      })
      .select()
      .single();
    setSaving(false);
    if (!ok(error, "Start season") || !cycle) return;
    // The planting itself is the season's first dated event.
    const { error: evErr } = await supabase.from("field_events").insert({
      cycle_id: cycle.id,
      farm_id: farmId,
      event_type: "planting",
      event_date: plantingDate,
      note: variety.trim() ? `Variety: ${variety.trim()}` : null,
      recorded_by: userId,
    });
    ok(evErr, "Record planting event");
    toast.success(`${label.trim()} started`);
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("season.startSeason")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("season.plantingDate")} *</Label>
              <Input type="date" value={plantingDate} onChange={(e) => onDateChange(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("season.seasonLabel")} *</Label>
              <Input
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                  setLabelTouched(true);
                }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("season.crop")}</Label>
              <Select value={crop} onValueChange={(v) => setCrop(v as CropType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CROP_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("season.seedVariety")}</Label>
              <Input placeholder="e.g. Sen Kra Ob" value={variety} onChange={(e) => setVariety(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("season.expectedHarvest")}</Label>
            <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("season.expectedHint")}</p>
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? t("season.saving") : t("season.startSeason")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Log event — type first, then a tiny form                            */
/* ------------------------------------------------------------------ */

function LogEventDialog({
  open,
  onOpenChange,
  cycle,
  events,
  userId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cycle: Cycle;
  events: FieldEvent[];
  userId: string | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<EventType | null>(null);
  const [date, setDate] = useState(today());
  const [waterState, setWaterState] = useState<"flooded" | "drained">("flooded");
  const [depth, setDepth] = useState("");
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("kg");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setType(null);
      setDate(today());
      setWaterState("flooded");
      setDepth("");
      setProduct("");
      setQuantity("");
      setUnit("kg");
      setNote("");
    }
  }, [open]);

  const typeButtons: { key: EventType; label: string }[] = [
    { key: "water", label: t("season.type.water") },
    { key: "fertiliser", label: t("season.type.fertiliser") },
    { key: "pesticide", label: t("season.type.pesticide") },
    { key: "other", label: t("season.type.other") },
    ...(offerPlanting(events) ? [{ key: "planting" as const, label: t("season.type.planting") }] : []),
  ];

  const save = async () => {
    if (!type) return;
    if (!canLogEvent(cycle)) {
      toast.error("This season is closed — reopen it before logging events.");
      return;
    }
    if (!date) {
      toast.error("Date is required.");
      return;
    }
    const fields = eventFields(type);
    if (fields.product && !product.trim() && !quantity) {
      toast.error("Record at least the product or the quantity.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("field_events").insert({
      cycle_id: cycle.id,
      farm_id: cycle.farm_id,
      event_type: type,
      event_date: date,
      product: fields.product && product.trim() ? product.trim() : null,
      quantity: fields.product && quantity ? parseFloat(quantity) : null,
      unit: fields.product && quantity ? unit : null,
      water_state: fields.water ? waterState : null,
      water_depth_cm: fields.water && depth ? parseFloat(depth) : null,
      note: note.trim() || null,
      recorded_by: userId,
    });
    setSaving(false);
    if (!ok(error, "Log event")) return;
    toast.success("Event logged");
    onOpenChange(false);
    onDone();
  };

  const fields = type ? eventFields(type) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{type ? `${t("season.logEvent")}: ${typeButtons.find((b) => b.key === type)?.label ?? type}` : t("season.whatHappened")}</DialogTitle>
        </DialogHeader>

        {!type ? (
          <div className="grid grid-cols-2 gap-3 py-2">
            {typeButtons.map((t) => (
              <button
                key={t.key}
                onClick={() => setType(t.key)}
                className="flex flex-col items-center gap-2 rounded-lg border p-4 hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <EventIcon type={t.key} className="h-6 w-6 text-primary" />
                <span className="text-sm font-medium">{t.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            {fields?.water && (
              <div className="space-y-1">
                <Label>{t("season.fieldState")} *</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["flooded", "drained"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setWaterState(s)}
                      className={`rounded-md border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                        waterState === s ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                      }`}
                    >
                      {t(s === "flooded" ? "season.flooded" : "season.drained")}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {fields?.product && (
              <>
                <div className="space-y-1">
                  <Label>{t("season.product")}</Label>
                  <Input
                    placeholder={type === "fertiliser" ? "e.g. Urea 46-0-0" : "e.g. product name"}
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>{t("season.quantity")}</Label>
                    <Input type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("season.unit")}</Label>
                    <Select value={unit} onValueChange={setUnit}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="kg">kg</SelectItem>
                        <SelectItem value="L">L</SelectItem>
                        <SelectItem value="bags">bags ({KG_PER_BAG} kg)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t("season.date")} *</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              {fields?.water && (
                <div className="space-y-1">
                  <Label>{t("season.tubeReading")}</Label>
                  <Input
                    type="number"
                    placeholder="below surface"
                    value={depth}
                    onChange={(e) => setDepth(e.target.value)}
                  />
                </div>
              )}
            </div>
            {fields?.water && (
              <p className="text-xs text-muted-foreground -mt-2">
                {t("season.tubeHint")}
              </p>
            )}

            <div className="space-y-1">
              <Label>{t("season.note")}</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setType(null)}>
                {t("season.back")}
              </Button>
              <Button className="flex-1" onClick={save} disabled={saving}>
                {saving ? t("season.saving") : t("season.saveEvent")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Close season                                                        */
/* ------------------------------------------------------------------ */

function CloseSeasonDialog({
  open,
  onOpenChange,
  cycle,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cycle: Cycle;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [harvestDate, setHarvestDate] = useState(today());
  const [yieldStr, setYieldStr] = useState("");
  const [yieldUnit, setYieldUnit] = useState<"kg" | "bags">("kg");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setHarvestDate(today());
      setYieldStr("");
      setYieldUnit("kg");
      setNote("");
    }
  }, [open]);

  const save = async () => {
    const raw = yieldStr ? parseFloat(yieldStr) : null;
    const gate = canCloseSeason({ harvestDate, yieldValue: raw });
    if (!gate.ok) {
      toast.error(gate.reason);
      return;
    }
    const yieldKg = yieldUnit === "bags" ? bagsToKg(raw as number) : (raw as number);
    setSaving(true);
    const { error } = await supabase
      .from("crop_cycles")
      .update({
        status: "closed",
        harvest_date: harvestDate,
        yield_kg: yieldKg,
        notes: note.trim() ? (cycle.notes ? `${cycle.notes}\n${note.trim()}` : note.trim()) : cycle.notes,
      })
      .eq("id", cycle.id);
    setSaving(false);
    if (!ok(error, "Close season")) return;
    toast.success(`${cycle.season_label} closed — ${yieldKg.toLocaleString()} kg`);
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("season.closeSeason")} — {cycle.season_label}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <p className="text-sm text-muted-foreground">
{t("season.closeWarning")}
          </p>
          <div className="space-y-1">
            <Label>{t("season.harvestDate")} *</Label>
            <Input type="date" value={harvestDate} onChange={(e) => setHarvestDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("season.yield")} *</Label>
              <Input type="number" min="0" value={yieldStr} onChange={(e) => setYieldStr(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("season.unit")}</Label>
              <Select value={yieldUnit} onValueChange={(v) => setYieldUnit(v as "kg" | "bags")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">kg</SelectItem>
                  <SelectItem value="bags">bags ({KG_PER_BAG} kg/bag)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {yieldUnit === "bags" && yieldStr && (
            <p className="text-xs text-muted-foreground -mt-2">
              = {bagsToKg(parseFloat(yieldStr) || 0).toLocaleString()} kg at {KG_PER_BAG} kg per bag
            </p>
          )}
          <div className="space-y-1">
            <Label>{t("season.note")}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? t("season.saving") : t("season.closeSeason")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Season ledger (the parcel page's fourth tab)                        */
/* ------------------------------------------------------------------ */

export function SeasonLedger({ farmId }: { farmId: string }) {
  const { t } = useI18n();
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [events, setEvents] = useState<FieldEvent[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<"active" | "all">("active");

  useEffect(() => {
    async function load() {
      const [cyclesRes, eventsRes, profilesRes] = await Promise.all([
        supabase.from("crop_cycles").select("*").eq("farm_id", farmId).order("planting_date", { ascending: false }),
        supabase
          .from("field_events")
          .select("*")
          .eq("farm_id", farmId)
          .order("event_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("profiles").select("user_id, full_name"),
      ]);
      ok(cyclesRes.error, "Load seasons");
      ok(eventsRes.error, "Load events");
      setCycles(cyclesRes.data ?? []);
      setEvents(eventsRes.data ?? []);
      const map: Record<string, string> = {};
      (profilesRes.data ?? []).forEach((p) => {
        if (p.full_name) map[p.user_id] = p.full_name;
      });
      setNames(map);
    }
    load();
  }, [farmId]);

  const active = cycles.find((c) => c.status === "active") ?? null;
  const cycleLabel = useMemo(() => {
    const m: Record<string, string> = {};
    cycles.forEach((c) => {
      m[c.id] = c.season_label;
    });
    return m;
  }, [cycles]);

  const shown = scope === "active" && active ? events.filter((e) => e.cycle_id === active.id) : events;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{t("season.ledger")}</CardTitle>
          <div className="ml-auto flex gap-1">
            {(
              [
                { key: "active", label: active ? active.season_label : t("season.activeSeason") },
                { key: "all", label: t("season.allSeasons") },
              ] as const
            ).map((c) => (
              <button
                key={c.key}
                onClick={() => setScope(c.key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  scope === c.key ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("season.colDate")}</TableHead>
              <TableHead>{t("season.colType")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("season.colSeason")}</TableHead>
              <TableHead>{t("season.colDetail")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("season.colRecordedBy")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="tabular-nums whitespace-nowrap">{e.event_date}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 capitalize">
                    <EventIcon type={e.event_type} className="h-3.5 w-3.5 text-muted-foreground" />
                    {e.event_type}
                  </span>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-muted-foreground">
                  {cycleLabel[e.cycle_id] ?? "—"}
                </TableCell>
                <TableCell className="max-w-xs">
                  <span className="truncate block">{eventSummary(e)}</span>
                  {/* The summary already embeds the note for planting/other rows — only
                      show the secondary line when it adds something new. */}
                  {e.note && !eventSummary(e).includes(e.note) && (
                    <span className="text-xs text-muted-foreground truncate block">{e.note}</span>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">
                  {e.recorded_by ? (names[e.recorded_by] ?? "Staff") : "—"}
                </TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {active
                    ? t("season.emptyActive")
                    : t("season.emptyNone")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
