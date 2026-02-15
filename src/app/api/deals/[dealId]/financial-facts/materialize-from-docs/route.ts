import "server-only";

import { NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { materializeFactsFromArtifacts } from "@/lib/financialFacts/materializeFactsFromArtifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/financial-facts/materialize-from-docs
 *
 * Creates anchoring SOURCE_DOCUMENT facts from classified deal_documents.
 * Pure DB writes — no OCR, no paid API calls.
 * Used to unblock snapshot recompute when spreads-based backfill yields 0 facts.
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
      eventKey: "facts.materialization.from_docs.manual_triggered",
      uiState: "working",
      uiMessage: "Manual anchor-fact materialization from classified documents",
    }).catch(() => {});

    const result = await materializeFactsFromArtifacts({
      dealId,
      bankId: access.bankId,
    });

    if (!result.ok) {
      logLedgerEvent({
        dealId,
        bankId: access.bankId,
        eventKey: "facts.materialization.from_docs.failed",
        uiState: "error",
        uiMessage: `Anchor-fact materialization failed: ${(result as any).error}`,
        meta: { error: (result as any).error, trigger: "manual" },
      }).catch(() => {});

      return NextResponse.json(
        { ok: false, error: (result as any).error },
        { status: 500 },
      );
    }

    logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "facts.materialization.from_docs.completed",
      uiState: "done",
      uiMessage: `${result.factsWritten} anchor fact(s) materialized from classified documents`,
      meta: {
        factsWritten: result.factsWritten,
        docsConsidered: result.docsConsidered,
        trigger: "manual",
      },
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      deal_id: dealId,
      factsWritten: result.factsWritten,
      docsConsidered: result.docsConsidered,
    });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[materialize-from-docs]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
