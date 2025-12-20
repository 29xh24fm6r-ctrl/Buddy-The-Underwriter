// src/lib/portal/checklist.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export type PortalChecklistItem = {
  id: string;
  deal_id: string;
  code: string;
  title: string;
  description: string | null;
  group_name: string;
  sort_order: number;
  required: boolean;
  match_hints: any[];
};

export type PortalChecklistStateRow = {
  deal_id: string;
  item_id: string;
  status: "missing" | "received" | "verified";
  completed_at: string | null;
  last_receipt_id: string | null;
  updated_at: string;
};

export async function ensureDefaultPortalStatus(dealId: string) {
  const sb = supabaseAdmin();
  await sb.from("deal_portal_status").upsert(
    { deal_id: dealId, stage: "Intake", eta_text: null, updated_at: new Date().toISOString() },
    { onConflict: "deal_id" }
  );
}

export async function listChecklist(dealId: string) {
  const sb = supabaseAdmin();

  const { data: items, error: iErr } = await sb
    .from("deal_portal_checklist_items")
    .select("*")
    .eq("deal_id", dealId)
    .order("group_name", { ascending: true })
    .order("sort_order", { ascending: true });

  if (iErr) throw iErr;

  const { data: state, error: sErr } = await sb
    .from("deal_portal_checklist_state")
    .select("*")
    .eq("deal_id", dealId);

  if (sErr) throw sErr;

  const stateByItem = new Map((state ?? []).map((r: any) => [r.item_id, r]));

  const merged = (items ?? []).map((it: any) => {
    const st = stateByItem.get(it.id) as PortalChecklistStateRow | undefined;
    return {
      item: it as PortalChecklistItem,
      state: st ?? { deal_id: dealId, item_id: it.id, status: "missing", completed_at: null, last_receipt_id: null, updated_at: new Date().toISOString() },
    };
  });

  return merged;
}

function normalizeText(s: string) {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function receiptMatchesHints(filename: string, hints: any[]): boolean {
  const f = normalizeText(filename);
  const hs = Array.isArray(hints) ? hints : [];
  for (const h of hs) {
    const t = normalizeText(String(h ?? ""));
    if (!t) continue;
    if (f.includes(t)) return true;
  }
  return false;
}

/**
 * Called after we record a document receipt.
 * Auto-mark checklist items as "received" when filename matches item hints.
 *
 * Canonical:
 * - server-side only
 * - borrower sees only borrower-safe state (received/missing) + friendly labels
 */
export async function applyReceiptToChecklist(params: {
  dealId: string;
  receiptId: string;
  filename: string;
}) {
  const sb = supabaseAdmin();

  const { data: items, error } = await sb
    .from("deal_portal_checklist_items")
    .select("id, match_hints")
    .eq("deal_id", params.dealId);

  if (error) throw error;

  const matches = (items ?? []).filter((it: any) => receiptMatchesHints(params.filename, it.match_hints));

  if (!matches.length) {
    return { updated: 0 };
  }

  // upsert state rows -> received
  const rows = matches.map((it: any) => ({
    deal_id: params.dealId,
    item_id: it.id,
    status: "received",
    completed_at: new Date().toISOString(),
    last_receipt_id: params.receiptId,
    updated_at: new Date().toISOString(),
  }));

  const { error: upErr } = await sb.from("deal_portal_checklist_state").upsert(rows, {
    onConflict: "deal_id,item_id",
  });

  if (upErr) throw upErr;

  return { updated: rows.length };
}
