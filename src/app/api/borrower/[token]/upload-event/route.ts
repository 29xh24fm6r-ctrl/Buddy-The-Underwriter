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

    const bodyDealId = body?.dealId as string | undefined;
    if (!bodyDealId)
      return NextResponse.json(
        { ok: false, error: "Missing dealId" },
        { status: 400 },
      );

    const supabase = getSupabaseServerClient();

    // Previously `token` was never validated against anything — any
    // caller could mutate real deal condition state for an arbitrary
    // dealId. Resolve the deal from the token itself, the same way every
    // sibling route in this tree does, rather than trusting the body.
    const { data: application, error: appError } = await supabase
      .from("applications")
      .select("id, deal_id")
      .eq("access_token", token)
      .maybeSingle();

    if (appError || !application?.deal_id) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired token" },
        { status: 401 },
      );
    }

    if (application.deal_id !== bodyDealId) {
      return NextResponse.json(
        { ok: false, error: "Token does not match dealId" },
        { status: 403 },
      );
    }

    const dealId = bodyDealId;

    const product = (body?.product as LoanProductType) ?? "TERM";
    const hasRealEstateCollateral = Boolean(
      body?.hasRealEstateCollateral ?? product === "CRE",
    );
    const isSba = Boolean(body?.isSba ?? product.startsWith("SBA_"));

    const presentDocKeys = Array.isArray(body?.presentDocKeys)
      ? body.presentDocKeys
      : [];

    await supabase.from("borrower_portal_events").insert([
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
