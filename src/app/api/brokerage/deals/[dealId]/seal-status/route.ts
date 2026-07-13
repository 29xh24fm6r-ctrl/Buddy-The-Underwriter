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
    .select("progress_pct")
    .eq("deal_id", dealId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const progressPct = (conciergeSession as { progress_pct?: number } | null)?.progress_pct ?? 0;

  // Document count (stage 2 — "upload documents").
  const { count: documentsUploadedCount } = await sb
    .from("deal_documents")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);

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

    return NextResponse.json({
      ok: true,
      progressPct,
      documentsUploadedCount: documentsUploadedCount ?? 0,
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
      canSeal: gate.ok,
      gateReasons: gate.ok ? [] : gate.reasons,
    });
  }

  return NextResponse.json({
    ok: true,
    progressPct,
    documentsUploadedCount: documentsUploadedCount ?? 0,
    sealed: false,
    canSeal: gate.ok,
    gateReasons: gate.ok ? [] : gate.reasons,
  });
}
