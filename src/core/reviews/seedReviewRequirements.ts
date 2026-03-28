import "server-only";

/**
 * Phase 65J — Seed Review Requirements
 *
 * Builds recurring checklist from monitoring obligations + defaults.
 * Idempotent per case.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ReviewCaseType, ReviewRequirementCode } from "./types";

type RequirementSeed = {
  code: ReviewRequirementCode;
  title: string;
  description: string;
  borrowerVisible: boolean;
  evidenceType: string;
  source: string;
};

const ANNUAL_REVIEW_DEFAULTS: RequirementSeed[] = [
  { code: "annual_financial_statements", title: "Annual Financial Statements", description: "Please upload the most recent annual financial statements.", borrowerVisible: true, evidenceType: "document_submit", source: "default" },
  { code: "tax_returns", title: "Tax Returns", description: "Please upload the most recent tax returns.", borrowerVisible: true, evidenceType: "document_submit", source: "default" },
  { code: "covenant_certificate", title: "Covenant Compliance Certificate", description: "Please provide the covenant compliance certificate.", borrowerVisible: true, evidenceType: "document_submit", source: "default" },
  { code: "risk_rating_refresh", title: "Risk Rating Refresh", description: "Update risk rating based on current financial condition.", borrowerVisible: false, evidenceType: "banker_action", source: "default" },
  { code: "financial_snapshot_refresh", title: "Financial Snapshot Refresh", description: "Generate updated financial snapshot from new statements.", borrowerVisible: false, evidenceType: "banker_action", source: "default" },
  { code: "compliance_review", title: "Compliance Review", description: "Review covenant compliance and policy adherence.", borrowerVisible: false, evidenceType: "banker_action", source: "default" },
];

const RENEWAL_DEFAULTS: RequirementSeed[] = [
  ...ANNUAL_REVIEW_DEFAULTS,
  { code: "interim_financials", title: "Interim Financial Statements", description: "Please upload the most recent interim financial statements.", borrowerVisible: true, evidenceType: "document_submit", source: "default" },
  { code: "renewal_structure_review", title: "Renewal Structure Review", description: "Review and confirm loan structure for renewal.", borrowerVisible: false, evidenceType: "banker_action", source: "default" },
  { code: "maturity_confirmation", title: "Maturity Confirmation", description: "Confirm maturity date and renewal terms.", borrowerVisible: false, evidenceType: "banker_action", source: "default" },
];

export type SeedRequirementsInput = {
  dealId: string;
  bankId: string;
  caseType: ReviewCaseType;
  caseId: string;
};

export type SeedRequirementsResult = {
  ok: boolean;
  seededCount: number;
  skippedCount: number;
};

export async function seedReviewRequirements(
  input: SeedRequirementsInput,
): Promise<SeedRequirementsResult> {
  const sb = supabaseAdmin();
  let seeded = 0;
  let skipped = 0;

  // Check existing to avoid duplicates
  const { data: existing } = await sb
    .from("deal_review_case_requirements")
    .select("requirement_code")
    .eq("case_id", input.caseId)
    .eq("case_type", input.caseType);

  const existingCodes = new Set((existing ?? []).map((r) => r.requirement_code));

  const defaults = input.caseType === "renewal" ? RENEWAL_DEFAULTS : ANNUAL_REVIEW_DEFAULTS;

  // Seed from monitoring obligations (financial reporting + covenant)
  const { data: obligations } = await sb
    .from("deal_monitoring_obligations")
    .select("id, obligation_type, title, is_annual_review_input")
    .eq("deal_id", input.dealId)
    .eq("status", "active")
    .eq("is_annual_review_input", true);

  for (const ob of obligations ?? []) {
    const code = `monitoring_${ob.id.slice(0, 8)}` as ReviewRequirementCode;
    if (existingCodes.has(code)) { skipped++; continue; }

    await sb.from("deal_review_case_requirements").insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      case_type: input.caseType,
      case_id: input.caseId,
      requirement_code: code,
      title: ob.title,
      description: `Recurring obligation: ${ob.title}`,
      source: "monitoring_obligation",
      required: true,
      borrower_visible: true,
      status: "pending",
      evidence_type: "document_submit",
    });
    existingCodes.add(code);
    seeded++;
  }

  // Seed defaults
  for (const req of defaults) {
    if (existingCodes.has(req.code)) { skipped++; continue; }

    await sb.from("deal_review_case_requirements").insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      case_type: input.caseType,
      case_id: input.caseId,
      requirement_code: req.code,
      title: req.title,
      description: req.description,
      source: req.source,
      required: true,
      borrower_visible: req.borrowerVisible,
      status: "pending",
      evidence_type: req.evidenceType,
    });
    existingCodes.add(req.code);
    seeded++;
  }

  if (seeded > 0) {
    await sb.from("deal_timeline_events").insert({
      deal_id: input.dealId,
      kind: "review_requirements.seeded",
      title: `${seeded} review requirements seeded`,
      visible_to_borrower: false,
      meta: { case_type: input.caseType, case_id: input.caseId },
    });
  }

  return { ok: true, seededCount: seeded, skippedCount: skipped };
}
