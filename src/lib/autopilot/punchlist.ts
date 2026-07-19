/**
 * SBA God Mode: Punchlist Generator
 * 
 * Creates the "single source of truth" for what needs to happen next.
 * Grouped by: Borrower actions, Banker actions, System reviews.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export interface PunchlistItem {
  id: string;
  type: "borrower_action" | "banker_action" | "system_review";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  reason: string;
  source: "sba_rule" | "bank_policy" | "missing_doc" | "conflict" | "condition" | "system";
  sba_vs_bank: "sba" | "bank" | "both";
  link?: string;
  eta_minutes?: number;
  blocking?: boolean; // If true, deal cannot proceed without this
}

export interface Punchlist {
  borrower_actions: PunchlistItem[];
  banker_actions: PunchlistItem[];
  system_reviews: PunchlistItem[];
  total_count: number;
  blocking_count: number;
}

export type PunchlistSupabaseClient = { from: (table: string) => any };

/**
 * Generate punchlist for a deal
 */
export async function generatePunchlist(
  dealId: string,
  bankId: string,
  opts: { sb?: PunchlistSupabaseClient } = {},
): Promise<Punchlist> {
  const sb: PunchlistSupabaseClient = opts.sb ?? supabaseAdmin();

  const borrowerActions: PunchlistItem[] = [];
  const bankerActions: PunchlistItem[] = [];
  const systemReviews: PunchlistItem[] = [];

  // 1. Check for open conflicts (need banker review)
  const { data: openConflicts } = await sb
    .from("claim_conflict_sets")
    .select("*")
    .eq("deal_id", dealId)
    .eq("status", "open");

  if (openConflicts && openConflicts.length > 0) {
    for (const conflict of openConflicts) {
      bankerActions.push({
        id: `conflict-${conflict.id}`,
        type: "banker_action",
        priority: "high",
        title: `Resolve conflict: ${conflict.topic}`,
        description: `${conflict.num_claims} agents disagree on ${conflict.predicate}`,
        reason: "Agent arbitration requires human decision",
        source: "conflict",
        sba_vs_bank: "both",
        link: `/deals/${dealId}/truth`,
        blocking: true,
      });
    }
  }

  // 2. Check for missing required documents
  //
  // deal_required_documents has no required/document_type/description/
  // reason/source columns — real columns are document_key/document_label/
  // document_category/is_required/status. This previously read
  // doc.required/document_type/description/reason/source, none of which
  // exist, so every field below was always undefined. There is also no
  // column distinguishing bank-overlay-driven requirements from SBA ones,
  // so sba_vs_bank defaults to "sba" for all rows (documented limitation,
  // not a bug — no data source exists to tell the two apart).
  const { data: missingDocs } = await sb
    .from("deal_required_documents")
    .select("*")
    .eq("deal_id", dealId)
    .eq("status", "missing");

  if (missingDocs && missingDocs.length > 0) {
    for (const doc of missingDocs) {
      const label = doc.document_label || doc.document_key;
      borrowerActions.push({
        id: `doc-${doc.id}`,
        type: "borrower_action",
        priority: doc.is_required ? "high" : "medium",
        title: `Upload ${label}`,
        description: doc.document_label ? `We need your ${label}` : "",
        reason: "Required for SBA compliance",
        source: "missing_doc",
        sba_vs_bank: "sba",
        link: `/borrower/upload`,
        eta_minutes: 5,
        blocking: doc.required,
      });
    }
  }

  // 3. Check for eligibility failures
  // arbitration_decisions has no `topic` column of its own (topic lives on
  // claim_conflict_sets/agent_claims) - resolve the eligibility-topic claim
  // hashes first, then filter decisions by claim_hash.
  const { data: eligibilityConflicts } = await sb
    .from("claim_conflict_sets")
    .select("claim_hash")
    .eq("deal_id", dealId)
    .eq("topic", "eligibility");

  const eligibilityHashes = (eligibilityConflicts ?? []).map((c: any) => c.claim_hash);

  const { data: eligibilityDecisions } = eligibilityHashes.length > 0
    ? await sb
        .from("arbitration_decisions")
        .select("*")
        .eq("deal_id", dealId)
        .in("claim_hash", eligibilityHashes)
        .eq("decision_status", "chosen")
    : { data: [] };

  if (eligibilityDecisions && eligibilityDecisions.length > 0) {
    for (const decision of eligibilityDecisions) {
      const chosenValue = decision.chosen_value_json as Record<string, any> | null;
      if (
        chosenValue?.status === "fail" &&
        chosenValue?.severity === "blocker"
      ) {
        borrowerActions.push({
          id: `eligibility-${decision.id}`,
          type: "borrower_action",
          priority: "critical",
          title: "Fix eligibility issue",
          description: chosenValue?.explanation || "Eligibility requirement not met",
          reason: chosenValue?.sba_citation || "SBA SOP 50 10",
          source: "sba_rule",
          sba_vs_bank: "sba",
          blocking: true,
        });
      }
    }
  }

  // 4. Check for unverified documents
  //
  // borrower_files does not exist as a table at all — this query always
  // silently returned zero rows. The real, populated document intake
  // table is deal_documents (status='pending' for documents still awaiting
  // OCR/classification).
  const { data: unverifiedDocs } = await sb
    .from("deal_documents")
    .select("*")
    .eq("deal_id", dealId)
    .eq("status", "pending");

  if (unverifiedDocs && unverifiedDocs.length > 0) {
    systemReviews.push({
      id: "verify-docs",
      type: "system_review",
      priority: "medium",
      title: `Verify ${unverifiedDocs.length} documents`,
      description: "OCR and validation pending",
      reason: "Ensure document authenticity",
      source: "system",
      sba_vs_bank: "both",
      eta_minutes: 60,
      blocking: false,
    } as PunchlistItem);
  }

  // 5. Check for pending conditions
  //
  // deal_conditions has no `assignee`/`severity` columns — real columns are
  // title/description/category/status/source/source_key (see
  // 20251219000007_conditions_generator.sql). This previously read
  // condition.assignee/severity/condition_title/condition_description/reason,
  // none of which exist, so every field below was always undefined.
  const { data: openConditions } = await sb
    .from("deal_conditions")
    .select("*")
    .eq("deal_id", dealId)
    .eq("status", "open");

  if (openConditions && openConditions.length > 0) {
    for (const condition of openConditions) {
      // No assignee column exists — mitigant-driven conditions ("policy"
      // source) typically require a borrower document upload; everything
      // else defaults to a banker action.
      const isBorrowerAction = condition.source === "policy";
      // No severity column exists — derive a priority/blocking signal from
      // category instead: legal and credit conditions are treated as
      // high-priority and blocking, the rest as medium/non-blocking.
      const isHighStakes = condition.category === "legal" || condition.category === "credit";

      const item: PunchlistItem = {
        id: `condition-${condition.id}`,
        type: isBorrowerAction ? "borrower_action" : "banker_action",
        priority: isHighStakes ? "high" : "medium",
        title: condition.title,
        description: condition.description || "",
        reason: condition.description || "Required for approval",
        source: "condition",
        sba_vs_bank: condition.source === "bank_policy" ? "bank" : "sba",
        blocking: isHighStakes,
      };

      if (isBorrowerAction) {
        borrowerActions.push(item);
      } else {
        bankerActions.push(item);
      }
    }
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortByPriority = (a: PunchlistItem, b: PunchlistItem) =>
    priorityOrder[a.priority] - priorityOrder[b.priority];

  borrowerActions.sort(sortByPriority);
  bankerActions.sort(sortByPriority);
  systemReviews.sort(sortByPriority);

  const totalCount = borrowerActions.length + bankerActions.length + systemReviews.length;
  const blockingCount = [...borrowerActions, ...bankerActions, ...systemReviews].filter(
    (item) => item.blocking
  ).length;

  return {
    borrower_actions: borrowerActions,
    banker_actions: bankerActions,
    system_reviews: systemReviews,
    total_count: totalCount,
    blocking_count: blockingCount,
  };
}
