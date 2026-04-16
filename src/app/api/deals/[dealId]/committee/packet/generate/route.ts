import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument as PdfLibDocument } from "pdf-lib";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { renderDecisionPdf } from "@/lib/pdf/decisionPdf";
import { getActiveLetterhead, downloadLetterheadBuffer } from "@/lib/bank/letterhead";
import { getLatestLockedQuoteId } from "@/lib/pricing/getLatestLockedQuote";
import { buildPricingMemoAppendixPdfBytes } from "@/app/api/deals/[dealId]/pricing/quote/[quoteId]/memo-pdf/route";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { buildCommitteeFinancialValidationSummary } from "@/lib/financialValidation/buildCommitteeFinancialValidationSummary";
import { loadAndEnforceResearchTrust } from "@/lib/research/trustEnforcement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

/**
 * POST /api/deals/[dealId]/committee/packet/generate
 *
 * One-click CTA to generate a committee packet for the deal.
 * Called from LifecycleStatusPanel when user clicks "Generate Packet".
 *
 * This endpoint:
 * 1. Finds the latest decision snapshot
 * 2. Generates the committee packet PDF (with optional pricing appendix)
 * 3. Logs the event to mark packet as ready
 *
 * Returns:
 * - ok: true, snapshotId: string - Successfully generated
 * - ok: false, error: string - Error occurred
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Params }
): Promise<NextResponse> {
  try {
    const { dealId } = await ctx.params;

    // Verify deal access
    const access = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.status }
      );
    }
    const { userId } = access;

    // Phase 79: Trust grade enforcement — committee packet requires committee-grade research
    const trustCheck = await loadAndEnforceResearchTrust(dealId, "committee_packet");
    if (!trustCheck.allowed) {
      return NextResponse.json(
        { ok: false, error: trustCheck.reason },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();

    // Get latest decision snapshot
    const { data: snapshot, error: snapErr } = await sb
      .from("decision_snapshots")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapErr) {
      console.error("[committee/packet/generate] Snapshot query error:", snapErr);
      return NextResponse.json(
        { ok: false, error: "Failed to fetch decision snapshot" },
        { status: 500 }
      );
    }

    if (!snapshot) {
      return NextResponse.json(
        { ok: false, error: "No decision snapshot found. Complete underwriting first." },
        { status: 400 }
      );
    }

    // ── Canonical memo reference ──────────────────────────────────────────
    // Packet must reference the same canonical memo that feeds the decision.
    const { data: memoNarrative } = await sb
      .from("canonical_memo_narratives")
      .select("id, input_hash, generated_at")
      .eq("deal_id", dealId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // ── Financial validation preflight ────────────────────────────────────
    // Committee packet must include financial validation state.
    let financialValidation: Awaited<ReturnType<typeof buildCommitteeFinancialValidationSummary>> | null = null;
    try {
      financialValidation = await buildCommitteeFinancialValidationSummary(dealId);
    } catch (err) {
      console.warn("[committee/packet/generate] Financial validation summary failed (non-fatal):", err);
    }

    // Warn (but don't block) if financial validation is not decision-safe
    const preflightWarnings: string[] = [];
    if (financialValidation && !financialValidation.decisionSafe) {
      preflightWarnings.push("Financial validation is not decision-safe");
    }
    if (financialValidation?.status === "stale") {
      preflightWarnings.push("Financial validation summary is stale");
    }
    if (!memoNarrative) {
      preflightWarnings.push("No canonical memo narrative found — packet may lack narrative context");
    }

    // Fetch bank letterhead
    let letterheadBuffer: Buffer | null = null;
    try {
      const letterhead = await getActiveLetterhead(access.bankId);
      if (letterhead) {
        letterheadBuffer = await downloadLetterheadBuffer(letterhead.bucket, letterhead.path);
      }
    } catch (err) {
      console.warn("[committee/packet/generate] Letterhead fetch failed, continuing without:", err);
    }

    // Generate PDF
    const pdfBuffer = await renderDecisionPdf(snapshot, letterheadBuffer);

    // Try to add pricing appendix
    let finalPdfBuffer = pdfBuffer;
    let appendixQuoteId: string | null = null;

    try {
      appendixQuoteId = await getLatestLockedQuoteId(sb, dealId);
      if (appendixQuoteId) {
        const appendixBytes = await buildPricingMemoAppendixPdfBytes({
          sb,
          bankId: access.bankId,
          dealId,
          quoteId: appendixQuoteId,
        });

        if (appendixBytes) {
          const baseDoc = await PdfLibDocument.load(pdfBuffer);
          const appendixDoc = await PdfLibDocument.load(appendixBytes);
          const merged = await PdfLibDocument.create();

          const basePages = await merged.copyPages(baseDoc, baseDoc.getPageIndices());
          basePages.forEach((page) => merged.addPage(page));

          const appendixPages = await merged.copyPages(appendixDoc, appendixDoc.getPageIndices());
          appendixPages.forEach((page) => merged.addPage(page));

          const mergedBytes = await merged.save();
          finalPdfBuffer = Buffer.from(mergedBytes);
        }
      }
    } catch (err) {
      console.warn("[committee/packet/generate] Appendix generation failed, continuing without:", err);
    }

    // Log the event to mark packet as generated
    // This makes committeePacketReady = true in lifecycle state
    await writeEvent({
      dealId,
      kind: "deal.committee.packet.generated",
      actorUserId: userId,
      scope: "committee",
      action: "packet_generate",
      meta: {
        snapshotId: snapshot.id,
        quoteId: appendixQuoteId,
        pdfSizeBytes: finalPdfBuffer.length,
        source: "one_click_cta",
        // Canonical provenance references
        memoNarrativeId: memoNarrative?.id ?? null,
        memoInputHash: memoNarrative?.input_hash ?? null,
        memoGeneratedAt: memoNarrative?.generated_at ?? null,
        // Financial validation state at packet generation time
        financialValidationStatus: financialValidation?.status ?? null,
        financialValidationMemoSafe: financialValidation?.memoSafe ?? null,
        financialValidationDecisionSafe: financialValidation?.decisionSafe ?? null,
        preflightWarnings: preflightWarnings.length > 0 ? preflightWarnings : null,
      },
    });

    // Observability: packet generation completed
    void writeEvent({
      dealId,
      kind: "packet.generation.completed",
      actorUserId: userId,
      scope: "committee",
      action: "packet_generate",
      meta: {
        snapshot_id: snapshot.id,
        memo_narrative_id: memoNarrative?.id ?? null,
        memo_input_hash: memoNarrative?.input_hash ?? null,
        financial_validation_status: financialValidation?.status ?? null,
        financial_validation_decision_safe: financialValidation?.decisionSafe ?? null,
        preflight_warnings: preflightWarnings,
        pdf_size_bytes: finalPdfBuffer.length,
        has_appendix: !!appendixQuoteId,
      },
    });

    return NextResponse.json({
      ok: true,
      snapshotId: snapshot.id,
      pdfSizeBytes: finalPdfBuffer.length,
      hasAppendix: !!appendixQuoteId,
      memoInputHash: memoNarrative?.input_hash ?? null,
      financialValidationStatus: financialValidation?.status ?? null,
      preflightWarnings: preflightWarnings.length > 0 ? preflightWarnings : undefined,
    });
  } catch (error: any) {
    rethrowNextErrors(error);

    console.error("[/api/deals/[dealId]/committee/packet/generate] Error:", error);

    // Observability: packet generation failed
    try {
      const { dealId } = await ctx.params;
      void writeEvent({
        dealId,
        kind: "packet.generation.failed",
        scope: "committee",
        action: "packet_generate",
        meta: { error: error?.message ?? "unknown" },
      });
    } catch {
      // Best-effort
    }

    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 }
    );
  }
}
