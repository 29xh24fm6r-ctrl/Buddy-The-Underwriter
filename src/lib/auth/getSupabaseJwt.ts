/**
 * Fetch Buddy-signed Supabase JWT from token exchange endpoint.
 * 
 * This token makes auth.uid() work in Supabase RLS by setting sub = app_users.id
 * 
 * Used by browser Supabase client to automatically inject Authorization header.
 */
export async function getSupabaseJwt(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/supabase-jwt", {
      method: "GET",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { token?: string };
    return json.token ?? null;
  } catch {
    return null;
  }
}
