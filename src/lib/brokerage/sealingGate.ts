import "server-only";

/**
 * Sprint 5 sealing gate — the preconditions that must hold before a
 * borrower can seal their package. Pure function over Supabase reads;
 * no side effects. Returns a flat list of human-readable blockers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ownersNeedingIal2 } from "@/lib/brokerage/identityVerificationGate";
import { summarizeOwnership } from "@/lib/ownership/ownershipTotals";

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

  // 6. Identity verification (Ticket 2, SPEC-BROKERAGE-SBA-READY-V1) — every
  // owner at/above the 20% ownership threshold must have completed IAL2
  // identity verification before the package is trustworthy enough to show
  // matched lenders. Default sequencing decision (no written spec existed
  // for Ticket 2): identity verification gates sealing; e-signature of the
  // actual SBA forms is deferred until after the borrower picks a lender —
  // see docs/archive/brokerage-sba-ready-v1/T2-AAR.md.
  const unverifiedOwners = await ownersNeedingIal2(dealId, sb);
  for (const owner of unverifiedOwners) {
    reasons.push(
      `${owner.display_name ?? "An owner"} has not completed identity verification yet.`,
    );
  }

  // 7. The cap table has to add up.
  //
  // handleSaveOwnership validates the 100% total of the payload it is
  // handed, but nothing checked the total of what the database actually
  // HOLDS — so a total that only goes wrong afterwards never got caught.
  // Deal b296dec2 reached 149% (Sebrina Colon 51%, Matthew Paller 49%, and
  // a duplicate "matt paller" 49% inserted two days later) and would have
  // sealed at 149% had the identity blockers not happened to stop it.
  //
  // 149% must never reach a lender: a cap table that does not total 100%
  // is either missing an owner — an unidentified guarantor — or
  // double-counting one, and both are SBA decline grounds. Same-person
  // duplicates are reported by name so the fix is one edit, not a hunt.
  //
  // Deliberately non-fatal on a read failure: a Supabase outage should not
  // manufacture a sealing blocker out of nothing. summarizeOwnership's
  // `indeterminate` case (owner rows exist but no percentages were ever
  // recorded) is likewise not a blocker — that is missing data the
  // borrower was never asked for, not a wrong total.
  const { data: ownerRows, error: ownerRowsError } = await sb
    .from("ownership_entities")
    .select("display_name, ownership_pct")
    .eq("deal_id", dealId);

  if (!ownerRowsError && ownerRows && ownerRows.length > 0) {
    const summary = summarizeOwnership(
      ownerRows as Array<{ display_name: string | null; ownership_pct: number | null }>,
    );
    for (const issue of summary.issues) {
      if (issue.code === "no_owners") continue;
      // A duplicate owner blocks whether or not percentages were recorded
      // — it is a second identity-verification blocker for one human
      // either way. Only the arithmetic is skipped when there is no
      // arithmetic to do.
      if (issue.code === "total_mismatch" && summary.indeterminate) continue;
      reasons.push(issue.message);
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
