import { createClient } from "@supabase/supabase-js";
import { getSupabaseJwt } from "@/lib/auth/getSupabaseJwt";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Browser Supabase client with automatic Buddy JWT injection.
 * 
 * Every request automatically includes Authorization header with Buddy-signed JWT,
 * making auth.uid() work in RLS policies.
 * 
 * Usage:
 *   import { supabase } from "@/lib/supabase/browser";
 *   const { data } = await supabase.from("deals").select("*");
 * 
 * The JWT is fetched from /api/auth/supabase-jwt which:
 * 1. Verifies Clerk session
 * 2. Upserts app_users
 * 3. Signs JWT with sub = app_users.id
 * 
 * This makes RLS policies using auth.uid() work correctly.
 */
export const supabase = createClient(url, anon, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const token = await getSupabaseJwt();
      const headers = new Headers(init?.headers || {});
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },
  },
});

// Legacy export for compatibility
export function getSupabaseBrowserClient() {
  return supabase;
}
