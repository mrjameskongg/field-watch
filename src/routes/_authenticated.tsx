import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { AuthProvider, useAuth } from "@/lib/auth";
import { canWrite } from "@/lib/roles-core";
import { supabase } from "@/integrations/supabase/client";
import { maybeAutoScan } from "@/lib/burn-scan";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/login", search: { demo: undefined } });
  },
  component: AuthenticatedLayout,
});

// Daily satellite burn check: runs quietly when someone opens the app. Only
// for accounts that may write alerts; for anyone else (the read-only demo,
// Warehouse, Quality) the insert would be refused and surface as an error.
function DailyBurnScan() {
  const { roles, isDemo } = useAuth();
  const allowed = !isDemo && canWrite(roles, "alerts");
  useEffect(() => {
    if (!allowed) return;
    maybeAutoScan().then((result) => {
      if (!result) return;
      if (result.error) {
        toast.error(`Burn scan failed: ${result.error}`);
      } else if (result.newAlerts > 0) {
        toast.warning(`Satellite scan: ${result.newAlerts} new possible burn(s) on BRM land — check Alerts.`);
      }
    });
  }, [allowed]);
  return null;
}

function AuthenticatedLayout() {
  return (
    <AuthProvider>
      <DailyBurnScan />
      <SidebarProvider>
        <div className="min-h-screen flex w-full">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <AppHeader />
            <main className="flex-1 overflow-auto p-4 md:p-6">
              <Outlet />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </AuthProvider>
  );
}

