// src/lib/portal/ownerAuth.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function requireValidOwnerPortal(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || req.headers.get("x-owner-token");
  if (!token) throw new Error("Missing owner portal token.");

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deal_owner_portals")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Invalid owner portal link.");
  if (data.revoked) throw new Error("This link has been revoked.");
  if (Date.now() > new Date(data.expires_at).getTime()) throw new Error("This link has expired.");

  return { token, dealId: String(data.deal_id), ownerId: String(data.owner_id), portal: data };
}
