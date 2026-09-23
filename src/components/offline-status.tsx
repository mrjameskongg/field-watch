// What a field officer sees about their own connection.
//
// The rule: never silently swallow anything. If a record is on the phone and
// not yet in the database, that is visible; if it cannot be sent, that is
// louder. Silence is reserved for the case where everything really is saved.

import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { useOffline } from "@/lib/offline";

/** Registers the service worker once, so the app opens without signal. */
export function useServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (import.meta.env.DEV) return; // dev server serves modules; caching them fights HMR
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* unsupported or blocked — the app still works, just not offline */
    });
  }, []);
}

export function OfflineStatus() {
  const { online, summary, syncNow, syncing } = useOffline();

  if (online && summary.waiting === 0 && summary.stuck === 0) return null;

  const tone = summary.stuck > 0 ? "destructive" : online ? "secondary" : "outline";

  return (
    <div className="flex items-center gap-2">
      <Badge
        variant={tone === "destructive" ? "destructive" : tone === "secondary" ? "secondary" : "outline"}
        className="font-normal gap-1"
      >
        {summary.stuck > 0 ? (
          <TriangleAlert className="h-3 w-3" />
        ) : !online ? (
          <CloudOff className="h-3 w-3" />
        ) : (
          <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
        )}
        <span className="hidden sm:inline">{summary.label}</span>
        <span className="sm:hidden">{summary.waiting + summary.stuck}</span>
      </Badge>
      {online && (summary.waiting > 0 || summary.stuck > 0) && (
        <Button variant="ghost" size="sm" onClick={syncNow} disabled={syncing}>
          {syncing ? "Sending..." : "Send now"}
        </Button>
      )}
    </div>
  );
}
