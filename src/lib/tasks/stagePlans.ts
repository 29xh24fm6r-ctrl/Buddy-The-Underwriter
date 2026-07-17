import "server-only";

/**
 * Stage-generated task plans — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR3 §5.4.
 *
 * Idempotent by construction: each generated task's automation_source is
 * `stage_plan:<stage>:<key>`, and idx_brokerage_tasks_automation_dedup (a
 * partial unique index on (deal_id, automation_source) for still-open
 * rows) makes a duplicate insert for the same still-open task impossible
 * at the database level. This function still pre-checks so it can report
 * what it actually created rather than relying on catching a constraint
 * violation.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import type { BrokerageStage } from "../dealStage/stages";
import type { TaskCategory } from "./types";
import { createTask } from "./tasks";

type StageTaskTemplate = {
  key: string;
  title: string;
  category: TaskCategory;
  blocking: boolean;
};

export const STAGE_TASK_PLANS: Partial<Record<BrokerageStage, readonly StageTaskTemplate[]>> = {
  discovery: [
    { key: "schedule_discovery_call", title: "Schedule discovery call", category: "borrower_follow_up", blocking: false },
  ],
  qualification: [
    { key: "complete_qualification", title: "Complete lead qualification", category: "eligibility_review", blocking: true },
  ],
  application: [
    { key: "collect_application_docs", title: "Collect required application documents", category: "document_request", blocking: true },
  ],
  document_collection: [
    { key: "verify_documents_complete", title: "Verify all required documents received", category: "document_request", blocking: true },
  ],
  financial_analysis: [
    { key: "generate_financial_analysis", title: "Generate financial analysis", category: "financial_review", blocking: true },
  ],
  packaging: [
    { key: "assemble_submission_package", title: "Assemble lender submission package", category: "submission", blocking: true },
  ],
  lender_strategy: [
    { key: "select_target_lender", title: "Select target lender", category: "lender_research", blocking: true },
  ],
  submitted: [
    { key: "confirm_submission_received", title: "Confirm lender received submission", category: "submission", blocking: false },
  ],
  lender_review: [
    { key: "monitor_lender_questions", title: "Monitor for lender questions", category: "lender_follow_up", blocking: false },
  ],
  term_sheet: [
    { key: "review_term_sheet", title: "Review term sheet with borrower", category: "internal_review", blocking: true },
  ],
  underwriting: [
    { key: "track_underwriting_conditions", title: "Track underwriting conditions", category: "underwriting_condition", blocking: false },
  ],
  commitment: [
    { key: "review_commitment_letter", title: "Review commitment letter", category: "commitment", blocking: true },
  ],
  closing: [
    { key: "coordinate_closing", title: "Coordinate closing logistics", category: "closing", blocking: true },
  ],
  funded: [
    { key: "confirm_funding_received", title: "Confirm funding received", category: "closing", blocking: false },
  ],
  post_close: [
    { key: "schedule_postclose_followup", title: "Schedule post-closing follow-up", category: "post_closing", blocking: false },
  ],
};

export type GenerateStageTaskPlanResult = {
  created: string[];
  skippedExisting: string[];
};

export async function generateStageTaskPlan(
  bankId: string,
  dealId: string,
  stage: BrokerageStage,
  actorClerkUserId: string | null,
  sb: SB = supabaseAdmin(),
): Promise<GenerateStageTaskPlanResult> {
  const templates = STAGE_TASK_PLANS[stage];
  if (!templates || templates.length === 0) return { created: [], skippedExisting: [] };

  const { data: existing } = await sb
    .from("brokerage_tasks")
    .select("automation_source")
    .eq("deal_id", dealId)
    .in("status", ["open", "in_progress", "blocked"]);

  const existingSources = new Set(
    ((existing ?? []) as Array<{ automation_source: string | null }>)
      .map((r) => r.automation_source)
      .filter((s): s is string => !!s),
  );

  const created: string[] = [];
  const skippedExisting: string[] = [];

  for (const template of templates) {
    const automationSource = `stage_plan:${stage}:${template.key}`;
    if (existingSources.has(automationSource)) {
      skippedExisting.push(template.key);
      continue;
    }
    await createTask(
      {
        bankId,
        title: template.title,
        category: template.category,
        dealId,
        blocking: template.blocking,
        automationSource,
        createdByClerkUserId: actorClerkUserId,
      },
      sb,
    );
    created.push(template.key);
  }

  return { created, skippedExisting };
}
