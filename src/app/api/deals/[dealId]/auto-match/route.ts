import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { reconcileUploadsForDeal } from "@/lib/documents/reconcileUploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;

    const ensured = await ensureDealBankAccess(dealId);
    if (!ensured.ok) {
      const statusCode =
        ensured.error === "deal_not_found" ? 404 :
        ensured.error === "tenant_mismatch" ? 403 :
        401;

      return NextResponse.json(
        { ok: false, error: ensured.error },
        { status: statusCode },
      );
    }

    const result = await reconcileUploadsForDeal(dealId, ensured.bankId);

    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[auto-match] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to auto-match" },
      { status: 500 },
    );
  }
}
