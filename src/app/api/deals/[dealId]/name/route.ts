import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

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
    // Canonical name storage: only use display_name (nickname is deprecated for persistence)

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
      .update({ display_name: displayName })
      .eq("id", dealId)
      .eq("bank_id", access.bankId)
      .select("id, display_name")
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: error?.message ?? "update_failed" },
        { status: 500 }
      );
    }

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "deal.named",
      uiState: "done",
      uiMessage: "Deal named",
      meta: {
        deal_id: dealId,
        display_name: data.display_name ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      dealId: data.id,
      display_name: data.display_name ?? null,
      nickname: null, // Deprecated - always null for backwards compat
    });
  } catch (error) {
    console.error("[/api/deals/[dealId]/name]", error);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
