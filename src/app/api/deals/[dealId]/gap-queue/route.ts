import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeDealGaps, REQUIRED_FACT_KEYS } from "@/lib/gapEngine/computeDealGaps";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const sb = supabaseAdmin();
    const { data: gaps } = await sb
      .from("deal_gap_queue")
      .select("*")
      .eq("deal_id", dealId)
      .eq("bank_id", bankPick.bankId)
      .eq("status", "open")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });

    // Completeness score: (required facts confirmed / total required facts) * 100
    const { data: confirmedFacts } = await sb
      .from("deal_financial_facts")
      .select("fact_key")
      .eq("deal_id", dealId)
      .eq("bank_id", bankPick.bankId)
      .eq("resolution_status", "confirmed")
      .eq("is_superseded", false);

    const totalRequired = REQUIRED_FACT_KEYS.length;
    const confirmedRequired = (confirmedFacts ?? []).length;
    const completenessScore = Math.round((confirmedRequired / totalRequired) * 100);

    return NextResponse.json({
      ok: true,
      gaps: gaps ?? [],
      openCount: (gaps ?? []).length,
      completenessScore,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// POST — trigger gap recompute
export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const result = await computeDealGaps({ dealId, bankId: bankPick.bankId });
    return NextResponse.json(result);
  } catch (e: unknown) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
