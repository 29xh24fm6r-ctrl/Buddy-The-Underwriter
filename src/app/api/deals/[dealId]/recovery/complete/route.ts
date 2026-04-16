import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * Phase 83: Recovery validation gate.
 *
 * Called by IgniteWizard before research fires. Does NOT write data —
 * that happened per-step via borrower/update and recovery/principals.
 * Reads current DB state and returns whether required fields are present.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();

    // Read current state from DB — don't trust request body
    const [dealRes, overridesRes] = await Promise.all([
      (sb as any)
        .from("deals")
        .select("borrower_id")
        .eq("id", dealId)
        .maybeSingle(),
      (sb as any)
        .from("deal_memo_overrides")
        .select("overrides")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .maybeSingle(),
    ]);

    const overrides = (overridesRes.data?.overrides ?? {}) as Record<string, unknown>;

    let borrower: { naics_code: string | null; city: string | null; state: string | null } | null = null;
    if (dealRes.data?.borrower_id) {
      const { data: b } = await (sb as any)
        .from("borrowers")
        .select("naics_code, city, state")
        .eq("id", dealRes.data.borrower_id)
        .maybeSingle();
      borrower = b ?? null;
    }

    const hasNaics = !!borrower?.naics_code && borrower.naics_code !== "999999";
    const hasGeo = !!(borrower?.city?.trim() || borrower?.state?.trim());

    const validationErrors: string[] = [];
    if (!hasNaics) validationErrors.push("Industry code is still missing — complete the Industry step.");
    if (!hasGeo) validationErrors.push("Location is still missing — complete the Location step.");

    if (validationErrors.length > 0) {
      return NextResponse.json({ ok: false, validation_errors: validationErrors }, { status: 422 });
    }

    const hasDesc = typeof overrides.business_description === "string" &&
      (overrides.business_description as string).trim().length > 20;

    const actionsTaken: string[] = ["borrower_verified", "overrides_verified"];

    return NextResponse.json({
      ok: true,
      actions_taken: actionsTaken,
      next: {
        should_run_research: true,
        should_regenerate_memo: true,
        should_run_risk: false,
        has_business_description: hasDesc,
      },
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
