/**
 * Auto-Apply Engine (Deterministic Action)
 * 
 * System suggests → Banker approves → System applies
 * 
 * Rule:
 * - Select pack with rank = 1 from borrower_pack_rankings
 * - Generate borrower_document_requests
 * - Log learning event
 * 
 * ✔ Explainable
 * ✔ Auditable
 * ✔ Reversible
 */

import { createServerClient } from "@/lib/supabase/server";
import { recordLearningEvent } from "./recordLearningEvent";
import { recordMatchEvent } from "./recordMatchEvent";

export type AutoApplyResult = {
  success: boolean;
  dealId: string;
  packId: string | null;
  packName: string | null;
  matchEventId: string | null;
  requestsCreated: number;
  error?: string;
};

/**
 * Auto-apply the top-ranked pack template to a deal
 */
export async function autoApplyTopRankedPack(
  dealId: string
): Promise<AutoApplyResult> {
  const sb = createServerClient();

  try {
    // 1. Get deal details
    const { data: deal, error: dealError } = await sb
      .from("deals")
      .select("id, bank_id, loan_type, loan_program, pack_template_id")
      .eq("id", dealId)
      .single();

    if (dealError || !deal) {
      return {
        success: false,
        dealId,
        packId: null,
        packName: null,
        matchEventId: null,
        requestsCreated: 0,
        error: dealError?.message || "Deal not found",
      };
    }

    // 2. Select rank = 1 pack from borrower_pack_rankings view
    const { data: topRanked, error: rankError } = await sb
      .from("borrower_pack_rankings")
      .select("pack_template_id, pack_name, rank, score, avg_blockers, sample_size")
      .eq("deal_id", dealId)
      .order("rank", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (rankError || !topRanked) {
      return {
        success: false,
        dealId,
        packId: null,
        packName: null,
        matchEventId: null,
        requestsCreated: 0,
        error: rankError?.message || "No ranked packs available",
      };
    }

    const packId = topRanked.pack_template_id;

    // 3. Record match event (auto-applied)
    const matchEventId = await recordMatchEvent(sb, {
      bankId: deal.bank_id,
      dealId: deal.id,
      packId,
      matchScore: topRanked.score || 0,
      autoApplied: true,
      suggested: false,
      manuallyApplied: false,
      metadata: {
        source: "ranked_engine",
        rank: topRanked.rank,
        avg_blockers: topRanked.avg_blockers,
        sample_size: topRanked.sample_size,
      },
    });

    // 4. Update deal with selected pack
    const { error: updateError } = await sb
      .from("deals")
      .update({ pack_template_id: packId })
      .eq("id", dealId);

    if (updateError) {
      throw new Error(`Failed to update deal: ${updateError.message}`);
    }

    // 5. Load pack items
    const { data: items, error: itemsError } = await sb
      .from("borrower_pack_template_items")
      .select("*")
      .eq("pack_id", packId)
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (itemsError) {
      throw new Error(`Failed to load pack items: ${itemsError.message}`);
    }

    // 6. Check for existing requests to avoid duplicates
    const { data: existingRequests } = await sb
      .from("borrower_document_requests")
      .select("pack_item_id, title")
      .eq("deal_id", dealId);

    const existingKeys = new Set(
      (existingRequests || []).map((r) => `${r.pack_item_id}::${r.title}`)
    );

    // 7. Generate borrower_document_requests
    const toInsert = (items || [])
      .filter((item) => !existingKeys.has(`${item.id}::${item.title}`))
      .map((item) => ({
        bank_id: deal.bank_id,
        deal_id: dealId,
        source: "pack",
        pack_id: packId,
        pack_item_id: item.id,
        title: item.title,
        category: item.category,
        description: item.description,
        doc_type: item.doc_type,
        year_mode: item.year_mode || "optional",
        required: item.required || false,
        sort_order: item.sort_order || 0,
        status: "requested",
        evidence: { applied_from_pack: true, auto_applied: true },
      }));

    let requestsCreated = 0;

    if (toInsert.length > 0) {
      const { error: insertError } = await sb
        .from("borrower_document_requests")
        .insert(toInsert);

      if (insertError) {
        throw new Error(`Failed to insert requests: ${insertError.message}`);
      }

      requestsCreated = toInsert.length;
    }

    // 8. Log learning event
    if (matchEventId) {
      await recordLearningEvent(sb, {
        bankId: deal.bank_id,
        matchEventId,
        eventType: "auto_applied",
        metadata: {
          source: "ranked_engine",
          requests_created: requestsCreated,
          pack_id: packId,
        },
      });
    }

    return {
      success: true,
      dealId,
      packId,
      packName: topRanked.pack_name,
      matchEventId,
      requestsCreated,
    };
  } catch (error) {
    console.error("Auto-apply pack error:", error);
    return {
      success: false,
      dealId,
      packId: null,
      packName: null,
      matchEventId: null,
      requestsCreated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
