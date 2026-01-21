// src/app/api/deals/[dealId]/checklist/reconcile/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { reconcileDealChecklist } from "@/lib/checklist/engine";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { normalizeGoogleError } from "@/lib/google/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 🔥 CHECKLIST RECONCILIATION ENDPOINT
 * 
 * Backfills received_at for checklist items where matching docs exist.
 * Useful for:
 * - Documents uploaded BEFORE checklist seeded
 * - Checklist keys stamped after initial upload
 * - Manual reconciliation after auto-match runs
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  const tracer = trace.getTracer("api.checklist-reconcile");
  return await tracer.startActiveSpan("checklist.reconcile.POST", async (span) => {
    try {
      const { dealId } = await ctx.params;

    // Tenant enforcement
    const ensured = await ensureDealBankAccess(dealId);
      if (!ensured.ok) {
        const statusCode =
          ensured.error === "deal_not_found" ? 404 :
          ensured.error === "tenant_mismatch" ? 403 :
          400;

        span.setStatus({ code: SpanStatusCode.ERROR });
        return NextResponse.json(
          { ok: false, error: ensured.error },
          { status: statusCode }
        );
      }

      const r = await reconcileDealChecklist(dealId);

      await logLedgerEvent({
        dealId,
        bankId: ensured.bankId,
        eventKey: "deal.checklist.reconciled",
        uiState: "done",
        uiMessage: "Checklist reconciled",
        meta: { updated: (r as any)?.updated ?? null },
      });

      span.setStatus({ code: SpanStatusCode.OK });
      return NextResponse.json({
        ...r,
      });

    } catch (e: any) {
      const normalized = normalizeGoogleError(e);
      console.error("[checklist/reconcile] error:", e);
      span.recordException(e);
      span.setStatus({ code: SpanStatusCode.ERROR });
      return NextResponse.json(
        { 
          ok: false, 
          error: normalized.code,
          message: normalized.message,
        },
        { status: 500 }
      );
    } finally {
      span.end();
    }
  });
}
