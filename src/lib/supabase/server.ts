import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string, value: string | undefined) {
  if (!value || !String(value).trim()) {
    throw new Error(`Missing ${name}. Add it to the server environment and restart.`);
  }
  return value.trim();
}

/**
 * Privileged server-side Supabase client.
 *
 * This helper is service-role only and never falls back to the public anon
 * key. Callers must authenticate and authorize the request before using it
 * for user-driven work. Prefer supabaseAdmin() for new privileged code.
 */
export function getSupabaseServerClient(): SupabaseClient {
  const supabaseUrl = requireEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const serviceRoleKey = requireEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        "x-buddy-runtime": "server",
      },
    },
  });
}

/**
 * Legacy async alias for the privileged server client.
 *
 * It does not represent a user session. User-facing routes must use Clerk
 * authentication plus explicit authorization before querying through it.
 */
export async function supabaseServer(): Promise<SupabaseClient> {
  return getSupabaseServerClient();
}

/**
 * Create an RLS-scoped client using Buddy's Clerk-to-Supabase JWT exchange.
 * Fails closed if the authenticated token cannot be minted.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const url = requireEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const anon = requireEnv(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const appUrl = requireEnv(
    "NEXT_PUBLIC_APP_URL",
    process.env.NEXT_PUBLIC_APP_URL,
  );

  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();

  const response = await fetch(`${appUrl}/api/auth/supabase-jwt`, {
    headers: { cookie: cookieStore.toString() },
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as {
    token?: string;
    error?: string;
  };

  if (!response.ok || !payload.token) {
    throw new Error(
      `Supabase user token exchange failed: ${payload.error ?? response.status}`,
    );
  }

  return createClient(url, anon, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: { Authorization: `Bearer ${payload.token}` },
    },
  });
}
