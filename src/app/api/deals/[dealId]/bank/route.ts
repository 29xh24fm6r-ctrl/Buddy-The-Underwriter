// src/app/api/deals/[dealId]/bank/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";
// route-class: CLERK (SPEC-SEC-1)

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    if (!dealId) {
      return NextResponse.json(
        { ok: false, error: "missing_dealId" },
        { status: 400 },
      );
    }

    // SPEC-SEC-1: enforce Clerk auth + bank-tenant access before returning
    // the bank record (full record was previously readable cross-tenant).
    await assertDealAccess(dealId);

    const supabase = getSupabaseServerClient();

    // Read bank_id directly from deals table (always exists by FK constraint)
    const { data: deal, error: e1 } = await supabase
      .from("deals")
      .select("bank_id")
      .eq("id", dealId)
      .single();

    if (e1) throw e1;
    if (!deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }

    // Load the bank record (guaranteed to exist by FK).
    // SPEC-SEC-1 §3.5: narrowed from select("*") to the fields the UI consumes
    // (BankDocsCard uses only bank_id; id/name cover any label use).
    const { data: bank, error: e2 } = await supabase
      .from("banks")
      .select("id, name")
      .eq("id", deal.bank_id)
      .single();

    if (e2) throw e2;

    return NextResponse.json({ ok: true, bank_id: deal.bank_id, bank });
  } catch (err: any) {
    const accessRes = accessErrorToResponse(err);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err ?? "unknown_error") },
      { status: 500 },
    );
  }
}
