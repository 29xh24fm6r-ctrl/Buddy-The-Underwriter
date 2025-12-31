import { scorePackMatch } from "./matchPack";
import { recordMatchEvent } from "./recordMatchEvent";
import { fetchDealContext } from "@/lib/deals/fetchDealContext";

type SB = ReturnType<any>; // keep simple; supabase types vary per project

export type ApplyResult = {
  dealId: string;
  bankId: string;
  chosenPackId: string | null;
  matchEventId: string | null;
  createdRequests: number;
  existingRequests: number;
  createdFromInboxMatch?: number;
};

export async function applyBestPackToDeal(
  sb: any, 
  dealId: string,
  options?: { autoApplied?: boolean; manuallyApplied?: boolean }
): Promise<ApplyResult> {
  // Load deal via canonical context endpoint
  const context = await fetchDealContext(dealId);
  if (!context.ok) throw new Error(`Deal not found: ${context.error}`);
  
  const deal = {
    id: context.dealId,
    bank_id: context.deal.bank_id!,
    loan_type: null, // TODO: Add to /context if needed
    loan_program: null, // TODO: Add to /context if needed
    pack_template_id: null, // TODO: Add to /context if needed
  };

  // Load packs for bank
  const packsRes = await sb
    .from("borrower_pack_templates")
    .select("id, bank_id, name, loan_type, loan_program, active, sort_order")
    .eq("bank_id", deal.bank_id)
    .eq("active", true);

  if (packsRes.error) throw new Error(packsRes.error.message);
  const packs = (packsRes.data || []) as Array<{ id: string; loan_type: string; loan_program: string | null; sort_order: number }>;

  // Choose pack:
  // 1) deal.pack_template_id if present
  // 2) otherwise highest match score, tie-breaker sort_order asc
  let chosenPackId: string | null = deal.pack_template_id;

  if (!chosenPackId) {
    const scored = packs
      .map(p => ({ id: p.id, score: scorePackMatch({ loan_type: p.loan_type, loan_program: p.loan_program }, deal) , sort: p.sort_order }))
      .sort((a,b) => (b.score - a.score) || (a.sort - b.sort));

    chosenPackId = scored.length ? scored[0].id : null;
  }

  if (!chosenPackId) {
    // No packs available; still a valid outcome.
    return { dealId: deal.id, bankId: deal.bank_id, chosenPackId: null, matchEventId: null, createdRequests: 0, existingRequests: 0 };
  }

  // Persist chosen pack to deal
  const upd = await sb.from("deals").update({ pack_template_id: chosenPackId }).eq("id", dealId);
  if (upd.error) throw new Error(upd.error.message);

  // Load pack items
  const itemsRes = await sb
    .from("borrower_pack_template_items")
    .select("id, pack_id, title, category, description, doc_type, year_mode, required, sort_order, active")
    .eq("pack_id", chosenPackId)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (itemsRes.error) throw new Error(itemsRes.error.message);
  const items = (itemsRes.data || []) as Array<any>;

  // Determine which requests already exist (dedupe key = deal_id + pack_item_id + title)
  const existingRes = await sb
    .from("borrower_document_requests")
    .select("id, pack_item_id, title")
    .eq("deal_id", dealId);

  if (existingRes.error) throw new Error(existingRes.error.message);
  const existing = (existingRes.data || []) as Array<{ id: string; pack_item_id: string | null; title: string }>;

  const existingKey = new Set(existing.map(r => `${r.pack_item_id || "none"}::${r.title}`));

  const toInsert = items
    .filter(it => !existingKey.has(`${it.id}::${it.title}`))
    .map(it => ({
      bank_id: deal.bank_id,
      deal_id: dealId,
      source: "pack",
      pack_id: chosenPackId,
      pack_item_id: it.id,
      title: it.title,
      category: it.category,
      description: it.description,
      doc_type: it.doc_type,
      year_mode: it.year_mode ?? "optional",
      required: !!it.required,
      sort_order: it.sort_order ?? 0,
      status: "requested",
      evidence: { applied_from_pack: true }
    }));

  // ✅ CANONICAL RULE: Packs NEVER create invites
  // ✅ CANONICAL RULE: Packs ONLY create document requests
  // bank_id + deal_id are required everywhere

  let createdRequests = 0;
  let matchEventId: string | null = null;

  if (toInsert.length) {
    const ins = await sb.from("borrower_document_requests").insert(toInsert);
    if (ins.error) throw new Error(ins.error.message);
    createdRequests = toInsert.length;
  }

  // 🧠 Sprint Ω: Record match event for learning system
  try {
    const matchScore = packs.find(p => p.id === chosenPackId)
      ? scorePackMatch(
          packs.find(p => p.id === chosenPackId)!,
          deal
        )
      : 100;

    matchEventId = await recordMatchEvent(sb, {
      bankId: deal.bank_id,
      dealId,
      packId: chosenPackId,
      matchScore,
      autoApplied: options?.autoApplied || false,
      manuallyApplied: options?.manuallyApplied || false,
      metadata: {
        created_requests: createdRequests,
        existing_requests: existing.length,
      },
    });
  } catch (err) {
    console.error("Failed to record match event:", err);
    // Non-blocking - continue
  }

  return {
    dealId: deal.id,
    bankId: deal.bank_id,
    chosenPackId,
    matchEventId,
    createdRequests,
    existingRequests: existing.length
  };
}
