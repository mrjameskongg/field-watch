// Public demo account for judges/reviewers. The credentials are deliberately
// public: the account is locked read-only at the database layer by RESTRICTIVE
// row-security policies (see supabase/migrations/20260831190000_demo_readonly.sql),
// so knowing them grants a guided look, not write access.
export const DEMO_EMAIL = "demo@fieldwatch.live";
export const DEMO_PASSWORD = "Firstwave2026";

export function isDemoEmail(email: string | null | undefined): boolean {
  return (email ?? "").toLowerCase() === DEMO_EMAIL;
}
