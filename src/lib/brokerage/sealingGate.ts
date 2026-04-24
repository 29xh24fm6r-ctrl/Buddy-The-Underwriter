import "server-only";

/**
 * Sprint 5 sealing gate — the preconditions that must hold before a
 * borrower can seal their package. Pure function over Supabase reads;
 * no side effects. Returns a flat list of human-readable blockers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type SealabilityResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

export async function canSeal(
  dealId: string,
  sb: SupabaseClient,
): Promise<SealabilityResult> {
  const reasons: string[] = [];

  // 1. Locked score exists + eligible + ≥60.
  const { data: score } = await sb
    .from("buddy_sba_scores")
    .select("score, band, eligibility_passed")
    .eq("deal_id", dealId)
    .eq("score_status", "locked")
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!score) {
    reasons.push("No locked Buddy SBA Score exists yet.");
  } else {
    const s = score as any;
    if (s.score < 60)
      reasons.push(`Buddy SBA Score ${s.score} is below the 60 minimum.`);
    if (s.band === "not_eligible")
      reasons.push("Deal band is 'not_eligible' — cannot list.");
    if (!s.eligibility_passed)
      reasons.push("SBA eligibility checks did not pass.");
  }

  // 2. Assumptions confirmed AND loan_impact has usable term + amount.
  const { data: assumptions } = await sb
    .from("buddy_sba_assumptions")
    .select("status, loan_impact")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!assumptions || (assumptions as any).status !== "confirmed") {
    reasons.push("SBA assumptions not yet confirmed.");
  } else {
    const li =
      ((assumptions as any).loan_impact ?? {}) as Record<string, unknown>;
    if (typeof li.termMonths !== "number" || (li.termMonths as number) <= 0) {
      reasons.push("Loan term (loan_impact.termMonths) is missing or invalid.");
    }
    if (typeof li.loanAmount !== "number" || (li.loanAmount as number) <= 0) {
      reasons.push(
        "Loan amount (loan_impact.loanAmount) is missing or invalid.",
      );
    }
  }

  // 3. Preview trident bundle exists.
  const { data: preview } = await sb
    .from("buddy_trident_bundles")
    .select("id")
    .eq("deal_id", dealId)
    .eq("mode", "preview")
    .eq("status", "succeeded")
    .is("superseded_at", null)
    .maybeSingle();
  if (!preview)
    reasons.push("Preview trident bundle has not been generated.");

  // 4. Validation report not FAIL.
  const { data: validation } = await sb
    .from("buddy_validation_reports")
    .select("overall_status")
    .eq("deal_id", dealId)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if ((validation as any)?.overall_status === "FAIL") {
    reasons.push("Validation report is in FAIL state.");
  }

  // 5. Not already sealed (active).
  const { data: existing } = await sb
    .from("buddy_sealed_packages")
    .select("id")
    .eq("deal_id", dealId)
    .is("unsealed_at", null)
    .maybeSingle();
  if (existing) reasons.push("Deal is already sealed.");

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
