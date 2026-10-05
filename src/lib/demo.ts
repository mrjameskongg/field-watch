// Public demo account for judges/reviewers. It is locked read-only at the
// database layer by RESTRICTIVE row-security policies (see
// supabase/migrations/20260831190000_demo_readonly.sql). Sign-in goes through
// the demo-login edge function, so no password is shipped to the browser.
export const DEMO_EMAIL = "demo@fieldwatch.live";

export function isDemoEmail(email: string | null | undefined): boolean {
  return (email ?? "").toLowerCase() === DEMO_EMAIL;
}
