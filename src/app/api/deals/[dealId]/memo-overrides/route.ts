import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(_req: NextRequest, props: { params: Promise<{ dealId: string }> }) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });
    const sb = supabaseAdmin();
    const { data } = await sb.from("deal_memo_overrides").select("overrides").eq("deal_id", dealId).eq("bank_id", bankPick.bankId).maybeSingle();
    return NextResponse.json({ ok: true, overrides: ((data as Record<string, unknown> | null)?.overrides ?? {}) });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ dealId: string }> }) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });
    const body = await req.json();
    const { key, value } = body as { key: string; value: string };
    if (!key) return NextResponse.json({ ok: false, error: "missing key" }, { status: 400 });
    const sb = supabaseAdmin();
    const { data: existing } = await sb.from("deal_memo_overrides").select("id, overrides").eq("deal_id", dealId).eq("bank_id", bankPick.bankId).maybeSingle();
    const merged = { ...((existing as Record<string, unknown> | null)?.overrides as Record<string, unknown> ?? {}), [key]: value };
    if ((existing as Record<string, unknown> | null)?.id) {
      await sb.from("deal_memo_overrides").update({ overrides: merged, updated_at: new Date().toISOString() }).eq("id", (existing as Record<string, unknown>).id);
    } else {
      await sb.from("deal_memo_overrides").insert({ deal_id: dealId, bank_id: bankPick.bankId, overrides: merged });
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
