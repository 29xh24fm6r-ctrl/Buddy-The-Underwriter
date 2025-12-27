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
  source: "sba_rule" | "bank_policy" | "missing_doc" | "conflict" | "condition";
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

/**
 * Generate punchlist for a deal
 */
export async function generatePunchlist(dealId: string, bankId: string): Promise<Punchlist> {
  const sb = supabaseAdmin();

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
        description: `${conflict.claim_ids.length} agents disagree on ${conflict.field_path}`,
        reason: "Agent arbitration requires human decision",
        source: "conflict",
        sba_vs_bank: "both",
        link: `/deals/${dealId}/truth`,
        blocking: true,
      });
    }
  }

  // 2. Check for missing required documents
  const { data: missingDocs } = await sb
    .from("deal_required_documents")
    .select("*")
    .eq("deal_id", dealId)
    .eq("status", "missing");

  if (missingDocs && missingDocs.length > 0) {
    for (const doc of missingDocs) {
      borrowerActions.push({
        id: `doc-${doc.id}`,
        type: "borrower_action",
        priority: doc.required ? "high" : "medium",
        title: `Upload ${doc.document_type}`,
        description: doc.description || `We need your ${doc.document_type}`,
        reason: doc.reason || "Required for SBA compliance",
        source: "missing_doc",
        sba_vs_bank: doc.source === "bank_overlay" ? "bank" : "sba",
        link: `/borrower/upload`,
        eta_minutes: 5,
        blocking: doc.required,
      });
    }
  }

  // 3. Check for eligibility failures
  const { data: eligibilityDecisions } = await sb
    .from("arbitration_decisions")
    .select("*")
    .eq("deal_id", dealId)
    .eq("topic", "eligibility")
    .eq("decision_status", "chosen");

  if (eligibilityDecisions && eligibilityDecisions.length > 0) {
    for (const decision of eligibilityDecisions) {
      if (
        decision.chosen_value?.status === "fail" &&
        decision.chosen_value?.severity === "blocker"
      ) {
        borrowerActions.push({
          id: `eligibility-${decision.id}`,
          type: "borrower_action",
          priority: "critical",
          title: "Fix eligibility issue",
          description: decision.chosen_value?.explanation || "Eligibility requirement not met",
          reason: decision.chosen_value?.sba_citation || "SBA SOP 50 10",
          source: "sba_rule",
          sba_vs_bank: "sba",
          blocking: true,
        });
      }
    }
  }

  // 4. Check for unverified documents
  const { data: unverifiedDocs } = await sb
    .from("borrower_files")
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
  const { data: openConditions } = await sb
    .from("deal_conditions")
    .select("*")
    .eq("deal_id", dealId)
    .eq("status", "open");

  if (openConditions && openConditions.length > 0) {
    for (const condition of openConditions) {
      const item: PunchlistItem = {
        id: `condition-${condition.id}`,
        type: condition.assignee === "borrower" ? "borrower_action" : "banker_action",
        priority: condition.severity === "critical" ? "critical" : "medium",
        title: condition.condition_title,
        description: condition.condition_description || "",
        reason: condition.reason || "Required for approval",
        source: "condition",
        sba_vs_bank: condition.source === "bank_policy" ? "bank" : "sba",
        blocking: condition.severity === "critical",
      };
      
      if (condition.assignee === "borrower") {
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
