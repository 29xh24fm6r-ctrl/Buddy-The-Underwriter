import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { loadDealNameProjection } from "@/lib/deals/loadDealNameProjection";
import {
  buildDealNameProjection,
  DEAL_NAME_SELECT,
} from "@/lib/deals/dealNameProjection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * GET /api/deals/[dealId]/name
 *
 * SPEC-DEAL-NAME-SINGLE-SOURCE-OF-TRUTH-1: the canonical client read endpoint
 * for a deal's name. Clients MUST use this instead of the bare /api/deals/[id]
 * endpoint so every reader shares the same projection (and label) as the shell.
 */
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

    const projection = await loadDealNameProjection(dealId, access.bankId);
    if (!projection) {
      return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      dealId: projection.id,
      label: projection.label,
      deal: projection,
    });
  } catch (error) {
    rethrowNextErrors(error);
    console.error("[GET /api/deals/[dealId]/name]", error);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
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
    const nowIso = new Date().toISOString();
    // SPEC-DEAL-NAME-SINGLE-SOURCE-OF-TRUTH-1: write display_name AND name in
    // lockstep so the two canonical name columns can never drift apart.
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
      .select(DEAL_NAME_SELECT)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: error?.message ?? "update_failed" },
        { status: 500 }
      );
    }

    // Same projection the shell renders — so the route and shell agree exactly.
    const projection = buildDealNameProjection(dealId, data as Record<string, unknown>);

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "deal.named",
      uiState: "done",
      uiMessage: "Deal named",
      meta: {
        deal_id: dealId,
        display_name: projection.display_name,
      },
    });

    return NextResponse.json({
      ok: true,
      dealId: projection.id,
      label: projection.label,
      deal: projection,
      display_name: projection.display_name,
      nickname: null, // Deprecated - always null for backwards compat
    });
  } catch (error) {
    rethrowNextErrors(error);

    console.error("[/api/deals/[dealId]/name]", error);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
