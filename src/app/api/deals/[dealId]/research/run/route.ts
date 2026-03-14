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
import { auth } from "@clerk/nextjs/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { runMission } from "@/lib/research/runMission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import type { MissionType, MissionDepth } from "@/lib/research/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
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

    // Load deal + borrower
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select(
        "id, borrower_id, state, borrowers(naics_code, naics_description, legal_name, city, state)",
      )
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr) throw dealErr;
    if (!deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }

    // Resolve NAICS
    const borrower = deal.borrowers as any;
    let naicsCode = borrower?.naics_code ?? "";
    if (!naicsCode) {
      console.warn(
        `[research/run] Deal ${dealId}: borrower has no NAICS code, falling back to 999999`,
      );
      naicsCode = "999999";
    }

    const legalName = borrower?.legal_name ?? "";
    const borrowerState = borrower?.state ?? null;

    const bankId = await getCurrentBankId();
    const { userId } = await auth();

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

    // Run the mission
    const result = await runMission(dealId, missionType, {
      naics_code: naicsCode,
      geography: borrowerState ?? "US",
      company_name: legalName,
    }, {
      depth,
      bankId,
      userId: userId ?? null,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error: any) {
    rethrowNextErrors(error);

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: error.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[/api/deals/[dealId]/research/run] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
