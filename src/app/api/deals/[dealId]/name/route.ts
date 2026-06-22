import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

async function loadDealName(dealId: string, bankId: string) {
  const sb = supabaseAdmin();
  return sb
    .from("deals")
    .select(
      "id, name, display_name, nickname, borrower_name, legal_name, borrower_id, name_locked, naming_method, naming_source, named_at",
    )
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .maybeSingle();
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const { data, error } = await loadDealName(dealId, access.bankId);
    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: error?.message ?? "deal_not_found" },
        { status: error ? 500 : 404 },
      );
    }

    return NextResponse.json({ ok: true, deal: data });
  } catch (error) {
    rethrowNextErrors(error);

    console.error("[/api/deals/[dealId]/name GET]", error);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;

    const body = await req.json().catch(() => ({}));
    const displayName = normalizeName(body?.display_name);
    if (!displayName) {
      return NextResponse.json({ ok: false, error: "name_required" }, { status: 400 });
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 }
      );
    }

    const sb = supabaseAdmin();
    const nowIso = new Date().toISOString();
    const { data, error } = await sb
      .from("deals")
      .update({
        display_name: displayName,
        name: displayName,
        name_locked: true,
        naming_method: "manual",
        naming_source: "user",
        named_at: nowIso,
      } as any)
      .eq("id", dealId)
      .eq("bank_id", access.bankId)
      .select(
        "id, name, display_name, nickname, borrower_name, legal_name, borrower_id, name_locked, naming_method, naming_source, named_at",
      )
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
        name: data.name ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      deal: data,
      dealId: data.id,
      display_name: data.display_name ?? null,
      name: data.name ?? null,
      nickname: data.nickname ?? null,
    });
  } catch (error) {
    rethrowNextErrors(error);

    console.error("[/api/deals/[dealId]/name PATCH]", error);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
