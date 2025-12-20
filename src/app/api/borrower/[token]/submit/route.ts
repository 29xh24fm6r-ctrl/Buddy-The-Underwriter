import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { evaluateSba, type SbaProduct } from "@/lib/sba/evaluateSba";
import { computeAndPersistForDeal } from "@/lib/conditions/computeAndPersist";
import type { LoanProductType } from "@/lib/conditions/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { token } = await params;
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as any;
    const dealId = body?.dealId as string | undefined;
    if (!dealId) {
      return NextResponse.json({ ok: false, error: "Missing dealId" }, { status: 400 });
    }

    const answers = (body?.answers ?? {}) as Record<string, any>;

    // Map product selection from portal
    const product = (body?.product as LoanProductType) ?? "TERM";
    const isSba = product.startsWith("SBA_");
    const hasRealEstateCollateral = Boolean(body?.hasRealEstateCollateral ?? (product === "CRE" || product === "SBA_504"));

    // SBA product selection (optional)
    const sbaProduct: SbaProduct =
      (body?.sbaProduct as SbaProduct) ??
      (product === "SBA_504" ? "504" : product === "SBA_EXPRESS" ? "express" : "7a");

    const supabase = getSupabaseServerClient();

    // Log event
    await supabase.from("borrower_portal_events").insert([
      { token, deal_id: dealId, event_type: "submit", payload: { product, sbaProduct } },
    ]);

    // Evaluate + persist SBA eligibility snapshot
    const elig = evaluateSba({ product: sbaProduct, answers });

    await supabase.from("deal_sba_eligibility").insert([
      {
        deal_id: dealId,
        token,
        product: sbaProduct,
        status: elig.status,
        reasons: elig.reasons,
        signals: elig.signals,
      },
    ]);

    // Recompute conditions/missing docs (portal submit should immediately update banker UI)
    await computeAndPersistForDeal({
      supabase,
      dealId,
      product,
      hasRealEstateCollateral,
      isSba,
      presentDocKeys: Array.isArray(body?.presentDocKeys) ? body.presentDocKeys : [],
    });

    return NextResponse.json({ ok: true, dealId, token, eligibility: elig });
  } catch (e: any) {
    console.error("[borrower/submit] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "borrower_submit_failed" }, { status: 500 });
  }
}
