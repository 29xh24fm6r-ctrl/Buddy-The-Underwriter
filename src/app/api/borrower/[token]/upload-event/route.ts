import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { computeAndPersistForDeal } from "@/lib/conditions/computeAndPersist";
import type { LoanProductType } from "@/lib/conditions/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await ctx.params;
    const body = await req.json();

    const dealId = body?.dealId as string | undefined;
    if (!dealId)
      return NextResponse.json(
        { ok: false, error: "Missing dealId" },
        { status: 400 },
      );

    const product = (body?.product as LoanProductType) ?? "TERM";
    const hasRealEstateCollateral = Boolean(
      body?.hasRealEstateCollateral ?? product === "CRE",
    );
    const isSba = Boolean(body?.isSba ?? product.startsWith("SBA_"));

    const presentDocKeys = Array.isArray(body?.presentDocKeys)
      ? body.presentDocKeys
      : [];

    const supabase = getSupabaseServerClient();

    await supabase
      .from("borrower_portal_events")
      .insert([
        {
          token,
          deal_id: dealId,
          event_type: "upload_completed",
          payload: body ?? null,
        },
      ]);

    await computeAndPersistForDeal({
      supabase,
      dealId,
      product,
      hasRealEstateCollateral,
      isSba,
      presentDocKeys,
    });

    return NextResponse.json({ ok: true, dealId, token });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "upload_event_failed" },
      { status: 500 },
    );
  }
}
