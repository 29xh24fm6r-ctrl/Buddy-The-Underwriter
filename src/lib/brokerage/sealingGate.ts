import "server-only";

import { readPackageDocumentReadiness } from "@/lib/borrower/documents/packageChecklist";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownersNeedingIal2 } from "@/lib/brokerage/identityVerificationGate";

export type SealabilityResult = { ok: true } | { ok: false; reasons: string[] };

type FinalTridentEvidence = {
  credit_memo_pdf_path?: string | null;
  spreads_pdf_path?: string | null;
  sba_forms_pdf_path?: string | null;
  release_gate_json?: { ok?: unknown } | null;
  input_hash?: string | null;
  memo_input_hash?: string | null;
  canonical_memo_input_hash?: string | null;
  source_credit_memo_id?: string | null;
  source_spread_id?: string | null;
  business_plan_pdf_path?: string | null;
  projections_xlsx_path?: string | null;
  feasibility_pdf_path?: string | null;
};

function validateFinalTrident(bundle: FinalTridentEvidence | null): string[] {
  if (!bundle) return ["Certified Final Golden Trident has not been generated."];
  const reasons: string[] = [];
  if (bundle.release_gate_json?.ok !== true) reasons.push("Final Golden Trident release gate has not passed.");
  if (!bundle.input_hash) reasons.push("Final Golden Trident input hash is missing.");
  if (!bundle.memo_input_hash || bundle.canonical_memo_input_hash !== bundle.memo_input_hash) {
    reasons.push("Final Golden Trident canonical memo is missing or stale.");
  }
  if (!bundle.source_credit_memo_id) reasons.push("Final Golden Trident credit memo is missing.");
  if (!bundle.source_spread_id) reasons.push("Final Golden Trident spread is missing.");
  // Final mode publishes all six lender-package artifacts. The redacted projections
  // summary PDF is preview-only, so `projections_pdf_path` is null on every
  // final bundle by design — requiring it here made sealing unreachable.
  // The factory verifies all six before invoking atomic publication.
  if ([bundle.business_plan_pdf_path, bundle.projections_xlsx_path, bundle.feasibility_pdf_path, bundle.credit_memo_pdf_path, bundle.spreads_pdf_path, bundle.sba_forms_pdf_path].some((path) => !path)) {
    reasons.push("Final Golden Trident artifact set is incomplete.");
  }
  return reasons;
}

export async function canSeal(dealId: string, sb: SupabaseClient): Promise<SealabilityResult> {
  // Every gate is an independent read. Running them together keeps this
  // frequently-polled path to two database waves (owner roster, then batched
  // identity evidence) instead of six serial reads plus one read per owner.
  const [
    { data: score, error: scoreError },
    { data: assumptions, error: assumptionsError },
    { data: finalBundle, error: bundleError },
    { data: validation, error: validationError },
    { data: existing, error: existingError },
    identity,
    documents,
  ] = await Promise.all([
    sb.from("buddy_sba_scores")
      .select("score, band, eligibility_passed, input_snapshot").eq("deal_id", dealId)
      .eq("score_status", "locked").is("superseded_at", null).order("computed_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("buddy_sba_assumptions")
      .select("status, loan_impact").eq("deal_id", dealId).maybeSingle(),
    sb.from("buddy_trident_bundles")
      .select("id, release_gate_json, input_hash, memo_input_hash, canonical_memo_input_hash, source_credit_memo_id, source_spread_id, business_plan_pdf_path, projections_xlsx_path, feasibility_pdf_path, credit_memo_pdf_path, spreads_pdf_path, sba_forms_pdf_path")
      .eq("deal_id", dealId).eq("mode", "final").eq("status", "succeeded")
      .is("superseded_at", null).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("buddy_validation_reports")
      .select("overall_status").eq("deal_id", dealId).order("run_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("buddy_sealed_packages")
      .select("id").eq("deal_id", dealId).is("unsealed_at", null).maybeSingle(),
    ownersNeedingIal2(dealId, sb).then(owners => ({ owners, error: false })).catch(() => ({ owners: [], error: true })),
    readPackageDocumentReadiness(dealId, sb),
  ]);

  const reasons: string[] = [...documents.reasons];
  if ([scoreError, assumptionsError, bundleError, validationError, existingError].some(Boolean)) reasons.push("Submission checks could not be loaded. Refresh and try again.");
  if (identity.error) reasons.push("Owner identity checks could not be verified. Refresh and try again.");
  if (!score) reasons.push("No locked Buddy SBA Score exists yet.");
  else {
    const s = score as any;
    if (s.score < 60) reasons.push(`Buddy SBA Score ${s.score} is below the 60 minimum.`);
    if (s.band === "not_eligible") reasons.push("Deal band is 'not_eligible' — cannot list.");
    if (!s.eligibility_passed) reasons.push("SBA eligibility checks did not pass.");
    const unresolved = s.input_snapshot?.eligibilityUnresolved;
    if (Array.isArray(unresolved)) {
      for (const item of unresolved) {
        reasons.push(typeof item?.reason === "string" ? item.reason : "An SBA eligibility requirement remains unresolved.");
      }
    }
  }

  if (!assumptions || (assumptions as any).status !== "confirmed") reasons.push("SBA assumptions not yet confirmed.");
  else {
    const li = ((assumptions as any).loan_impact ?? {}) as Record<string, unknown>;
    if (typeof li.termMonths !== "number" || li.termMonths <= 0) reasons.push("Loan term (loan_impact.termMonths) is missing or invalid.");
    if (typeof li.loanAmount !== "number" || li.loanAmount <= 0) reasons.push("Loan amount (loan_impact.loanAmount) is missing or invalid.");
  }

  reasons.push(...validateFinalTrident(finalBundle as FinalTridentEvidence | null));
  if (!["PASS", "PASS_WITH_FLAGS"].includes((validation as any)?.overall_status)) reasons.push("A completed financial validation report without blocking errors is required.");
  if (existing) reasons.push("Deal is already sealed.");

  for (const owner of identity.owners) {
    reasons.push(`${owner.display_name ?? "An owner"} has not completed identity verification yet.`);
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
