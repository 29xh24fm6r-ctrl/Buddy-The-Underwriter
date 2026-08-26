import { NextResponse } from "next/server";
import { computeAndPersistForDeal } from "@/lib/conditions/computeAndPersist";
import type { LoanProductType } from "@/lib/conditions/rules";
import { resolveDealApiContext } from "@/lib/server/dealApiContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const access = await resolveDealApiContext(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  }

  try {
    const body = await req.json().catch(() => ({}) as any);
    const product = (body?.product as LoanProductType) ?? "TERM";
    const hasRealEstateCollateral = Boolean(
      body?.hasRealEstateCollateral ?? product === "CRE",
    );
    const isSba = Boolean(body?.isSba ?? product.startsWith("SBA_"));
    const presentDocKeys = Array.isArray(body?.presentDocKeys)
      ? body.presentDocKeys
      : [];

    await computeAndPersistForDeal({
      supabase: access.sb,
      dealId,
      product,
      hasRealEstateCollateral,
      isSba,
      presentDocKeys,
    });

    return NextResponse.json({ ok: true, dealId, recomputed: true });
  } catch (error) {
    console.error("[deal recompute] failed", {
      dealId,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: "recompute_failed" },
      { status: 500 },
    );
  }
}
