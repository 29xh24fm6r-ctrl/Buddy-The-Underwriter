import "server-only";

import { NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { extractFactsFromClassifiedArtifacts } from "@/lib/financialFacts/extractFactsFromClassifiedArtifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // Allow up to 2 min for AI extraction

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/financial-facts/extract-from-classified
 *
 * Runs AI-powered extraction on classified document artifacts that haven't
 * been extracted yet. Writes real financial facts (not just anchors).
 * Also runs canonical fact backfill from any existing spreads.
 */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "facts.extraction.from_artifacts.started",
      uiState: "working",
      uiMessage: "Extracting financial facts from classified documents",
    }).catch(() => {});

    const result = await extractFactsFromClassifiedArtifacts({
      dealId,
      bankId: access.bankId,
    });

    if (!result.ok) {
      logLedgerEvent({
        dealId,
        bankId: access.bankId,
        eventKey: "facts.extraction.from_artifacts.failed",
        uiState: "error",
        uiMessage: `Fact extraction failed: ${result.error}`,
        meta: { error: result.error },
      }).catch(() => {});

      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }

    logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "facts.extraction.from_artifacts.completed",
      uiState: "done",
      uiMessage: `Extracted facts from ${result.extracted} document(s), ${result.backfillFactsWritten} canonical facts backfilled`,
      meta: {
        extracted: result.extracted,
        skipped: result.skipped,
        failed: result.failed,
        backfillFactsWritten: result.backfillFactsWritten,
      },
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      deal_id: dealId,
      extracted: result.extracted,
      skipped: result.skipped,
      failed: result.failed,
      backfillFactsWritten: result.backfillFactsWritten,
      // compat: ReadinessPanel checks factsWritten > 0
      factsWritten: result.extracted + result.backfillFactsWritten,
    });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[extract-from-classified]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
