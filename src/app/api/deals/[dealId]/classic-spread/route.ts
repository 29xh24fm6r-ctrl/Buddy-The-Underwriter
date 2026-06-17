import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadClassicSpreadData } from "@/lib/classicSpread/classicSpreadLoader";
import { renderClassicSpread } from "@/lib/classicSpread/classicSpreadRenderer";
import { generateSpreadNarrative } from "@/lib/classicSpread/narrativeEngine";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { preflightClassicSpread } from "@/lib/spreads/preflight/spreadPreflight";
import { CLASSIC_PDF_RENDER_VERSION } from "@/lib/classicSpread/classicPdfRenderVersion";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import type { ClassicPdfCachedPayload } from "@/lib/classicSpread/classicPdfWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const bankId = (access as any).bankId as string;

    // SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 #8: run the cash-flow aggregator + snapshot
    // rebuild BEFORE loading the spread, so the rendered/cached PDF reflects the post-bridge facts.
    // (Previously these mutated facts AFTER render but before cache → a cached PDF that did not
    // reflect the very facts the bridge produced.) Non-fatal: the PDF still renders on bridge error.
    try {
      const { runCashFlowAggregator } = await import(
        "@/lib/financialFacts/runCashFlowAggregator"
      );
      const aggregatorResult = await runCashFlowAggregator({ dealId, bankId });
      if (!aggregatorResult.ok) {
        console.warn(
          "[classic-spread] aggregator returned non-ok (non-fatal):",
          aggregatorResult.reason,
          aggregatorResult.detail ?? "",
        );
      }

      // Always build + persist snapshot from whatever facts exist — not gated on ADS
      const { buildDealFinancialSnapshotForBank } = await import("@/lib/deals/financialSnapshot");
      const { persistFinancialSnapshot } = await import("@/lib/deals/financialSnapshotPersistence");
      const freshSnapshot = await buildDealFinancialSnapshotForBank({ dealId, bankId });
      await persistFinancialSnapshot({ dealId, bankId, snapshot: freshSnapshot });
    } catch (bridgeErr: any) {
      console.warn("[classic-spread] bridge persist failed (non-fatal):", bridgeErr?.message);
    }

    // Load AFTER the bridge so the spread reflects the just-written aggregator facts (#8), bank-scoped (#1).
    const input = await loadClassicSpreadData(dealId, bankId);

    // P0b preflight gate: if balance-sheet or income-statement rows are empty,
    // the renderer would emit "data not available" placeholders ("PENDING
    // AUTOFILL"-class output). Block PDF generation and return a structured
    // blocker instead. Fires spread.preflight.blocked to deal_events for
    // observability.
    const preflight = await preflightClassicSpread({
      dealId,
      bankId,
      balanceSheetRowCount: input.balanceSheet.length,
      incomeStatementRowCount: input.incomeStatement.length,
    });
    if (preflight.status === "blocked") {
      return NextResponse.json(
        {
          status: "blocked",
          reason: preflight.reason,
          missingFacts: preflight.missingFacts,
          sourceDocuments: preflight.sourceDocuments,
          message: preflight.userMessage,
        },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }

    // Narrative is optional — graceful fallback if API key missing or call fails
    const narrative = await generateSpreadNarrative(input).catch(() => null);
    const pdf = await renderClassicSpread(input, narrative);

    // SPEC-B3 cache shim: persist the just-generated PDF to deal_spreads so
    // the /cached endpoint can serve it without re-rendering. The bridge that mutates facts ran
    // BEFORE the load above (#8), so this cached blob reflects post-bridge facts.
    try {
      const pdfSha256 = createHash("sha256").update(pdf).digest("hex");
      const generatedAt = new Date().toISOString();

      // Get latest facts timestamp for staleness comparison
      const sb = supabaseAdmin();
      const { data: latestFact } = await (sb as any)
        .from("deal_financial_facts")
        .select("updated_at")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const cachePayload: ClassicPdfCachedPayload = {
        pdf_base64: Buffer.from(pdf).toString("base64"),
        pdf_sha256: pdfSha256,
        pdf_size_bytes: pdf.length,
        canonicalFactsTimestamp: latestFact?.updated_at ?? null,
        generatedAt,
        renderVersion: CLASSIC_PDF_RENDER_VERSION,
        certificationAudit: input.certificationAudit ?? null,
      };

      await (sb as any)
        .from("deal_spreads")
        .upsert(
          {
            deal_id: dealId,
            bank_id: bankId,
            spread_type: "CLASSIC_PDF",
            spread_version: 1,
            owner_type: "DEAL",
            owner_entity_id: SENTINEL_UUID,
            status: "ready",
            inputs_hash: null,
            rendered_json: cachePayload,
            rendered_html: null,
            rendered_csv: null,
            error: null,
            error_code: null,
            finished_at: generatedAt,
            updated_at: generatedAt,
          },
          { onConflict: "deal_id,bank_id,spread_type,spread_version,owner_type,owner_entity_id" } as any,
        );
    } catch (cacheErr: any) {
      // Non-fatal — the PDF is already generated, cache is supplemental
      console.warn("[classic-spread] cache shim failed (non-fatal):", cacheErr?.message);
    }

    // BUGFIX-CLASSIC-SPREAD-2022-SCHEDULE-L-BALANCE-PARITY-1 (review-action sync requirement): keep the
    // review-actions table in lock-step with the PDF the SAME regenerate cycle produced — so a fresh
    // blocker (e.g. the 2022 balance imbalance) shows in the panel immediately and the panel can never
    // read fewer open blockers than the PDF audit. Idempotent upsert + stale-prune; never auto-decides.
    try {
      const { buildClassicSpreadReviewActions } = await import("@/lib/classicSpread/review/buildReviewActions");
      const { syncReviewActions } = await import("@/lib/classicSpread/review/reviewActionsRepo");
      const audit = input.certificationAudit?.spreadAccuracy ?? null;
      const actions = buildClassicSpreadReviewActions(audit, input.periods);
      await syncReviewActions({ dealId, bankId, actions });
    } catch (syncErr: any) {
      // Non-fatal — the PDF + cache already succeeded; the panel's manual "Sync" remains a fallback.
      console.warn("[classic-spread] review-action sync failed (non-fatal):", syncErr?.message);
    }

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="FinancialSpread_${dealId.slice(0, 8)}.pdf"`,
      },
    });
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[classic-spread] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
