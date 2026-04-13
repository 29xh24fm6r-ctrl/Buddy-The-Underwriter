/**
 * Phase 75 Step 4 — Missing Items Follow-Up Generator
 *
 * Derives missing items from canonical state blockers + gap queue,
 * then generates draft borrower requests for each missing item.
 *
 * Anchors to getBuddyCanonicalState() per spec requirement.
 * Primary source: deal_gap_queue (confirmed exists in pre-work SQL #4)
 * Fallback: deal_checklist_items (also confirmed exists)
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBuddyCanonicalState } from "@/core/state/BuddyCanonicalStateAdapter";
import { validateBorrowerDraft } from "@/lib/agentWorkflows/contracts/borrowerDraft.contract";

export type FollowupResult = {
  ok: boolean;
  drafts_created: number;
  drafts_skipped: number;
  errors: string[];
};

type GapItem = {
  fact_key: string;
  fact_type: string;
  gap_type: string;
  description: string;
};

/**
 * Generate missing items follow-up drafts for a deal.
 *
 * 1. Reads canonical state to confirm deal has document-related blockers
 * 2. Reads deal_gap_queue for open gaps (primary)
 * 3. Falls back to deal_checklist_items if gap queue is empty
 * 4. Creates draft_borrower_requests for each missing item
 * 5. Validates each draft against the BorrowerDraft output contract
 */
export async function generateMissingItemsFollowup(
  dealId: string,
  bankId: string,
): Promise<FollowupResult> {
  const errors: string[] = [];
  let draftsCreated = 0;
  let draftsSkipped = 0;

  try {
    const sb = supabaseAdmin();

    // 1. Anchor to canonical state — derive blockers
    const state = await getBuddyCanonicalState(dealId);
    const hasDocBlockers = state.blockers.some(
      (b) =>
        b.code === "gatekeeper_docs_incomplete" ||
        b.code === "gatekeeper_docs_need_review",
    );

    if (!hasDocBlockers && state.blockers.length === 0) {
      return { ok: true, drafts_created: 0, drafts_skipped: 0, errors: [] };
    }

    // 2. Read open gaps from deal_gap_queue (primary source)
    let gaps: GapItem[] = [];

    const { data: gapRows } = await sb
      .from("deal_gap_queue")
      .select("fact_key, fact_type, gap_type, description")
      .eq("deal_id", dealId)
      .eq("status", "open")
      .limit(50);

    if (gapRows && gapRows.length > 0) {
      gaps = gapRows as GapItem[];
    } else {
      // 3. Fallback: unsatisfied checklist items
      const { data: checklistRows } = await sb
        .from("deal_checklist_items")
        .select("checklist_key, label, category")
        .eq("deal_id", dealId)
        .eq("satisfied", false)
        .limit(50);

      if (checklistRows && checklistRows.length > 0) {
        gaps = checklistRows.map((row: any) => ({
          fact_key: row.checklist_key,
          fact_type: row.category ?? "DOCUMENT",
          gap_type: "missing_fact",
          description: row.label ?? `Missing: ${row.checklist_key}`,
        }));
      }
    }

    if (gaps.length === 0) {
      return { ok: true, drafts_created: 0, drafts_skipped: 0, errors: [] };
    }

    // 4. Create draft borrower requests for each gap
    for (const gap of gaps) {
      const docType = mapGapToDocType(gap.fact_type, gap.fact_key);
      const draftData = {
        draft_subject: `Missing Document: ${gap.description}`,
        draft_message:
          `We are reviewing your loan application and need additional documentation. ` +
          `Specifically, we need: ${gap.description}. ` +
          `Please upload this document through your borrower portal at your earliest convenience. ` +
          `This will help us continue processing your application without delay.`,
        missing_document_type: docType,
        evidence: [
          {
            gap_type: gap.gap_type,
            fact_key: gap.fact_key,
            fact_type: gap.fact_type,
            source: "deal_gap_queue",
          },
        ],
      };

      // Validate against output contract
      const validation = validateBorrowerDraft(draftData);
      if (!validation.ok && validation.severity === "block") {
        errors.push(`Draft blocked for ${gap.fact_key}: contract validation failed`);
        draftsSkipped++;
        continue;
      }

      // Check for existing active draft for this doc type
      const { data: existing } = await sb
        .from("draft_borrower_requests")
        .select("id")
        .eq("deal_id", dealId)
        .eq("missing_document_type", docType)
        .in("status", ["pending_approval", "approved"])
        .maybeSingle();

      if (existing) {
        draftsSkipped++;
        continue;
      }

      const { error: insertErr } = await sb
        .from("draft_borrower_requests")
        .insert({
          deal_id: dealId,
          missing_document_type: docType,
          draft_subject: draftData.draft_subject,
          draft_message: draftData.draft_message,
          evidence: draftData.evidence,
          status: "pending_approval",
        });

      if (insertErr) {
        errors.push(`Insert failed for ${gap.fact_key}: ${insertErr.message}`);
        draftsSkipped++;
      } else {
        draftsCreated++;
      }
    }

    return { ok: true, drafts_created: draftsCreated, drafts_skipped: draftsSkipped, errors };
  } catch (err) {
    return {
      ok: false,
      drafts_created: draftsCreated,
      drafts_skipped: draftsSkipped,
      errors: [...errors, err instanceof Error ? err.message : String(err)],
    };
  }
}

function mapGapToDocType(factType: string, factKey: string): string {
  const key = (factKey ?? "").toUpperCase();
  if (key.includes("TAX") || key.includes("1065") || key.includes("1120") || key.includes("1040")) {
    return "tax_return";
  }
  if (key.includes("BALANCE") || key.includes("SL_")) return "balance_sheet";
  if (key.includes("RENT_ROLL")) return "rent_roll";
  if (key.includes("PFS")) return "personal_financial_statement";
  if (key.includes("INCOME") || key.includes("T12") || key.includes("REVENUE")) return "income_statement";
  if (key.includes("BANK_STATEMENT")) return "bank_statement";
  if (key.includes("LEASE")) return "lease";
  return factType?.toLowerCase() ?? "other";
}
