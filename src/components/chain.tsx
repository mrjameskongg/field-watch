// The farmer chain, drawn as one numbered flow. Same shape everywhere it
// appears so the steps are learnable: 1..8 in process order, with the step
// that needs doing next called out.

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Minus } from "lucide-react";
import { chainProgress, type ChainStep } from "@/lib/chain-core";

const dotClass: Record<ChainStep["state"], string> = {
  done: "bg-primary text-primary-foreground",
  current: "bg-chart-4 text-white ring-4 ring-chart-4/20",
  pending: "bg-muted text-muted-foreground",
  skipped: "bg-muted text-muted-foreground",
};

export function ChainFlow({ steps, className }: { steps: ChainStep[]; className?: string }) {
  const { done, total } = chainProgress(steps);
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Farmer chain</CardTitle>
        <span className="text-xs text-muted-foreground tabular-nums">
          {done} of {total} steps
        </span>
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
                    {s.title}
                  </span>
                  {s.state === "current" && (
                    <Badge variant="outline" className="border-chart-4 text-chart-4 font-normal">
                      Next
                    </Badge>
                  )}
                  {s.date && <span className="text-xs text-muted-foreground tabular-nums">{s.date}</span>}
                </div>
                <p className={`text-xs ${s.state === "current" ? "text-chart-4" : "text-muted-foreground"}`}>
                  {s.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
