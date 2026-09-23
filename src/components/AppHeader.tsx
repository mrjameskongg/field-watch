import { Bell, LogOut, User, Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { OfflineStatus, useServiceWorker } from "@/components/offline-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { isDemoEmail } from "@/lib/demo";
import { APP_ROLES, ROLE_LABELS, isAppRole } from "@/lib/roles-core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sanitizeSearch } from "@/lib/search-core";
import { useI18n } from "@/lib/i18n";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { currentSeasonLabel, useSatelliteFreshness } from "@/lib/freshness";
import { freshnessLabel } from "@/lib/dashboard-core";
import type { I18nKey } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Route prefix → page title. Longest prefix wins.
const TITLE_BY_PATH: [string, I18nKey][] = [
  ["/dashboard", "nav.dashboard"], ["/farmers", "nav.farmers"], ["/farms", "nav.farms"], ["/visits", "nav.visits"],
  ["/alerts", "nav.alerts"], ["/map", "nav.map"], ["/water", "nav.water"], ["/reports", "nav.reports"],
  ["/ask", "nav.ask"], ["/demo", "nav.demo"], ["/tour", "nav.tour"], ["/users", "nav.users"], ["/settings", "nav.settings"], ["/audit", "nav.audit"],
  ["/contracts", "nav.contracts"], ["/deliveries", "nav.deliveries"], ["/batches", "nav.batches"], ["/stock", "nav.stock"],
  ["/dispatches", "nav.dispatches"], ["/qc", "nav.quality"], ["/ranking", "nav.ranking"], ["/prices", "nav.prices"],
  ["/recall", "nav.recall"], ["/compliance", "nav.compliance"],
];

function titleKeyFor(pathname: string): I18nKey | null {
  let best: [string, I18nKey] | null = null;
  for (const entry of TITLE_BY_PATH) {
    if ((pathname === entry[0] || pathname.startsWith(entry[0] + "/")) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best ? best[1] : null;
}

export function AppHeader() {
  const { user, roles, logout, demoViewRole, switchDemoViewRole } = useAuth();
  const { lang, setLang, t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const fresh = useSatelliteFreshness();
  const today = new Date().toISOString().slice(0, 10);
  const titleKey = titleKeyFor(pathname);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .in("status", ["new", "investigating"])
      .then(({ count }) => setAlertCount(count ?? 0));
  }, []);

  useServiceWorker();

  const handleLogout = async () => {
    await logout();
    navigate({ to: "/login", search: { demo: undefined } });
  };

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-background px-3">
      <SidebarTrigger className="shrink-0" />
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="truncate text-[15px] font-medium">{titleKey ? t(titleKey) : "Field Watch"}</span>
        <span className="tag hidden shrink-0 whitespace-nowrap sm:inline-flex">{currentSeasonLabel()}</span>
      </div>
      <div className="num hidden shrink-0 items-center gap-3 whitespace-nowrap text-[11px] text-muted-foreground xl:flex" title="Latest satellite pass on file">
        <span><span className="text-[var(--signal-water)]">radar</span> {freshnessLabel(fresh.radar, today)}</span>
        <span><span className="text-primary">optical</span> {freshnessLabel(fresh.optical, today)}</span>
        <span><span className="text-[var(--signal-amber)]">fires</span> {freshnessLabel(fresh.fires, today)}</span>
      </div>
      {isDemoEmail(user?.email) && (
        <button
          type="button"
          className="shrink-0"
          onClick={() => navigate({ to: "/tour" })}
          title="Back to the guided tour"
        >
          <Badge variant="outline" className="cursor-pointer whitespace-nowrap border-amber-500 font-normal text-amber-600">
            Demo · read-only
          </Badge>
        </button>
      )}
      {isDemoEmail(user?.email) && (
        <div
          className="hidden shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground md:flex"
          title="Pick a staff role. The database then shows exactly what that role is allowed to see."
        >
          <span className="hidden xl:inline">View as</span>
          <Select value={demoViewRole} onValueChange={(v) => isAppRole(v) && switchDemoViewRole(v)}>
            <SelectTrigger className="h-7 w-[142px] text-[12px]" aria-label="View the demo as this role">
              {/* <small>, not <span>: the trigger styles every child span and would override xl:hidden */}
              <small className="mr-1 text-[12px] text-muted-foreground xl:hidden">As</small>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APP_ROLES.map((r) => (
                <SelectItem key={r} value={r} className="text-[12px]">
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="ml-auto hidden w-48 md:flex xl:w-64">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("nav.search")}
            className="h-8 pl-9 text-sm"
            onKeyDown={(e) => {
              // Sanitised before it ever reaches a PostgREST filter — raw
              // commas/parens in a query 400 the whole request (logic tree).
              const value = sanitizeSearch((e.target as HTMLInputElement).value);
              if (e.key === "Enter" && value) {
                navigate({ to: "/farms", search: { q: value } });
                (e.target as HTMLInputElement).value = "";
              }
            }}
          />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <OfflineStatus />
        <Button
          variant="ghost"
          size="sm"
          className="font-medium"
          onClick={() => setLang(lang === "en" ? "km" : "en")}
          aria-label="Switch language"
        >
          {lang === "en" ? "ខ្មែរ" : "EN"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => navigate({ to: "/alerts" })}
        >
          <Bell className="h-4 w-4" />
          {alertCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-[10px]">
              {alertCount}
            </Badge>
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <User className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <div className="text-sm">{user?.email}</div>
              <div className="text-xs text-muted-foreground capitalize">
                {roles[0] ? ROLE_LABELS[roles[0]] : isDemoEmail(user?.email) ? `Demo, viewing as ${ROLE_LABELS[demoViewRole]}` : "No role"}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              {t("nav.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
