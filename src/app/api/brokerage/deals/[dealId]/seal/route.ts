import "server-only";

/**
 * POST /api/brokerage/deals/[dealId]/seal
 *   Borrower-triggered sealing. Cookie-authed via getBorrowerSession;
 *   session.deal_id must match the URL's [dealId] or we return 404
 *   (not 403 — same invariant as other brokerage routes).
 *
 * DELETE /api/brokerage/deals/[dealId]/seal
 *   Unseal a pending_preview listing. Only allowed while the listing
 *   hasn't hit the marketplace preview window yet.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { canSeal } from "@/lib/brokerage/sealingGate";
import { matchLendersToDeal } from "@/lib/brokerage/matchLenders";
import { DealIsolationError, assertNotTestDeal } from "@/lib/qaIdentity/isolation";
import { buildKFS } from "@/lib/brokerage/buildKFS";
import { computeListingCadence } from "@/lib/brokerage/cadence";
import {
  buildSealedSnapshot,
  sealedPackageArtifactColumns,
  SealSnapshotError,
} from "@/lib/brokerage/buildSealedSnapshot";
import { runHostileInterrogationForDeal } from "@/lib/brokerage/hostileInterrogation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;

  const session = await getBorrowerSession();
  if (!session || session.deal_id !== dealId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const sb = supabaseAdmin();

  // SPEC-BORROWER-QA-IDENTITY-V1 §3 — test applications cannot be sealed/sent to marketplace.
  // Database unavailability is not proof that a deal is safe to distribute.
  try {
    await assertNotTestDeal(dealId, sb);
  } catch (error) {
    if (error instanceof DealIsolationError) {
      if (error.code === "test_application") {
        return NextResponse.json(
          { ok: false, error: "test_application_distribution_blocked" },
          { status: 403 },
        );
      }
      if (error.code === "deal_not_found") {
        return NextResponse.json({ ok: false }, { status: 404 });
      }
    }
    return NextResponse.json(
      { ok: false, error: "deal_isolation_state_unavailable" },
      { status: 503 },
    );
  }

  const gate = await canSeal(dealId, sb);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "not_sealable", reasons: gate.reasons },
      { status: 400 },
    );
  }

  let snapshot;
  try {
    snapshot = await buildSealedSnapshot({ dealId, sb });
  } catch (err) {
    if (err instanceof SealSnapshotError) {
      // Missing loan term/amount — surface rather than sealing a fabricated KFS (L2).
      return NextResponse.json(
        { ok: false, error: "not_sealable", reasons: [err.reason] },
        { status: 400 },
      );
    }
    throw err;
  }

  // ── All reads / pure compute FIRST, before any write ────────────────────
  // Previously the sealed-package row was inserted before the rate-card lookup,
  // so a rate_card_miss (500) left an orphaned sealed package that made canSeal
  // report "already sealed" on retry — permanently bricking the deal with no
  // listing (SPEC audit H3). Every fallible read now runs up front; writes happen
  // last in one database transaction so any failure rolls the whole transition
  // back instead of leaving a partial seal/listing pair.
  const loanTier = bucketLoanAmount(snapshot.forRedactor.deal.loan_amount);
  const termTier = bucketTerm(snapshot.forRedactor.deal.term_months);
  const { data: rateRow, error: rateError } = await sb
    .from("marketplace_rate_card")
    .select("spread_bps_over_prime")
    .eq("version", "1.0.0")
    .eq("score_band", snapshot.forRedactor.score.band)
    .eq("sba_program", snapshot.forRedactor.deal.sba_program)
    .eq("loan_amount_tier", loanTier)
    .eq("term_tier", termTier)
    .is("superseded_at", null)
    .maybeSingle();

  if (rateError) {
    console.error("[seal] rate card lookup failed", {
      dealId,
      error: rateError.message,
    });
    return NextResponse.json(
      { ok: false, error: "seal_state_unavailable" },
      { status: 503 },
    );
  }

  if (!rateRow) {
    return NextResponse.json(
      {
        ok: false,
        error: "rate_card_miss",
        detail: `No rate card entry for ${snapshot.forRedactor.score.band}/${snapshot.forRedactor.deal.sba_program}/${loanTier}/${termTier}`,
      },
      { status: 500 },
    );
  }

  const kfs = await buildKFS({
    snapshot: snapshot.forRedactor,
    piiContext: snapshot.piiContext,
  });
  const matchResult = await matchLendersToDeal({ dealId, sb });
  const { previewOpensAt, claimOpensAt, claimClosesAt } =
    computeListingCadence(new Date());

  // One database transaction owns the sealed package, listing, and deal-state
  // transition. A failed listing insert or zero-row deal update rolls back the
  // seal automatically; there is no best-effort compensation window.
  const artifactColumns = sealedPackageArtifactColumns(
    snapshot.distributionBinding,
  );
  const { data: transitionRows, error: transitionError } = await sb.rpc(
    "create_buddy_seal_listing",
    {
      p_deal_id: dealId,
      p_bank_id: session.bank_id,
      p_sealed_snapshot: snapshot.full,
      p_final_business_plan_path:
        artifactColumns.final_business_plan_path,
      p_final_projections_path: artifactColumns.final_projections_path,
      p_final_feasibility_path: artifactColumns.final_feasibility_path,
      p_kfs: kfs,
      p_kfs_redaction_version: kfs.redactionVersion,
      p_score: snapshot.forRedactor.score.score,
      p_band: snapshot.forRedactor.score.band,
      p_rate_card_tier: snapshot.forRedactor.score.rateCardTier,
      p_published_rate_bps: Number(
        (rateRow as { spread_bps_over_prime: number }).spread_bps_over_prime,
      ),
      p_sba_program: snapshot.forRedactor.deal.sba_program,
      p_loan_amount: snapshot.forRedactor.deal.loan_amount,
      p_term_months: snapshot.forRedactor.deal.term_months,
      p_matched_lender_bank_ids: matchResult.matched,
      p_preview_opens_at: previewOpensAt.toISOString(),
      p_claim_opens_at: claimOpensAt.toISOString(),
      p_claim_closes_at: claimClosesAt.toISOString(),
    },
  );
  const transition = Array.isArray(transitionRows)
    ? transitionRows[0] as
        | { sealed_package_id?: unknown; listing_id?: unknown }
        | undefined
    : undefined;
  const sealedPackageId =
    typeof transition?.sealed_package_id === "string"
      ? transition.sealed_package_id
      : null;
  const listingId =
    typeof transition?.listing_id === "string" ? transition.listing_id : null;

  if (transitionError || !sealedPackageId || !listingId) {
    console.error("[seal] atomic seal transition failed", {
      dealId,
      error: transitionError?.message ?? "transition result was unproven",
    });
    return NextResponse.json(
      { ok: false, error: "seal_commit_failed" },
      { status: 503 },
    );
  }

  // Notify matched lenders that a preview is open (best-effort, non-fatal).
  try {
    const { queueLenderMessage } = await import("@/lib/brokerage/lenderComms");
    for (const lenderBankId of matchResult.matched) {
      await queueLenderMessage(
        "marketplace_preview_open",
        { dealId, listingId, lenderBankId, stage: "preview" },
        "email",
        sb,
      );
    }
  } catch (err) {
    console.warn("[seal] lender preview notify failed (non-fatal)", {
      dealId,
      listingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // SPEC-M6 ANTICIPATED-INTERROGATION-1 — best-effort, non-fatal. Awaited
  // (not truly fire-and-forget) because a serverless function isn't
  // guaranteed to keep running after the response is sent; wrapped so the
  // verifier role's single-provider, no-failover call (Invariant #4) can
  // never fail a seal that has already fully succeeded. Also re-runnable
  // on demand via POST /api/brokerage/deals/[dealId]/committee-interrogation.
  try {
    await runHostileInterrogationForDeal(dealId, session.bank_id, sb);
  } catch (err) {
    console.warn("[seal] hostile interrogation failed (non-fatal)", {
      dealId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({
    ok: true,
    sealedPackageId,
    listingId,
    previewOpensAt: previewOpensAt.toISOString(),
    claimOpensAt: claimOpensAt.toISOString(),
    matchedLenderCount: matchResult.matchCount,
    noMatchReasons: matchResult.noMatchReasons,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;

  const session = await getBorrowerSession();
  if (!session || session.deal_id !== dealId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const sb = supabaseAdmin();

  const { data: transitionRows, error: transitionError } = await sb.rpc(
    "unseal_buddy_marketplace_listing",
    {
      p_deal_id: dealId,
      p_bank_id: session.bank_id,
      p_reason: "borrower_requested",
    },
  );
  if (transitionError) {
    console.error("[seal] atomic unseal transition failed", {
      dealId,
      error: transitionError.message,
    });
    return NextResponse.json(
      { ok: false, error: "unseal_commit_failed" },
      { status: 503 },
    );
  }

  const transition = Array.isArray(transitionRows)
    ? transitionRows[0] as
        | { sealed_package_id?: unknown; listing_id?: unknown }
        | undefined
    : undefined;
  if (
    typeof transition?.sealed_package_id !== "string" ||
    typeof transition?.listing_id !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "not_unsealable" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}

function bucketLoanAmount(
  amount: number,
): "<350K" | "350K-1M" | "1M-5M" | ">5M" {
  if (amount < 350_000) return "<350K";
  if (amount < 1_000_000) return "350K-1M";
  if (amount < 5_000_000) return "1M-5M";
  return ">5M";
}

function bucketTerm(months: number): "<=7yr" | "7-15yr" | ">15yr" {
  if (months <= 84) return "<=7yr";
  if (months <= 180) return "7-15yr";
  return ">15yr";
}
