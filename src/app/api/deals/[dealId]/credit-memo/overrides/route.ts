import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { filterQualitativeOverrides } from "@/lib/creditMemo/overridePolicy";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const rawOverrides = body?.overrides ?? {};

    // Enforce override policy — only qualitative narrative keys are accepted
    const { accepted, rejected } = filterQualitativeOverrides(rawOverrides);

    const sb = supabaseAdmin();
    const { error } = await sb
      .from("deal_memo_overrides")
      .upsert(
        { deal_id: dealId, bank_id: auth.bankId, overrides: accepted, updated_at: new Date().toISOString() },
        { onConflict: "deal_id,bank_id" },
      );

    if (error) throw error;

    return NextResponse.json({ ok: true, rejected: rejected.length > 0 ? rejected : undefined });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[credit-memo/overrides POST]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const sb = supabaseAdmin();
    const { data } = await sb
      .from("deal_memo_overrides")
      .select("overrides")
      .eq("deal_id", dealId)
      .eq("bank_id", auth.bankId)
      .maybeSingle();

    return NextResponse.json({ ok: true, overrides: data?.overrides ?? {} });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[credit-memo/overrides GET]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
