import "server-only";

// src/app/api/brokerage/franchise/route.ts
// Borrower-facing counterpart to /api/deals/[dealId]/franchise. That route
// is Clerk-gated (bank staff only); this one is gated by the
// buddy_borrower_session cookie, matching every other borrower-facing
// mutation under /api/brokerage/*. Same underlying deal_franchises table.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSessionFromRequest } from "@/lib/brokerage/session";
import { checkConciergeRateLimit } from "@/lib/brokerage/rateLimits";
import { seedFranchiseChecklist } from "@/lib/franchise/seedFranchiseChecklist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await getBorrowerSessionFromRequest();
  if (!session) {
    return NextResponse.json({ ok: false, error: "no_borrower_session" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: link } = await sb
    .from("deal_franchises")
    .select("brand_id")
    .eq("deal_id", session.deal_id)
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
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const session = await getBorrowerSessionFromRequest();
  if (!session) {
    return NextResponse.json({ ok: false, error: "no_borrower_session" }, { status: 401 });
  }

  const rl = await checkConciergeRateLimit({ tokenHash: session.tokenHash });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: rl.retryAfterSeconds ? { "Retry-After": String(rl.retryAfterSeconds) } : {} },
    );
  }

  const body = await req.json().catch(() => ({}));
  const brandId = typeof body?.brand_id === "string" ? body.brand_id.trim() : null;
  if (!brandId) {
    return NextResponse.json({ ok: false, error: "brand_id_required" }, { status: 400 });
  }

  const sb = supabaseAdmin();

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
      { deal_id: session.deal_id, brand_id: brand.id, updated_at: new Date().toISOString() },
      { onConflict: "deal_id" },
    );

  if (upsertErr) {
    console.error("[PATCH /api/brokerage/franchise]", upsertErr);
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  }

  await seedFranchiseChecklist(sb, {
    dealId: session.deal_id,
    bankId: session.bank_id,
    brandName: brand.brand_name,
  });

  try {
    await sb.from("ai_events").insert({
      deal_id: session.deal_id,
      scope: "brokerage_intake",
      action: "franchise_brand_selected",
      input_json: { brand_id: brand.id },
      output_json: { brand_name: brand.brand_name },
      confidence: 1,
      requires_human_review: false,
    });
  } catch {
    // Non-fatal audit write.
  }

  return NextResponse.json({ ok: true, brandId: brand.id, brandName: brand.brand_name });
}

export async function DELETE(): Promise<NextResponse> {
  const session = await getBorrowerSessionFromRequest();
  if (!session) {
    return NextResponse.json({ ok: false, error: "no_borrower_session" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("deal_franchises")
    .delete()
    .eq("deal_id", session.deal_id);

  if (error) {
    console.error("[DELETE /api/brokerage/franchise]", error);
    return NextResponse.json({ ok: false, error: "delete_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
