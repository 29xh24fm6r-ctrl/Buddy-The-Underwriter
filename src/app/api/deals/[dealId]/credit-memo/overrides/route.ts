import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
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
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }
    const bankId = access.bankId;

    const body = await req.json().catch(() => ({}));
    const rawOverrides = body?.overrides ?? {};

    // Enforce override policy — only qualitative narrative keys are accepted
    const { accepted, rejected } = filterQualitativeOverrides(rawOverrides);

    const sb = supabaseAdmin();

    // Phase 91: merge into existing overrides rather than overwrite, so that a
    // partial submission (e.g. covenant-tab save) does not wipe unrelated keys
    // from other tabs (business profile, qualitative overrides, etc.).
    const { data: existing } = await sb
      .from("deal_memo_overrides")
      .select("overrides")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .maybeSingle();

    const current = ((existing?.overrides as Record<string, unknown> | null) ?? {});
    const merged: Record<string, unknown> = { ...current, ...accepted };

    const { error } = await sb
      .from("deal_memo_overrides")
      .upsert(
        { deal_id: dealId, bank_id: bankId, overrides: merged, updated_at: new Date().toISOString() },
        { onConflict: "deal_id,bank_id" },
      );

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      overrides: merged,
      rejected: rejected.length > 0 ? rejected : undefined,
    });
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
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }
    const bankId = access.bankId;

    const sb = supabaseAdmin();
    const { data } = await sb
      .from("deal_memo_overrides")
      .select("overrides")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .maybeSingle();

    return NextResponse.json({ ok: true, overrides: data?.overrides ?? {} });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[credit-memo/overrides GET]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
