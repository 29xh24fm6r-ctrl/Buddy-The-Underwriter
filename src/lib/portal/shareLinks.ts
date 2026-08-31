// src/lib/portal/shareLinks.ts
import { randomBytes } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_SCOPE_ITEMS = 100;

export type PortalShareLink = {
  id: string;
  deal_id: string;
  created_by: string | null;
  scope: "checklist_items";
  checklist_item_ids: string[];
  token: string;
  expires_at: string;
  revoked: boolean;
  recipient_name: string | null;
  note: string | null;
};

function boundedNullableText(value: unknown, max: number, field: string): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new Error(`invalid_share_${field}`);
  return normalized;
}

export function isValidShareTokenFormat(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

function cryptographicShareToken(): string {
  // 288 bits of CSPRNG entropy, encoded as exactly 48 URL-safe characters.
  return randomBytes(36).toString("base64url");
}

function normalizeChecklistItemIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SCOPE_ITEMS) {
    throw new Error("invalid_share_scope_items");
  }
  const ids = value.map((item) => String(item).trim().toLowerCase());
  if (ids.some((id) => !UUID_RE.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("invalid_share_scope_items");
  }
  return ids;
}

const SHARE_COLUMNS =
  "id, deal_id, created_by, scope, checklist_item_ids, token, expires_at, revoked, recipient_name, note";

export async function createShareLink(params: {
  dealId: string;
  createdBy?: string | null;
  checklistItemIds: string[];
  recipientName?: string | null;
  note?: string | null;
  expiresHours?: number;
}): Promise<PortalShareLink> {
  const dealId = String(params.dealId || "").trim().toLowerCase();
  if (!UUID_RE.test(dealId)) throw new Error("invalid_share_deal");

  const createdBy = boundedNullableText(params.createdBy, 128, "creator");
  const checklistItemIds = normalizeChecklistItemIds(params.checklistItemIds);
  const recipientName = boundedNullableText(params.recipientName, 128, "recipient");
  const note = boundedNullableText(params.note, 2_000, "note");
  const requestedHours = Number(params.expiresHours ?? 168);
  if (!Number.isSafeInteger(requestedHours) || requestedHours < 1 || requestedHours > 24 * 30) {
    throw new Error("invalid_share_expiry");
  }

  const token = cryptographicShareToken();
  const expiresAt = new Date(Date.now() + requestedHours * 3_600_000).toISOString();
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deal_portal_share_links")
    .insert({
      deal_id: dealId,
      created_by: createdBy,
      scope: "checklist_items",
      checklist_item_ids: checklistItemIds,
      token,
      expires_at: expiresAt,
      revoked: false,
      recipient_name: recipientName,
      note,
    })
    .select(SHARE_COLUMNS)
    .single();

  if (error || !data) throw new Error("share_create_failed");
  const row = data as PortalShareLink;
  const exactScope =
    Array.isArray(row.checklist_item_ids) &&
    row.checklist_item_ids.length === checklistItemIds.length &&
    row.checklist_item_ids.every((id, index) => String(id) === checklistItemIds[index]);
  if (
    String(row.deal_id) !== dealId ||
    row.token !== token ||
    row.scope !== "checklist_items" ||
    row.revoked !== false ||
    Date.parse(row.expires_at) !== Date.parse(expiresAt) ||
    !exactScope
  ) {
    throw new Error("share_create_unproven");
  }
  return row;
}

export async function getShareLinkByToken(token: string): Promise<PortalShareLink | null> {
  if (!isValidShareTokenFormat(token)) return null;
  const { data, error } = await supabaseAdmin()
    .from("deal_portal_share_links")
    .select(SHARE_COLUMNS)
    .eq("token", token)
    .maybeSingle();

  if (error) throw new Error("share_lookup_failed");
  return (data as PortalShareLink | null) ?? null;
}

export function isShareLinkValid(row: PortalShareLink | null) {
  if (!row) return { ok: false as const, reason: "not_found" };
  if (row.revoked !== false) return { ok: false as const, reason: "revoked" };
  const exp = Date.parse(row.expires_at);
  if (!Number.isFinite(exp)) return { ok: false as const, reason: "invalid_expiry" };
  if (Date.now() >= exp) return { ok: false as const, reason: "expired" };
  if (row.scope !== "checklist_items") return { ok: false as const, reason: "bad_scope" };
  try {
    normalizeChecklistItemIds(row.checklist_item_ids);
  } catch {
    return { ok: false as const, reason: "invalid_scope_items" };
  }
  if (!UUID_RE.test(String(row.deal_id))) return { ok: false as const, reason: "invalid_deal" };
  return { ok: true as const };
}
