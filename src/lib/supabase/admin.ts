// src/lib/supabase/admin.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertServerOnly } from "@/lib/serverOnly";

assertServerOnly();

/**
 * We intentionally type Database as `any` until you generate Supabase types.
 * This removes the ts(2339)/ts(2345) "never" explosions across routes.
 *
 * Later: swap `any` for generated `Database` type.
 */
export type Database = any;

function first(...vals: Array<string | undefined>) {
  return vals.find((v) => typeof v === "string" && v.length > 0) || "";
}

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

let _admin: SupabaseClient<Database> | null = null;

export function supabaseAdmin(): SupabaseClient<Database> {
  if (_admin) return _admin;

  const url = first(
    process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL
  ) || need("SUPABASE_URL");

  const service = first(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_KEY,
    process.env.SUPABASE_SERVICE_ROLE
  );

  if (!service) {
    throw new Error(
      "Missing env: SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE)"
    );
  }

  _admin = createClient<Database>(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _admin;
}
