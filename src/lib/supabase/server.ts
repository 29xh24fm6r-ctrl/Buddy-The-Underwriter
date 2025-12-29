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

/**
 * Create Supabase server client with user-specific Buddy JWT.
 * 
 * This variant calls /api/auth/supabase-jwt internally to get a user-specific JWT,
 * making auth.uid() work in RLS for server-side Route Handlers.
 * 
 * Usage in Route Handlers that need RLS:
 *   import { createSupabaseServerClient } from "@/lib/supabase/server";
 *   const supabase = await createSupabaseServerClient();
 *   const { data } = await supabase.from("deals").select("*");
 * 
 * Note: For most server-side queries, use supabaseAdmin() instead (bypasses RLS).
 * Only use this when you specifically need RLS to apply.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Import cookies dynamically to avoid errors in non-Next.js contexts
  const { cookies } = await import("next/headers");
  
  // Call internal route to mint JWT using the user's Clerk session cookie
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const res = await fetch(`${appUrl}/api/auth/supabase-jwt`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });

  const { token } = (await res.json().catch(() => ({}))) as { token?: string };

  return createClient(url, anon, {
    auth: { persistSession: false },
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  });
}
