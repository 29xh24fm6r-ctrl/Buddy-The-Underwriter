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
import { buildKFS } from "@/lib/brokerage/buildKFS";
import { computeListingCadence } from "@/lib/brokerage/cadence";
import { buildSealedSnapshot } from "@/lib/brokerage/buildSealedSnapshot";

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

  const gate = await canSeal(dealId, sb);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "not_sealable", reasons: gate.reasons },
      { status: 400 },
    );
  }

  const snapshot = await buildSealedSnapshot({ dealId, sb });

  const { data: sealedRow, error: sealErr } = await sb
    .from("buddy_sealed_packages")
    .insert({
      deal_id: dealId,
      bank_id: session.bank_id,
      sealed_snapshot: snapshot.full,
    })
    .select("id")
    .single();
  if (sealErr || !sealedRow) {
    return NextResponse.json(
      { ok: false, error: "seal_insert_failed", detail: sealErr?.message },
      { status: 500 },
    );
  }

  const kfs = await buildKFS({
    snapshot: snapshot.forRedactor,
    piiContext: snapshot.piiContext,
  });

  const matchResult = await matchLendersToDeal({ dealId, sb });

  const loanTier = bucketLoanAmount(snapshot.forRedactor.deal.loan_amount);
  const termTier = bucketTerm(snapshot.forRedactor.deal.term_months);
  const { data: rateRow } = await sb
    .from("marketplace_rate_card")
    .select("spread_bps_over_prime")
    .eq("version", "1.0.0")
    .eq("score_band", snapshot.forRedactor.score.band)
    .eq("sba_program", snapshot.forRedactor.deal.sba_program)
    .eq("loan_amount_tier", loanTier)
    .eq("term_tier", termTier)
    .is("superseded_at", null)
    .maybeSingle();

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

  const { previewOpensAt, claimOpensAt, claimClosesAt } =
    computeListingCadence(new Date());

  const { data: listingRow, error: listingErr } = await sb
    .from("marketplace_listings")
    .insert({
      sealed_package_id: sealedRow.id,
      deal_id: dealId,
      kfs,
      kfs_redaction_version: kfs.redactionVersion,
      score: snapshot.forRedactor.score.score,
      band: snapshot.forRedactor.score.band,
      rate_card_tier: snapshot.forRedactor.score.rateCardTier,
      published_rate_bps: (rateRow as any).spread_bps_over_prime,
      sba_program: snapshot.forRedactor.deal.sba_program,
      loan_amount: snapshot.forRedactor.deal.loan_amount,
      term_months: snapshot.forRedactor.deal.term_months,
      matched_lender_bank_ids: matchResult.matched,
      preview_opens_at: previewOpensAt.toISOString(),
      claim_opens_at: claimOpensAt.toISOString(),
      claim_closes_at: claimClosesAt.toISOString(),
    })
    .select("id")
    .single();
  if (listingErr || !listingRow) {
    return NextResponse.json(
      {
        ok: false,
        error: "listing_insert_failed",
        detail: listingErr?.message,
      },
      { status: 500 },
    );
  }

  await sb.from("deals").update({ status: "sealed" }).eq("id", dealId);

  return NextResponse.json({
    ok: true,
    sealedPackageId: sealedRow.id,
    listingId: listingRow.id,
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

  const { data: listing } = await sb
    .from("marketplace_listings")
    .select("id, sealed_package_id, status")
    .eq("deal_id", dealId)
    .in("status", ["pending_preview"])
    .maybeSingle();

  if (!listing) {
    return NextResponse.json(
      { ok: false, error: "not_unsealable" },
      { status: 400 },
    );
  }

  await sb
    .from("buddy_sealed_packages")
    .update({
      unsealed_at: new Date().toISOString(),
      unseal_reason: "borrower_requested",
    })
    .eq("id", (listing as any).sealed_package_id);

  await sb.from("marketplace_listings").delete().eq("id", (listing as any).id);
  await sb.from("deals").update({ status: "draft" }).eq("id", dealId);

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
