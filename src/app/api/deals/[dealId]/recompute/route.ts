import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { computeAndPersistForDeal } from "@/lib/conditions/computeAndPersist";
import type { LoanProductType } from "@/lib/conditions/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const body = await req.json().catch(() => ({}) as any);

    const product = (body?.product as LoanProductType) ?? "TERM";
    const hasRealEstateCollateral = Boolean(
      body?.hasRealEstateCollateral ?? product === "CRE",
    );
    const isSba = Boolean(body?.isSba ?? product.startsWith("SBA_"));

    // Optional: allow caller to pass what doc keys are present (until OCR/classify wires into this)
    const presentDocKeys = Array.isArray(body?.presentDocKeys)
      ? body.presentDocKeys
      : [];

    const supabase = getSupabaseServerClient();

    const res = await computeAndPersistForDeal({
      supabase,
      dealId,
      product,
      hasRealEstateCollateral,
      isSba,
      presentDocKeys,
    });

    return NextResponse.json({ ok: true, dealId, recomputed: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "recompute_failed" },
      { status: 500 },
    );
  }
}
