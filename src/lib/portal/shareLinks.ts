// src/lib/portal/shareLinks.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

function randomToken(len = 48) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function createShareLink(params: {
  dealId: string;
  createdBy?: string | null;
  checklistItemIds: string[];
  recipientName?: string | null;
  note?: string | null;
  expiresHours?: number; // default 168 (7 days)
}) {
  const sb = supabaseAdmin();
  const token = randomToken();
  const expiresHours = Math.max(1, Math.min(24 * 30, Number(params.expiresHours ?? 168)));
  const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000).toISOString();

  const { data, error } = await sb
    .from("deal_portal_share_links")
    .insert({
      deal_id: params.dealId,
      created_by: params.createdBy ?? null,
      scope: "checklist_items",
      checklist_item_ids: params.checklistItemIds,
      token,
      expires_at: expiresAt,
      revoked: false,
      recipient_name: params.recipientName ?? null,
      note: params.note ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getShareLinkByToken(token: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deal_portal_share_links")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export function isShareLinkValid(row: any) {
  if (!row) return { ok: false, reason: "not_found" };
  if (row.revoked) return { ok: false, reason: "revoked" };
  const exp = new Date(row.expires_at).getTime();
  if (Number.isFinite(exp) && Date.now() > exp) return { ok: false, reason: "expired" };
  if (row.scope !== "checklist_items") return { ok: false, reason: "bad_scope" };
  if (!Array.isArray(row.checklist_item_ids) || row.checklist_item_ids.length === 0) {
    return { ok: false, reason: "no_scope_items" };
  }
  return { ok: true as const };
}
