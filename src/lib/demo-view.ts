// "View as" for the public demo account.
//
// The demo has no role of its own. It picks one here, and every database
// request carries it as the x-demo-role header; the database's role_allows()
// honours that header for the demo account only (see
// supabase/migrations/20260923140100_roles_audit.sql). So switching to
// Warehouse really does make settlements disappear at the database, not just
// in the menu. For any other account the header is ignored.

import { supabase } from "@/integrations/supabase/client";
import { isAppRole, type AppRole } from "./roles-core";

const KEY = "fieldwatch-demo-view-role";
export const DEMO_DEFAULT_ROLE: AppRole = "manager";

export function getDemoViewRole(): AppRole {
  try {
    const v = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    return isAppRole(v) ? v : DEMO_DEFAULT_ROLE;
  } catch {
    return DEMO_DEFAULT_ROLE;
  }
}

/** Stamp the chosen role on every PostgREST request from this browser. */
export function applyDemoViewHeader(role: AppRole): void {
  // `rest` is protected in the typings but is a plain PostgrestClient whose
  // headers are copied into every query it builds.
  const rest = (supabase as unknown as { rest?: { headers?: Headers } }).rest;
  rest?.headers?.set("x-demo-role", role);
}

export function setDemoViewRole(role: AppRole): void {
  try {
    localStorage.setItem(KEY, role);
  } catch {
    // Private mode: the header below still applies for this page load.
  }
  applyDemoViewHeader(role);
}
