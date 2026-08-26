import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";
import { computeAndPersistForDeal } from "@/lib/conditions/computeAndPersist";
import type { LoanProductType } from "@/lib/conditions/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const dealId = body?.dealId as string | undefined;
  if (!dealId) {
    return NextResponse.json(
      { ok: false, error: "missing_deal_id" },
      { status: 400 },
    );
  }

  let resolved;
  try {
    resolved = await resolveBorrowerToken(token);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_borrower_link" },
      { status: 403 },
    );
  }

  if (String(resolved.deal_id) !== String(dealId)) {
    return NextResponse.json(
      { ok: false, error: "borrower_link_deal_mismatch" },
      { status: 403 },
    );
  }

  try {
    const product = (body?.product as LoanProductType) ?? "TERM";
    const hasRealEstateCollateral = Boolean(
      body?.hasRealEstateCollateral ?? product === "CRE",
    );
    const isSba = Boolean(body?.isSba ?? product.startsWith("SBA_"));
    const presentDocKeys = Array.isArray(body?.presentDocKeys)
      ? body.presentDocKeys
      : [];

    const supabase = supabaseAdmin();
    const eventResult = await supabase.from("borrower_portal_events").insert([
      {
        token,
        deal_id: dealId,
        event_type: "upload_completed",
        payload: body ?? null,
      },
    ]);
    if (eventResult.error) throw eventResult.error;

    await computeAndPersistForDeal({
      supabase,
      dealId,
      product,
      hasRealEstateCollateral,
      isSba,
      presentDocKeys,
    });

    return NextResponse.json({ ok: true, dealId, token });
  } catch (error) {
    console.error("[borrower upload event] persistence failed", {
      dealId,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: "upload_event_failed" },
      { status: 500 },
    );
  }
}
