import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const body = await req.json().catch(() => ({}));
    const displayName = normalizeName(body?.display_name);
    const nickname = normalizeName(body?.nickname);

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 }
      );
    }

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("deals")
      .update({ display_name: displayName, nickname })
      .eq("id", dealId)
      .eq("bank_id", access.bankId)
      .select("id, display_name, nickname")
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: error?.message ?? "update_failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      dealId: data.id,
      display_name: data.display_name ?? null,
      nickname: data.nickname ?? null,
    });
  } catch (error) {
    console.error("[/api/deals/[dealId]/name]", error);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
