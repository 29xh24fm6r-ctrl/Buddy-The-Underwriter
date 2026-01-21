import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { reconcileUploadsForDeal } from "@/lib/documents/reconcileUploads";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { normalizeGoogleError } from "@/lib/google/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/uploads/reconcile
 *
 * Reconcile borrower_uploads into deal_documents and update checklist state.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const tracer = trace.getTracer("api.uploads-reconcile");
  return await tracer.startActiveSpan("uploads.reconcile.POST", async (span) => {
    try {
      const { dealId } = await ctx.params;

      const ensured = await ensureDealBankAccess(dealId);
      if (!ensured.ok) {
        const statusCode =
          ensured.error === "deal_not_found" ? 404 :
          ensured.error === "tenant_mismatch" ? 403 :
          400;
        span.setStatus({ code: SpanStatusCode.ERROR });
        return NextResponse.json({ ok: false, error: ensured.error }, { status: statusCode });
      }

      const result = await reconcileUploadsForDeal(dealId, ensured.bankId);

      await logLedgerEvent({
        dealId,
        bankId: ensured.bankId,
        eventKey: "deal.uploads.reconciled",
        uiState: "done",
        uiMessage: `Uploads reconciled (${result.matched})`,
        meta: { matched: result.matched },
      });

      span.setStatus({ code: SpanStatusCode.OK });
      return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
      const normalized = normalizeGoogleError(e);
      span.recordException(e);
      span.setStatus({ code: SpanStatusCode.ERROR });
      return NextResponse.json(
        { ok: false, error: normalized.code, message: normalized.message },
        { status: 500 },
      );
    } finally {
      span.end();
    }
  });
}
