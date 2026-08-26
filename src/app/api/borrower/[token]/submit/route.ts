import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";
import { evaluateSba, type SbaProduct } from "@/lib/sba/evaluateSba";
import { computeAndPersistForDeal } from "@/lib/conditions/computeAndPersist";
import type { LoanProductType } from "@/lib/conditions/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "missing_token" },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as any;
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
    const answers = (body?.answers ?? {}) as Record<string, any>;
    const product = (body?.product as LoanProductType) ?? "TERM";
    const isSba = product.startsWith("SBA_");
    const hasRealEstateCollateral = Boolean(
      body?.hasRealEstateCollateral ??
        (product === "CRE" || product === "SBA_504"),
    );
    const sbaProduct: SbaProduct =
      (body?.sbaProduct as SbaProduct) ??
      (product === "SBA_504"
        ? "504"
        : product === "SBA_EXPRESS"
          ? "express"
          : "7a");

    const supabase = supabaseAdmin();
    const eventResult = await supabase.from("borrower_portal_events").insert([
      {
        token,
        deal_id: dealId,
        event_type: "submit",
        payload: { product, sbaProduct },
      },
    ]);
    if (eventResult.error) throw eventResult.error;

    const eligibility = evaluateSba({ product: sbaProduct, answers });
    const eligibilityResult = await supabase
      .from("deal_sba_eligibility")
      .insert([
        {
          deal_id: dealId,
          token,
          product: sbaProduct,
          status: eligibility.status,
          reasons: eligibility.reasons,
          signals: eligibility.signals,
        },
      ]);
    if (eligibilityResult.error) throw eligibilityResult.error;

    await computeAndPersistForDeal({
      supabase,
      dealId,
      product,
      hasRealEstateCollateral,
      isSba,
      presentDocKeys: Array.isArray(body?.presentDocKeys)
        ? body.presentDocKeys
        : [],
    });

    return NextResponse.json({
      ok: true,
      dealId,
      token,
      eligibility,
    });
  } catch (error) {
    console.error("[borrower submit] persistence failed", {
      dealId,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: "borrower_submit_failed" },
      { status: 500 },
    );
  }
}
