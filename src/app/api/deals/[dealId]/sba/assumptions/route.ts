import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadSBAAssumptionsPrefill } from "@/lib/sba/sbaAssumptionsPrefill";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string }>;

const SBA_TYPES = ["SBA", "sba_7a", "sba_504", "sba_express"];

async function ensureSbaDealOrReturn403(dealId: string): Promise<Response | null> {
  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("deal_type")
    .eq("id", dealId)
    .single();
  if (!deal || !SBA_TYPES.includes(deal.deal_type ?? "")) {
    return NextResponse.json(
      { error: "SBA Package is not available for this deal type." },
      { status: 403 },
    );
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sbaGate = await ensureSbaDealOrReturn403(dealId);
    if (sbaGate) return sbaGate;

    const sb = supabaseAdmin();

    const { data: assumptionsRow } = await sb
      .from("buddy_sba_assumptions")
      .select("*")
      .eq("deal_id", dealId)
      .maybeSingle();

    const prefillRaw = await loadSBAAssumptionsPrefill(dealId);
    // Phase 2 — peel off the non-schema _prefillMeta sibling so the client
    // receives a clean Partial<SBAAssumptions> plus a top-level prefillMeta.
    const { _prefillMeta, ...prefilled } = prefillRaw;

    const assumptions = assumptionsRow
      ? {
          dealId,
          status: assumptionsRow.status,
          confirmedAt: assumptionsRow.confirmed_at ?? undefined,
          revenueStreams: assumptionsRow.revenue_streams,
          costAssumptions: assumptionsRow.cost_assumptions,
          workingCapital: assumptionsRow.working_capital,
          loanImpact: assumptionsRow.loan_impact,
          managementTeam: assumptionsRow.management_team,
        }
      : null;

    return NextResponse.json({
      assumptions,
      prefilled,
      prefillMeta: _prefillMeta ?? null,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sbaGate = await ensureSbaDealOrReturn403(dealId);
    if (sbaGate) return sbaGate;

    const body = await req.json().catch(() => ({}));
    const patch = body.patch ?? {};

    const sb = supabaseAdmin();

    const upsertData: Record<string, unknown> = {
      deal_id: dealId,
      updated_at: new Date().toISOString(),
    };

    if (patch.revenueStreams !== undefined)
      upsertData.revenue_streams = patch.revenueStreams;
    if (patch.costAssumptions !== undefined)
      upsertData.cost_assumptions = patch.costAssumptions;
    if (patch.workingCapital !== undefined)
      upsertData.working_capital = patch.workingCapital;
    if (patch.loanImpact !== undefined)
      upsertData.loan_impact = patch.loanImpact;
    if (patch.managementTeam !== undefined)
      upsertData.management_team = patch.managementTeam;
    if (patch.status !== undefined) {
      upsertData.status = patch.status;
      if (patch.status === "confirmed") {
        upsertData.confirmed_at = new Date().toISOString();
      }
    }

    const { error } = await sb
      .from("buddy_sba_assumptions")
      .upsert(upsertData, { onConflict: "deal_id" });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
