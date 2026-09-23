import { AlertTriangle } from "lucide-react";
import { ROW_CAP } from "@/lib/query-limits";

/**
 * Shown when a list hit its cap. The point is that the screen must never
 * present a truncated list as if it were the whole thing — narrow the filters
 * and the list becomes complete again.
 */
export function RowCapNotice({ show, noun }: { show: boolean; noun: string }) {
  if (!show) return null;
  return (
    <div className="flex items-start gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Showing the first {ROW_CAP.toLocaleString()} {noun}. There are more — search or filter to
        narrow this down, or the totals on this page will be short.
      </span>
    </div>
  );
}
