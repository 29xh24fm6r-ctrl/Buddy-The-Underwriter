// src/app/api/deals/[dealId]/checklist/reconcile/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { reconcileDealChecklist } from "@/lib/checklist/engine";

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
  try {
    const { dealId } = await ctx.params;

    // Tenant enforcement
    const ensured = await ensureDealBankAccess(dealId);
    if (!ensured.ok) {
      const statusCode = 
        ensured.error === "deal_not_found" ? 404 :
        ensured.error === "tenant_mismatch" ? 403 :
        400;
      
      return NextResponse.json(
        { ok: false, error: ensured.error },
        { status: statusCode }
      );
    }

    const r = await reconcileDealChecklist(dealId);

    return NextResponse.json({
      ...r,
    });

  } catch (e: any) {
    console.error("[checklist/reconcile] error:", e);
    return NextResponse.json(
      { 
        ok: false, 
        error: e?.message || "Failed to reconcile checklist",
      },
      { status: 500 }
    );
  }
}
