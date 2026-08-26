/**
 * Fetch Buddy-signed Supabase JWT from token exchange endpoint.
 * 
 * This token makes auth.uid() match Buddy's current tenant RLS by setting sub = profiles.id; the legacy app_users identifier remains a separate JWT claim
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
