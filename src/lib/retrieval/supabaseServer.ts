import { createClient } from "@supabase/supabase-js";

/**
 * Supabase server client with service role key (bypasses RLS)
 * Server-side only - never expose service role key to client
 */
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server-only
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, { auth: { persistSession: false } });
}
