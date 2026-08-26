import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Compatibility wrapper for legacy server storage call sites.
 *
 * This module is intentionally server-only and service-role only. It never
 * falls back to the anon key and must not be imported by client components.
 */
export function getSupabaseClient() {
  return supabaseAdmin();
}

export function getSupabaseStorageClient() {
  return supabaseAdmin().storage;
}
