/**
 * Override Pack Learning
 * 
 * When banker overrides the suggested pack:
 * - event_type: 'override_applied'
 * - metadata: { from_pack, to_pack, reason }
 * 
 * This feeds right back into rankings for continuous learning.
 */

import { createServerClient } from "@/lib/supabase/server";
import { recordLearningEvent } from "./recordLearningEvent";
import { recordMatchEvent } from "./recordMatchEvent";

export type OverrideResult = {
  success: boolean;
  dealId: string;
  fromPackId: string | null;
  toPackId: string;
  matchEventId: string | null;
  requestsCreated: number;
  error?: string;
};

/**
 * Apply a manual override of the suggested pack
 */
export async function overridePackSelection(
  dealId: string,
  toPackId: string,
  reason?: string
): Promise<OverrideResult> {
  const sb = createServerClient();

  try {
    // 1. Get current deal state
    const { data: deal, error: dealError } = await sb
      .from("deals")
      .select("id, bank_id, loan_type, loan_program, pack_template_id")
      .eq("id", dealId)
      .single();

    if (dealError || !deal) {
      return {
        success: false,
        dealId,
        fromPackId: null,
        toPackId,
        matchEventId: null,
        requestsCreated: 0,
        error: dealError?.message || "Deal not found",
      };
    }

    const fromPackId = deal.pack_template_id;

    // 2. Get the new pack details
    const { data: newPack, error: packError } = await sb
      .from("borrower_pack_templates")
      .select("id, name")
      .eq("id", toPackId)
      .single();

    if (packError || !newPack) {
      return {
        success: false,
        dealId,
        fromPackId,
        toPackId,
        matchEventId: null,
        requestsCreated: 0,
        error: packError?.message || "Pack not found",
      };
    }

    // 3. Record match event (manually applied)
    const matchEventId = await recordMatchEvent(sb, {
      bankId: deal.bank_id,
      dealId: deal.id,
      packId: toPackId,
      matchScore: 0, // Manual override, no computed score
      autoApplied: false,
      suggested: false,
      manuallyApplied: true,
      metadata: {
        source: "banker_override",
        from_pack_id: fromPackId,
        to_pack_id: toPackId,
        reason: reason || "manual_override",
      },
    });

    // 4. Update deal with new pack
    const { error: updateError } = await sb
      .from("deals")
      .update({ pack_template_id: toPackId })
      .eq("id", dealId);

    if (updateError) {
      throw new Error(`Failed to update deal: ${updateError.message}`);
    }

    // 5. Load pack items
    const { data: items, error: itemsError } = await sb
      .from("borrower_pack_template_items")
      .select("*")
      .eq("pack_id", toPackId)
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (itemsError) {
      throw new Error(`Failed to load pack items: ${itemsError.message}`);
    }

    // 6. Check for existing requests
    const { data: existingRequests } = await sb
      .from("borrower_document_requests")
      .select("pack_item_id, title")
      .eq("deal_id", dealId);

    const existingKeys = new Set(
      (existingRequests || []).map((r) => `${r.pack_item_id}::${r.title}`)
    );

    // 7. Generate new document requests
    const toInsert = (items || [])
      .filter((item) => !existingKeys.has(`${item.id}::${item.title}`))
      .map((item) => ({
        bank_id: deal.bank_id,
        deal_id: dealId,
        source: "pack",
        pack_id: toPackId,
        pack_item_id: item.id,
        title: item.title,
        category: item.category,
        description: item.description,
        doc_type: item.doc_type,
        year_mode: item.year_mode || "optional",
        required: item.required || false,
        sort_order: item.sort_order || 0,
        status: "requested",
        evidence: {
          applied_from_pack: true,
          manually_applied: true,
          override: true,
        },
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

    // 8. Log learning event for override
    if (matchEventId) {
      await recordLearningEvent(sb, {
        bankId: deal.bank_id,
        matchEventId,
        eventType: "override",
        metadata: {
          from_pack_id: fromPackId,
          to_pack_id: toPackId,
          reason: reason || "banker_override",
          requests_created: requestsCreated,
        },
      });
    }

    return {
      success: true,
      dealId,
      fromPackId,
      toPackId,
      matchEventId,
      requestsCreated,
    };
  } catch (error) {
    console.error("Override pack error:", error);
    return {
      success: false,
      dealId,
      fromPackId: null,
      toPackId,
      matchEventId: null,
      requestsCreated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
