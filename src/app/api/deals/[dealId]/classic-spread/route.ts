import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadClassicSpreadData } from "@/lib/classicSpread/classicSpreadLoader";
import { renderClassicSpread } from "@/lib/classicSpread/classicSpreadRenderer";
import { generateSpreadNarrative } from "@/lib/classicSpread/narrativeEngine";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { preflightClassicSpread } from "@/lib/spreads/preflight/spreadPreflight";

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

    const input = await loadClassicSpreadData(dealId);
    const bankId = (access as any).bankId as string;

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

    // Bridge: persist computed debt service metrics → facts → snapshot.
    // Awaited before response — Vercel kills background promises on response send.
    // Non-fatal: PDF always returns regardless of bridge outcome.
    //
    // SPEC-FOUNDATION-V1-PR4-EXTRACT: the embedded compute logic that was
    // inline here is now extracted to runCashFlowAggregator. The route calls
    // the standalone module, then rebuilds the snapshot. Behavioral parity
    // with the pre-extraction code verified via PRECHECK on Samaritus
    // (DSCR 2.94, four facts written, commit ce262f37).
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
