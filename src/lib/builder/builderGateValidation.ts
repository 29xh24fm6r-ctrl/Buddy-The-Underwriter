import "server-only";

/**
 * Phase 56B — Builder Gate Validation
 *
 * Server-side readiness computation for Submit to Credit and Generate Docs.
 * Does NOT trust client state — reads from canonical server sources.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getParticipationSummary } from "./participation/manageParticipation";

export type BuilderGateResult = {
  creditReady: boolean;
  creditBlockers: string[];
  docReady: boolean;
  docBlockers: string[];
  borrowerSubmitReady: boolean;
  borrowerSubmitBlockers: string[];
};

/**
 * Compute server-authoritative Builder readiness gates.
 */
export async function validateBuilderGates(dealId: string): Promise<BuilderGateResult> {
  const sb = supabaseAdmin();
  const creditBlockers: string[] = [];
  const docBlockers: string[] = [];
  const borrowerBlockers: string[] = [];

  // Load deal + intake
  const { data: deal } = await sb
    .from("deals")
    .select("id, name, display_name, borrower_name, stage")
    .eq("id", dealId)
    .maybeSingle();

  const { data: intake } = await sb
    .from("deal_intake")
    .select("loan_type, sba_program")
    .eq("deal_id", dealId)
    .maybeSingle();

  // Load participation summary
  const participation = await getParticipationSummary(dealId);

  // Load loan request
  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select("id, requested_amount, product_type, purpose")
    .eq("deal_id", dealId)
    .order("request_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Load financial snapshot existence
  const { count: snapshotCount } = await sb
    .from("deal_truth_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);

  // Load story
  const { data: storySection } = await sb
    .from("deal_builder_sections")
    .select("section_data")
    .eq("deal_id", dealId)
    .eq("section_key", "story")
    .maybeSingle();

  // Load collateral
  const { count: collateralCount } = await sb
    .from("deal_collateral_items")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);

  // ---------------------------------------------------------------------------
  // Credit Ready checks
  // ---------------------------------------------------------------------------

  if (!loanRequest?.purpose) creditBlockers.push("Loan purpose is required");
  if (!loanRequest?.requested_amount) creditBlockers.push("Requested loan amount is required");
  if (!intake?.loan_type) creditBlockers.push("Loan type is required");

  const hasEntityName = Boolean(deal?.borrower_name || deal?.display_name || deal?.name);
  if (!hasEntityName) creditBlockers.push("Legal entity name is required");

  if (!participation.leadBorrower) creditBlockers.push("Lead borrower must be designated");
  if (participation.principals.length === 0 && participation.leadBorrower === null) {
    creditBlockers.push("At least one owner/principal is required");
  }

  const storyContent = storySection?.section_data as any;
  const hasStory = storyContent && typeof storyContent === "object" &&
    Object.values(storyContent).some((v) => typeof v === "string" && v.trim().length > 20);
  if (!hasStory) creditBlockers.push("Deal story/narrative is required");

  if (!snapshotCount || snapshotCount === 0) creditBlockers.push("Financial snapshot is required");

  // ---------------------------------------------------------------------------
  // Doc Ready checks (credit ready + additional)
  // ---------------------------------------------------------------------------

  docBlockers.push(...creditBlockers);

  if (!collateralCount || collateralCount === 0) docBlockers.push("At least one collateral item is required");

  if (participation.guarantors.length === 0) {
    docBlockers.push("Guarantor configuration is required for doc generation");
  }

  // Check if owners have PII on file
  const { data: piiRecords } = await sb
    .from("deal_pii_records")
    .select("ownership_entity_id, pii_type")
    .eq("deal_id", dealId);

  const piiByEntity = new Set((piiRecords ?? []).map((r: any) => `${r.ownership_entity_id}:${r.pii_type}`));

  // For doc-ready, at least one SSN/TIN should be on file
  const hasAnyPii = (piiRecords ?? []).length > 0;
  if (!hasAnyPii) {
    docBlockers.push("Secure identity information (SSN/TIN) required for at least one principal");
  }

  // ---------------------------------------------------------------------------
  // Borrower Submit Ready (subset of credit ready)
  // ---------------------------------------------------------------------------

  if (!hasEntityName) borrowerBlockers.push("Business name is required");
  if (!loanRequest?.requested_amount) borrowerBlockers.push("Loan amount is required");

  return {
    creditReady: creditBlockers.length === 0,
    creditBlockers,
    docReady: docBlockers.length === 0,
    docBlockers,
    borrowerSubmitReady: borrowerBlockers.length === 0,
    borrowerSubmitBlockers: borrowerBlockers,
  };
}
