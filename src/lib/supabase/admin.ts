// src/lib/supabase/admin.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * We intentionally type Database as `any` until you generate Supabase types.
 * This removes the ts(2339)/ts(2345) "never" explosions across routes.
 *
 * Later: swap `any` for generated `Database` type.
 */
export type Database = any;

let _admin: SupabaseClient<Database> | null = null;

export function supabaseAdmin(): SupabaseClient<Database> {
  if (_admin) return _admin;

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url || !serviceKey) {
    throw new Error(
      "Missing Supabase admin credentials. Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  _admin = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _admin;
}
