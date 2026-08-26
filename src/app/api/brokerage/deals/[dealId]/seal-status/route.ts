import "server-only";

/**
 * GET /api/brokerage/deals/[dealId]/seal-status
 *
 * Borrower-facing status endpoint. Returns seal gate reasons (so the UI
 * can show what's still blocking), plus current listing state if sealed.
 * Also the single source of truth for the borrower journey checklist
 * (BrokerageStageStrip / BorrowerJourneyChecklist) — progressPct and
 * documentsUploadedCount let /start and /portal/[token] render the same
 * real, live status instead of the hardcoded progressPct: 0 that used
 * to freeze the strip on stage 1 regardless of actual progress.
 *
 * Session must match the URL's dealId per the same 404-not-403 rule as
 * other brokerage routes.
 *
 * NOTE: Sprint 5 spec mentioned this route but truncated before the
 * handler body. Implemented from session/scope pattern used by
 * /api/brokerage/deals/[dealId]/seal and /trident/download/[kind] to
 * stay consistent with prior sprints — flag for eyeball pass.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { canSeal } from "@/lib/brokerage/sealingGate";
import { deepMerge } from "@/lib/brokerage/borrowerConversation";
import { buildPackageManifest, type PackageManifest } from "@/lib/brokerage/packageDelivery";
import { computeApplicableForms } from "@/lib/sba/forms/applicability";
import { computeFieldProgress, type FieldProgress } from "@/lib/sba/forms/borrowerFieldProgress";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;

  const session = await getBorrowerSession();
  if (!session || session.deal_id !== dealId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const sb = supabaseAdmin();

  // Concierge progress (stage 1 — "tell us about your loan").
  const { data: conciergeSession } = await sb
    .from("borrower_concierge_sessions")
    .select("progress_pct, extracted_facts, confirmed_facts")
    .eq("deal_id", dealId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const progressPct = (conciergeSession as { progress_pct?: number } | null)?.progress_pct ?? 0;

  // Merged facts bag for the borrower-facing "Captured so far" panel. Text
  // chat writes extracted_facts turn-by-turn (and the client already has
  // that in sync from each response — see CapturedFactsPanel usage). Voice
  // writes to a separate confirmed_facts column (voice fact extraction runs
  // server-side inside the Fly gateway's dispatch call, so the browser has
  // no synchronous event to react to) — this poll is how voice-captured
  // facts reach the UI at all. confirmed_facts wins on overlap, matching
  // the "voice precedence" reconciliation noted where that column was added
  // (supabase/migrations/20260424_borrower_voice.sql).
  const facts = deepMerge(
    ((conciergeSession as { extracted_facts?: Record<string, unknown> } | null)?.extracted_facts as
      | Record<string, unknown>
      | undefined) ?? {},
    ((conciergeSession as { confirmed_facts?: Record<string, unknown> } | null)?.confirmed_facts as
      | Record<string, unknown>
      | undefined) ?? {},
  );

  // Field progress (§B.3 — registry-derived completion).
  // SBA program belongs to the canonical intake/request models, not deals.
  // Querying deals.sba_program produced a PostgreSQL error on every status poll.
  const [{ data: intakeProgram }, { data: requestProgram }] = await Promise.all([
    sb
      .from("deal_intake")
      .select("sba_program")
      .eq("deal_id", dealId)
      .maybeSingle(),
    sb
      .from("deal_loan_requests")
      .select("sba_program")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const rawSbaProgram =
    (intakeProgram as { sba_program?: string } | null)?.sba_program ??
    (requestProgram as { sba_program?: string } | null)?.sba_program;
  const sbaProgram: "7a" | "504" =
    rawSbaProgram?.toUpperCase() === "504" ? "504" : "7a";

  const owners = (facts.owners ?? []) as Array<Record<string, unknown>>;
  const entities = (facts.entities ?? []) as Array<Record<string, unknown>>;
  const formCodes = computeApplicableForms({
    program: sbaProgram,
    hasIndividualOwner: owners.length > 0,
    hasEquityOwningEntity: entities.length > 0,
    sellerNoteEquityPortion: null,
    constructionAmount: null,
  });
  const fieldProgress: FieldProgress = computeFieldProgress(facts, formCodes);

  // Independent checklist counts share one database wave. These reads used
  // to run serially on every poll.
  const [
    { count: identityVerificationCount },
    { count: ownershipEntityCount },
    { count: documentsUploadedCount },
  ] = await Promise.all([
    sb
      .from("borrower_identity_verifications")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId),
    sb
      .from("ownership_entities")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId),
    sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId),
  ]);

  // Franchise match — deal_franchises linked to an SBA-eligible brand.
  const { data: franchiseLink } = await sb
    .from("deal_franchises")
    .select("brand_id")
    .eq("deal_id", dealId)
    .maybeSingle();
  let franchiseMatched = false;
  if (franchiseLink?.brand_id) {
    const { data: brand } = await sb
      .from("franchise_brands")
      .select("sba_eligible")
      .eq("id", franchiseLink.brand_id)
      .maybeSingle();
    franchiseMatched = Boolean((brand as any)?.sba_eligible);
  }

  // Current active listing if one exists.
  const { data: listing } = await sb
    .from("marketplace_listings")
    .select(
      "id, status, score, band, published_rate_bps, preview_opens_at, claim_opens_at, claim_closes_at, matched_lender_bank_ids",
    )
    .eq("deal_id", dealId)
    .not("status", "eq", "expired")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Status polling is deliberately read-only. Expensive score, assumptions, and
  // Trident work belongs to explicit mutation/workflow commands; running it
  // from this frequently-polled GET caused production 30-second timeouts and
  // allowed a page refresh to launch durable factory work.

  // Gate evaluation (even when already sealed — surfaces re-seal readiness).
  const gate = await canSeal(dealId, sb);

  if (listing) {
    const row = listing as any;

    // Active claims — the lenders who have claimed this listing. The borrower
    // needs these to pick a lender (the pick step previously had no data source,
    // so the funnel dead-ended at "awaiting_borrower_pick" forever). The lender's
    // bank name is safe to show the borrower; borrower identity stays hidden the
    // other direction.
    let claims: Array<{ id: string; lenderName: string; claimedAt: string | null }> = [];
    if (["claiming", "awaiting_borrower_pick"].includes(row.status)) {
      const { data: claimRows } = await sb
        .from("marketplace_claims")
        .select("id, lender_bank_id, created_at, status")
        .eq("listing_id", row.id)
        .eq("status", "active")
        .order("created_at", { ascending: true });

      const rows = (claimRows ?? []) as any[];
      const bankIds = Array.from(new Set(rows.map((c) => c.lender_bank_id).filter(Boolean)));
      const nameById = new Map<string, string>();
      if (bankIds.length) {
        const { data: banks } = await sb
          .from("banks")
          .select("id, name")
          .in("id", bankIds);
        for (const b of (banks ?? []) as any[]) nameById.set(b.id, b.name);
      }
      claims = rows.map((c) => ({
        id: c.id,
        lenderName: nameById.get(c.lender_bank_id) ?? "A matched lender",
        claimedAt: c.created_at ?? null,
      }));
    }

    // Package manifest — only meaningful once a lender has been picked (full
    // access is granted at pick time; before that there's nothing to
    // download). Computed here rather than exposed via a new route.ts to
    // stay under this repo's Vercel serverless-function slot budget (see
    // routeConsolidationGuard.test.ts).
    let manifest: PackageManifest | null = null;
    if (row.status === "picked") {
      manifest = await buildPackageManifest(dealId, "full", sb as any);
    }

    return NextResponse.json({
      ok: true,
      progressPct,
      documentsUploadedCount: documentsUploadedCount ?? 0,
      identityVerificationCount: identityVerificationCount ?? 0,
      ownershipEntityCount: ownershipEntityCount ?? 0,
      franchiseMatched,
      facts,
      fieldProgress,
      sealed: true,
      listing: {
        id: row.id,
        status: row.status,
        score: row.score,
        band: row.band,
        publishedRateBps: row.published_rate_bps,
        previewOpensAt: row.preview_opens_at,
        claimOpensAt: row.claim_opens_at,
        claimClosesAt: row.claim_closes_at,
        matchedLenderCount: Array.isArray(row.matched_lender_bank_ids)
          ? row.matched_lender_bank_ids.length
          : 0,
      },
      claims,
      manifest,
      score: await loadScoreForResponse(dealId, sb),
      canSeal: gate.ok,
      gateReasons: gate.ok ? [] : gate.reasons,
    });
  }

  return NextResponse.json({
    ok: true,
    progressPct,
    documentsUploadedCount: documentsUploadedCount ?? 0,
    identityVerificationCount: identityVerificationCount ?? 0,
    ownershipEntityCount: ownershipEntityCount ?? 0,
    franchiseMatched,
    facts,
    fieldProgress,
    sealed: false,
    score: await loadScoreForResponse(dealId, sb),
    canSeal: gate.ok,
    gateReasons: gate.ok ? [] : gate.reasons,
  });
}

async function loadScoreForResponse(
  dealId: string,
  sb: ReturnType<typeof supabaseAdmin>,
): Promise<Record<string, unknown> | null> {
  const { data } = await sb
    .from("buddy_sba_scores")
    .select(
      "score, band, eligibility_passed, eligibility_failures, input_snapshot, " +
        "top_strengths, top_weaknesses, narrative, computed_at",
    )
    .eq("deal_id", dealId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as any;
  return {
    score: row.score,
    band: row.band,
    eligibilityPassed: row.eligibility_passed,
    eligibilityFailures: row.eligibility_failures ?? [],
    // Outstanding Items: what the borrower still needs to supply. Distinct
    // from eligibilityFailures, which are actual SBA findings. Surfacing
    // them separately is what stops "we need your employee count" from
    // reading like "you don't qualify".
    eligibilityUnresolved:
      (row.input_snapshot as { eligibilityUnresolved?: unknown[] } | null)
        ?.eligibilityUnresolved ?? [],
    topStrengths: row.top_strengths ?? [],
    topWeaknesses: row.top_weaknesses ?? [],
    narrative: row.narrative ?? "",
    computedAt: row.computed_at ?? null,
  };
}
