/**
 * POST /api/deals/[dealId]/research/run
 *
 * Triggers a research mission for a deal.
 * Resolves NAICS code from the deal's borrower record.
 * Runs industry_landscape mission at "committee" depth.
 * Returns mission_id and status — runs to completion (up to 60s).
 *
 * Body (optional JSON):
 *   { mission_type?: MissionType, depth?: MissionDepth }
 *
 * Defaults: mission_type = "industry_landscape", depth = "committee"
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { runMission } from "@/lib/research/runMission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import type { MissionType, MissionDepth } from "@/lib/research/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // BIE runs 7 Gemini calls — needs up to 5 minutes

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;

    if (!uuidRegex.test(dealId)) {
      return NextResponse.json(
        { ok: false, error: "invalid_deal_id" },
        { status: 400 },
      );
    }

    // Parse optional body
    let missionType: MissionType = "industry_landscape";
    let depth: MissionDepth = "committee";
    try {
      const body = await req.json();
      if (body.mission_type) missionType = body.mission_type;
      if (body.depth) depth = body.depth;
    } catch {
      // No body or invalid JSON — use defaults
    }

    const sb = supabaseAdmin();

    // Load deal
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, borrower_id, state")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr) throw dealErr;
    if (!deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }

    // Load borrower separately (avoids FK join dependency)
    let naicsCode = "999999";
    let naicsDescription: string | undefined;
    let legalName = "";
    let borrowerCity: string | undefined;
    let borrowerState: string | null = deal.state ?? null;

    if (deal.borrower_id) {
      const { data: borrower } = await sb
        .from("borrowers")
        .select("naics_code, naics_description, legal_name, city, state")
        .eq("id", deal.borrower_id)
        .maybeSingle();

      if (borrower?.naics_code) {
        naicsCode = borrower.naics_code;
      } else {
        console.warn(
          `[research/run] Deal ${dealId}: borrower has no NAICS code, falling back to 999999`,
        );
      }
      legalName = borrower?.legal_name ?? "";
      naicsDescription = borrower?.naics_description ?? undefined;
      borrowerCity = (borrower as any)?.city ?? undefined;
      borrowerState = borrower?.state ?? deal.state ?? null;
    }

    // Load loan request for financial context
    const { data: loanReq } = await (sb as any)
      .from("deal_loan_requests")
      .select("purpose, loan_amount, product_type")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Load ownership entities for principal names.
    // CRITICAL: ownership_entities uses display_name (not entity_name or name).
    // Principals must be populated correctly so the BIE can validate its management
    // intelligence output against the deal's actual owners.
    const { data: ownersData } = await (sb as any)
      .from("ownership_entities")
      .select("display_name, title, ownership_pct")
      .eq("deal_id", dealId)
      .limit(10);

    const principals = ((ownersData ?? []) as any[])
      .map((o: any) => ({
        name: (o.display_name ?? "") as string,
        title: (o.title ?? null) as string | null,
      }))
      .filter((p) => p.name.trim().length > 1);

    if (principals.length > 0) {
      console.log(`[research/run] Deal ${dealId}: ${principals.length} principal(s) loaded for BIE context`);
    } else {
      console.warn(`[research/run] Deal ${dealId}: no principals found in ownership_entities — BIE will run without management context`);
    }

    // Load annual revenue from financial facts
    const { data: revFact } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_value_num")
      .eq("deal_id", dealId)
      .eq("fact_key", "TOTAL_REVENUE")
      .not("fact_value_num", "is", null)
      .order("fact_period_end", { ascending: false })
      .limit(1)
      .maybeSingle();

    const annualRevenue = revFact?.fact_value_num ? Number(revFact.fact_value_num) : null;

    const bankId = await getCurrentBankId();

    // Check for existing running/queued mission
    const { data: existing } = await sb
      .from("buddy_research_missions")
      .select("id, status")
      .eq("deal_id", dealId)
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        ok: true,
        already_running: true,
        mission_id: existing.id,
      });
    }

    // Run the mission (enriched subject for BIE)
    const result = await runMission(dealId, missionType, {
      naics_code: naicsCode,
      naics_description: naicsDescription,
      geography: borrowerState ?? "US",
      city: borrowerCity,
      state: borrowerState ?? undefined,
      company_name: legalName || undefined,
      principals,
      annual_revenue: annualRevenue,
      loan_amount: loanReq?.loan_amount ? Number(loanReq.loan_amount) : undefined,
      loan_purpose: loanReq?.purpose ?? undefined,
    }, {
      depth,
      bankId,
      userId: null,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error: any) {
    rethrowNextErrors(error);

    console.error("[/api/deals/[dealId]/research/run] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
