// src/lib/checklists/ownerAutoMatch.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

function normalize(s: string) {
  return (s || "").toLowerCase();
}

export async function applyOwnerReceiptAutoMatch(params: {
  dealId: string;
  ownerId: string;
  filename: string;
  receiptId: string;
}) {
  const sb = supabaseAdmin();

  const fn = normalize(params.filename);

  const { data: items, error } = await sb
    .from("deal_owner_checklist_items")
    .select("id, match_hints")
    .eq("owner_id", params.ownerId);

  if (error) throw error;

  const matches: string[] = [];

  for (const it of items ?? []) {
    const hints = Array.isArray(it.match_hints) ? it.match_hints : (it.match_hints ? JSON.parse(String(it.match_hints)) : []);
    const hit = (hints ?? []).some((h: any) => normalize(String(h)).length >= 3 && fn.includes(normalize(String(h))));
    if (hit) matches.push(String(it.id));
  }

  // If no hint match, do a basic heuristic:
  // - 1040 / tax => mark most recent tax item
  // - pfs => PFS
  // - guaranty => PERSONAL_GUARANTY
  if (!matches.length) {
    const { data: items2 } = await sb
      .from("deal_owner_checklist_items")
      .select("id, code")
      .eq("owner_id", params.ownerId);

    const byCode = new Map((items2 ?? []).map((x: any) => [String(x.code), String(x.id)]));

    if (fn.includes("pfs") || fn.includes("personal financial")) {
      const id = byCode.get("PFS");
      if (id) matches.push(id);
    }
    if (fn.includes("guaranty") || fn.includes("guarantee")) {
      const id = byCode.get("PERSONAL_GUARANTY");
      if (id) matches.push(id);
    }
    if (fn.includes("1040") || fn.includes("tax") || fn.includes("irs")) {
      // pick highest-year tax item by code sort (simple)
      const tax = (items2 ?? [])
        .filter((x: any) => String(x.code).startsWith("PERS_TAX_"))
        .map((x: any) => ({ id: String(x.id), code: String(x.code) }))
        .sort((a, b) => b.code.localeCompare(a.code))[0];
      if (tax?.id) matches.push(tax.id);
    }
  }

  // Apply state updates
  for (const itemId of matches) {
    await sb.from("deal_owner_checklist_state").upsert(
      {
        owner_id: params.ownerId,
        item_id: itemId,
        status: "received",
        completed_at: new Date().toISOString(),
        last_receipt_id: params.receiptId,
      },
      { onConflict: "owner_id,item_id" }
    );
  }

  return { matchedItemIds: matches };
}
