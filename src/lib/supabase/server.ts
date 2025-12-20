import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string, value: string | undefined) {
  if (!value || !String(value).trim()) {
    throw new Error(
      `Missing ${name}. Add it to your Codespaces env / .env.local and restart dev server.`
    );
  }
  return value;
}

/**
 * Server-side Supabase client.
 * Uses service role if available (preferred for server routes).
 * Falls back to anon key ONLY if service role is missing (dev convenience).
 *
 * IMPORTANT: In production you should ALWAYS set SUPABASE_SERVICE_ROLE_KEY.
 */
export function getSupabaseServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", url);

  const keyToUse = service?.trim() ? service : anon;

  if (!keyToUse || !keyToUse.trim()) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Set at least one (service role recommended) and restart dev server."
    );
  }

  return createClient(supabaseUrl, keyToUse, {
    auth: { persistSession: false },
    global: {
      headers: {
        "x-buddy-runtime": "server",
      },
    },
  });
}

/**
 * Async wrapper for server components (matches new Next.js patterns).
 * Returns a promise that resolves to the Supabase client.
 */
export async function supabaseServer(): Promise<SupabaseClient> {
  return getSupabaseServerClient();
}
