import "server-only";

/**
 * POST /api/deals/[dealId]/credit-memo/canonical/pdf
 *
 * Generates a PDF of the canonical credit memo using PDFKit (pure Node.js).
 * Replaces the previous Playwright/Chromium approach which fails on Vercel serverless.
 *
 * SPEC — Florida Armory Snapshot Is The Only Committee Source Of Truth:
 * - This route MUST NOT call buildCanonicalCreditMemo directly.
 * - The PDF is rendered from the latest certified Florida Armory snapshot in
 *   credit_memo_snapshots (status='banker_submitted'), via
 *   loadLatestCertifiedFloridaArmorySnapshot + assertCommitteeMemoSafe.
 * - buildCanonicalCreditMemo remains valid for diagnostic / draft / pre-submission
 *   surfaces, but cannot generate final committee PDFs.
 * - TODO: long-term, replace this route with
 *   /api/deals/[dealId]/credit-memo/snapshots/latest/pdf
 *   and render the PDF from snapshot.sections directly. This is the interim
 *   safe bridge that still uses snapshot.canonical_memo for the body but
 *   only after the committee-artifact guard passes.
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadLatestCertifiedFloridaArmorySnapshot } from "@/lib/creditMemo/snapshot/loadLatestCertifiedSnapshot";
import {
  assertCommitteeMemoSafe,
} from "@/lib/creditMemo/snapshot/assertCommitteeMemoSafe";
import { FloridaArmoryBuildError } from "@/lib/creditMemo/snapshot/types";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { LedgerEventType } from "@/buddy/lifecycle/events";
import { buildCreditMemoPdf } from "@/lib/creditMemo/pdf/buildCreditMemoPdf";
import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ── Route handlers ────────────────────────────────────────────────────────────

async function handlePdfRequest(dealId: string) {
  try {
    await requireDealAccess(dealId);
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) {
      return NextResponse.json({ ok: false, error: "no_bank_selected" }, { status: 401 });
    }

    // Phase 81: Trust enforcement — PDF export requires committee-grade research.
    const { loadAndEnforceResearchTrust } = await import("@/lib/research/trustEnforcement");
    const trustCheck = await loadAndEnforceResearchTrust(dealId, "committee_packet");
    if (!trustCheck.allowed) {
      return NextResponse.json(
        { ok: false, error: trustCheck.reason },
        { status: 400 },
      );
    }

    // ── SPEC: ONLY render from the latest certified Florida Armory snapshot.
    // We do NOT call buildCanonicalCreditMemo here — that path is reserved for
    // diagnostic / draft / pre-submission surfaces. Committee artifacts MUST
    // pass through the snapshot + hard-gate pipeline.
    const snapshotRes = await loadLatestCertifiedFloridaArmorySnapshot({
      dealId,
      bankId: bankPick.bankId,
    });
    if (!snapshotRes.ok) {
      if (snapshotRes.reason === "not_found") {
        return NextResponse.json(
          {
            ok: false,
            error: "certified_snapshot_required",
            message:
              "Submit the credit memo to underwriting before generating a committee PDF.",
          },
          { status: 409 },
        );
      }
      // load_failed → internal failure surface (don't leak details)
      console.error("[canonical/pdf] snapshot load_failed:", snapshotRes.error);
      return NextResponse.json(
        { ok: false, error: "snapshot_load_failed" },
        { status: 500 },
      );
    }

    // Final artifact guard: refuse to render unsafe committee memos.
    try {
      assertCommitteeMemoSafe(snapshotRes.snapshot);
    } catch (guardErr: unknown) {
      if (guardErr instanceof FloridaArmoryBuildError) {
        // A row that was ALREADY certified (assertCommitteeMemoSafe passed
        // at submission time, per buildFloridaArmorySnapshot.ts) is failing
        // the SAME check again at render time — either the guard's logic
        // changed after this row was certified, or the stored snapshot was
        // corrupted. Either way it's a real anomaly worth surfacing, not
        // routine "not certified yet" behavior (that's the not_found branch
        // above, which returns before reaching here).
        Sentry.captureMessage("certified committee memo failed re-verification at PDF render", {
          level: "error",
          tags: { route: "canonical/pdf", rejection_source: "assertCommitteeMemoSafe_pre_overlay" },
          extra: { dealId, missingFields: guardErr.missingFields },
        });
        void writeEvent({
          dealId,
          kind: LedgerEventType.committee_artifact_rejected,
          input: { trigger: "pdf_render", rejection_source: "assertCommitteeMemoSafe_pre_overlay" },
          output: { missing_fields: guardErr.missingFields },
        }).catch(() => {});
        return NextResponse.json(
          {
            ok: false,
            error: "committee_artifact_unsafe",
            details: guardErr.missingFields,
          },
          { status: 409 },
        );
      }
      throw guardErr;
    }

    const snapshot = snapshotRes.snapshot;
    // Interim safe bridge: render the committee PDF from the certified
    // snapshot's canonical_memo body. The snapshot is now guaranteed
    // committee-safe by assertCommitteeMemoSafe above. The longer-term path
    // (separate route + render from snapshot.sections) is captured by the
    // TODO in the file header.
    const memoFromSnapshot: CanonicalCreditMemoV1 = snapshot.canonical_memo;

    // SPEC-PDF-NARRATIVE-OVERLAY-1: overlay cached narratives (same logic as canonical/page.tsx).
    // The prior version of this overlay was gated on NOTHING but "most recent
    // row for this deal+bank" — the exact staleness bug already fixed in
    // narrativeAssembly.ts (H2): a narrative generated against older inputs
    // could silently overlay onto a certified snapshot describing NEWER
    // (corrected) numbers. Worse here specifically: this snapshot already
    // passed assertCommitteeMemoSafe above, but the overlay ran AFTER that
    // check, so the actual PDF content was never re-verified. Fixed by (1)
    // only overlaying a narrative whose input_hash matches this exact
    // certified snapshot's input_hash — i.e. it was computed from the same
    // frozen inputs, not a different (older/newer) recompute — and (2)
    // re-running assertCommitteeMemoSafe on the fully composed object so
    // whatever text actually reaches the renderer is what was checked.
    const memoForRender: CanonicalCreditMemoV1 = {
      ...memoFromSnapshot,
      executive_summary: { ...memoFromSnapshot.executive_summary },
      financial_analysis: { ...memoFromSnapshot.financial_analysis },
      collateral: { ...memoFromSnapshot.collateral },
      borrower_sponsor: { ...memoFromSnapshot.borrower_sponsor },
    };
    {
      const sb = supabaseAdmin();
      const snapshotInputHash = (snapshot.meta as any)?.input_hash ?? null;
      const { data: cachedNarrative } = await (sb as any)
        .from("canonical_memo_narratives")
        .select("narratives")
        .eq("deal_id", dealId)
        .eq("bank_id", bankPick.bankId)
        .eq("input_hash", snapshotInputHash)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (snapshotInputHash && cachedNarrative?.narratives) {
        const n = cachedNarrative.narratives as any;
        if (n.executive_summary) memoForRender.executive_summary.narrative = n.executive_summary;
        if (n.income_analysis) memoForRender.financial_analysis.income_analysis = n.income_analysis;
        if (n.property_description) memoForRender.collateral.property_description = n.property_description;
        if (n.borrower_background) memoForRender.borrower_sponsor.background = n.borrower_background;
        if (n.borrower_experience) memoForRender.borrower_sponsor.experience = n.borrower_experience;
        if (n.guarantor_strength) memoForRender.borrower_sponsor.guarantor_strength = n.guarantor_strength;
        if (n.repayment_analysis) memoForRender.financial_analysis.projection_feasibility = n.repayment_analysis;
      }
    }

    // Re-verify the ACTUAL composed content that will render, not just the
    // pre-overlay snapshot — closes the gap where an overlay could otherwise
    // reintroduce a placeholder/warning-marker string with no safety check
    // ever seeing it.
    try {
      assertCommitteeMemoSafe({ ...snapshot, canonical_memo: memoForRender });
    } catch (guardErr: unknown) {
      if (guardErr instanceof FloridaArmoryBuildError) {
        // This memo passed the pre-overlay guard above but failed AFTER the
        // narrative overlay was applied — i.e. the overlay reintroduced a
        // forbidden placeholder/contradiction into a snapshot that was
        // certified safe. This is the specific bug class H2/SPEC-PDF-
        // NARRATIVE-OVERLAY-1 hardening was meant to close; a rejection here
        // means the overlay path itself needs investigation, not the
        // underlying certified snapshot.
        Sentry.captureMessage("narrative overlay reintroduced unsafe content into a certified committee memo", {
          level: "error",
          tags: { route: "canonical/pdf", rejection_source: "assertCommitteeMemoSafe_post_overlay" },
          extra: { dealId, missingFields: guardErr.missingFields },
        });
        void writeEvent({
          dealId,
          kind: LedgerEventType.committee_artifact_rejected,
          input: { trigger: "pdf_render", rejection_source: "assertCommitteeMemoSafe_post_overlay" },
          output: { missing_fields: guardErr.missingFields },
        }).catch(() => {});
        return NextResponse.json(
          {
            ok: false,
            error: "committee_artifact_unsafe",
            details: guardErr.missingFields,
          },
          { status: 409 },
        );
      }
      throw guardErr;
    }

    const pdfBuffer = await buildCreditMemoPdf(memoForRender);

    const borrowerSlug = (memoForRender.header.borrower_name ?? dealId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);

    // CI-RESTORE 2026-04-24: wrap Node Buffer in Uint8Array to satisfy BodyInit.
    // Node 22's @types/node narrowed Buffer to Buffer<ArrayBufferLike>, which
    // no longer matches BodyInit's union. Uint8Array is part of BodyInit and
    // shares the underlying bytes (no copy), so this is a zero-cost widening.
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="credit-memo-${borrowerSlug}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err: unknown) {
    rethrowNextErrors(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[canonical/pdf] Error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  return handlePdfRequest(dealId);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  return handlePdfRequest(dealId);
}
