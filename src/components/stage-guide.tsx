// The operation guide: the farmer-chain visual language (numbered dots,
// check / dash / amber Next) applied to the WHOLE operation, with a link on
// the step that needs doing. Expanded while starting out; collapses to a
// one-line strip once the first settlement exists (localStorage remembers a
// manual override either way).

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, ChevronDown, ChevronRight, Minus } from "lucide-react";
import {
  collapsedByDefault,
  guideProgress,
  guideSteps,
  type GuideCounts,
  type GuideStep,
  type GuideStepKey,
} from "@/lib/onboarding-core";
import { useI18n, type I18nKey } from "@/lib/i18n";

const dotClass: Record<GuideStep["state"], string> = {
  done: "bg-primary text-primary-foreground",
  current: "bg-chart-4 text-white ring-4 ring-chart-4/20",
  pending: "bg-muted text-muted-foreground",
  skipped: "bg-muted text-muted-foreground",
};

const META: Record<GuideStepKey, { title: I18nKey; waiting: I18nKey; to: string }> = {
  farmers: { title: "guide.s.farmers", waiting: "guide.w.farmers", to: "/farmers" },
  parcels: { title: "guide.s.parcels", waiting: "guide.w.parcels", to: "/farms" },
  contract: { title: "guide.s.contract", waiting: "guide.w.contract", to: "/contracts" },
  inputs: { title: "guide.s.inputs", waiting: "guide.w.inputs", to: "/contracts" },
  delivery: { title: "guide.s.delivery", waiting: "guide.w.delivery", to: "/deliveries" },
  testedPaid: { title: "guide.s.testedPaid", waiting: "guide.w.testedPaid", to: "/deliveries" },
  batched: { title: "guide.s.batched", waiting: "guide.w.batched", to: "/batches" },
  milled: { title: "guide.s.milled", waiting: "guide.w.milled", to: "/batches" },
};

const STORE_KEY = "stage-guide-collapsed";

const storedCollapsed = (): boolean | null => {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
};

export function StageGuide({ counts }: { counts: GuideCounts }) {
  const { t } = useI18n();
  const [override, setOverride] = useState<boolean | null>(storedCollapsed);

  const steps = guideSteps(counts);
  const { done, total } = guideProgress(steps);
  const current = steps.find((s) => s.state === "current");
  const collapsed = override ?? collapsedByDefault(counts);

  // Nothing left to guide and the user hasn't pinned it open: disappear.
  if (!current && override !== false) return null;

  const setCollapsed = (v: boolean) => {
    setOverride(v);
    try {
      localStorage.setItem(STORE_KEY, v ? "1" : "0");
    } catch {
      /* private mode etc — the default still works */
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="w-full text-left rounded-lg border border-border bg-card px-4 py-2.5 flex items-center gap-3 hover:border-primary/50 transition-colors"
      >
        <span className="text-sm font-semibold tabular-nums">
          {done}/{total} {t("guide.ofSteps")}
        </span>
        {current && (
          <span className="text-sm text-muted-foreground truncate">
            {t("guide.next")}: {t(META[current.key].waiting)}
          </span>
        )}
        <ChevronDown className="h-4 w-4 ml-auto shrink-0 text-muted-foreground" />
      </button>
    );
  }

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">{t("guide.title")}</CardTitle>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="text-xs text-muted-foreground tabular-nums flex items-center gap-1 hover:text-foreground"
        >
          {done}/{total} {t("guide.ofSteps")}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </CardHeader>
      <CardContent>
        <ol>
          {steps.map((s, i) => (
            <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
              {i < steps.length - 1 && (
                <span
                  className={`absolute left-[13px] top-7 bottom-0 w-px ${
                    s.state === "done" || s.state === "skipped" ? "bg-primary/40" : "bg-border"
                  }`}
                />
              )}
              <span
                className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${dotClass[s.state]}`}
              >
                {s.state === "done" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : s.state === "skipped" ? (
                  <Minus className="h-3.5 w-3.5" />
                ) : (
                  i + 1
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-sm ${s.state === "pending" ? "text-muted-foreground" : "font-medium"}`}
                  >
                    {t(META[s.key].title)}
                  </span>
                  {s.state === "current" && (
                    <Badge variant="outline" className="border-chart-4 text-chart-4 font-normal">
                      {t("guide.next")}
                    </Badge>
                  )}
                </div>
                {s.state === "current" && (
                  <Link
                    to={META[s.key].to}
                    className="mt-0.5 inline-flex items-center gap-1 text-sm text-primary hover:underline font-medium"
                  >
                    {t(META[s.key].waiting)}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
