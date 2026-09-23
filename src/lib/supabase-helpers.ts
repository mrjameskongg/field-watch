import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Surface a Supabase error as a toast. Returns true when there was no error,
 * so callers can write: if (!ok(error, "Save farmer")) return;
 */
export function ok(error: { message: string } | null, action?: string) {
  if (error) {
    toast.error(action ? `${action} failed: ${error.message}` : error.message);
    return false;
  }
  return true;
}

export async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}
