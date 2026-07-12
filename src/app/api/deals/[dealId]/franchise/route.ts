import "server-only";

// src/app/api/deals/[dealId]/franchise/route.ts
// Reads and writes the deal_franchises link (deal -> franchise_brands).
// This is the write path that activates isFranchise in both the
// feasibility engine and the buddySbaScore pipeline — see
// deal_franchises table comment for context.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { seedFranchiseChecklist } from "@/lib/franchise/seedFranchiseChecklist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
// route-class: CLERK (SPEC-SEC-1)

type Params = Promise<{ dealId: string }>;

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    await assertDealAccess(dealId);

    const sb = supabaseAdmin();
    const { data: link } = await sb
      .from("deal_franchises")
      .select("brand_id")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (!link?.brand_id) {
      return NextResponse.json({ ok: true, brandId: null, brandName: null });
    }

    const { data: brand } = await sb
      .from("franchise_brands")
      .select("brand_name")
      .eq("id", link.brand_id)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      brandId: link.brand_id,
      brandName: brand?.brand_name ?? null,
    });
  } catch (error) {
    rethrowNextErrors(error);
    const accessRes = accessErrorToResponse(error);
    if (accessRes) return accessRes;
    console.error("[GET /api/deals/[dealId]/franchise]", error);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const body = await req.json().catch(() => ({}));
    const brandId = typeof body?.brand_id === "string" ? body.brand_id.trim() : null;
    if (!brandId) {
      return NextResponse.json({ ok: false, error: "brand_id_required" }, { status: 400 });
    }

    const access = await assertDealAccess(dealId);

    const sb = supabaseAdmin();

    // Validate the brand actually exists before linking — avoids orphaned
    // links from a stale client-side selection.
    const { data: brand, error: brandErr } = await sb
      .from("franchise_brands")
      .select("id, brand_name")
      .eq("id", brandId)
      .eq("canonical", true)
      .maybeSingle();

    if (brandErr || !brand) {
      return NextResponse.json({ ok: false, error: "brand_not_found" }, { status: 404 });
    }

    const { error: upsertErr } = await sb
      .from("deal_franchises")
      .upsert(
        { deal_id: dealId, brand_id: brand.id, updated_at: new Date().toISOString() },
        { onConflict: "deal_id" },
      );

    if (upsertErr) {
      console.error("[PATCH /api/deals/[dealId]/franchise]", upsertErr);
      return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
    }

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "deal.franchise_linked",
      uiState: "done",
      uiMessage: `Franchise brand set: ${brand.brand_name}`,
      meta: { deal_id: dealId, brand_id: brand.id, brand_name: brand.brand_name },
    });

    await seedFranchiseChecklist(sb, { dealId, bankId: access.bankId, brandName: brand.brand_name });

    return NextResponse.json({ ok: true, brandId: brand.id, brandName: brand.brand_name });
  } catch (error) {
    rethrowNextErrors(error);
    const accessRes = accessErrorToResponse(error);
    if (accessRes) return accessRes;
    console.error("[PATCH /api/deals/[dealId]/franchise]", error);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await assertDealAccess(dealId);

    const sb = supabaseAdmin();
    const { error } = await sb.from("deal_franchises").delete().eq("deal_id", dealId);

    if (error) {
      console.error("[DELETE /api/deals/[dealId]/franchise]", error);
      return NextResponse.json({ ok: false, error: "delete_failed" }, { status: 500 });
    }

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "deal.franchise_unlinked",
      uiState: "done",
      uiMessage: "Franchise brand unlinked",
      meta: { deal_id: dealId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    rethrowNextErrors(error);
    const accessRes = accessErrorToResponse(error);
    if (accessRes) return accessRes;
    console.error("[DELETE /api/deals/[dealId]/franchise]", error);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
