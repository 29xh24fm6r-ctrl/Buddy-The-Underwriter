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
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { runMission } from "@/lib/research/runMission";
import { buildResearchEntityProfile } from "@/lib/research/buildResearchSubject";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { rateLimit } from "@/lib/api/rateLimit";
import type { MissionType, MissionDepth } from "@/lib/research/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // BIE runs 7 Gemini calls — needs up to 5 minutes

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; action?: string }> },
) {
  try {
    const { dealId, action } = await ctx.params;
    // "rerun"/"re-run" are explicit user intent to start a fresh mission even
    // if an identical (deal_id, mission_type, subject, depth) mission already
    // completed — bypass the run_key idempotency short-circuit in that case.
    // Plain "run" stays idempotent. See
    // specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1 (idempotency).
    const forceRerun = action === "rerun" || action === "re-run";

    if (!uuidRegex.test(dealId)) {
      return NextResponse.json(
        { ok: false, error: "invalid_deal_id" },
        { status: 400 },
      );
    }

    // SECURITY: verify the caller's bank owns this deal before doing anything
    // else — this is the only handler in this directory that was missing this
    // check, and it's the one that triggers a real, billable multi-minute BIE
    // mission. See specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P0-1.
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "deal_not_found" ? 404 : access.error === "unauthorized" ? 401 : 403;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }
    const { bankId, userId } = access;

    // RATE LIMIT: this route triggers a real, up-to-5-minute, multi-Gemini-call
    // BIE mission per request. Neither the "already queued/running" check below
    // nor the createMission() run-key dedup guards against rapid *sequential*
    // re-triggering once a mission completes. See
    // specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P0-2.
    const dealCooldown = rateLimit({ key: `research-run:deal:${dealId}`, limit: 1, windowMs: 30_000 });
    if (!dealCooldown.ok) {
      return NextResponse.json(
        { ok: false, error: "rate_limited", detail: "Research was just triggered for this deal — please wait before retrying.", resetAt: dealCooldown.resetAt },
        { status: 429 },
      );
    }
    const bankCooldown = rateLimit({ key: `research-run:bank:${bankId}`, limit: 20, windowMs: 10 * 60_000 });
    if (!bankCooldown.ok) {
      return NextResponse.json(
        { ok: false, error: "rate_limited", detail: "Too many research missions triggered recently — please wait before retrying.", resetAt: bankCooldown.resetAt },
        { status: 429 },
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

    // SPEC-RESEARCH-SUBJECT-LOCK-MEMO-INPUT-PARITY-1: resolve the research
    // subject from the canonical builder, which reads borrowers (when attached)
    // AND the memo-input sources (deals.borrower_name, deal_borrower_story,
    // deal_management_profiles). This brings research into parity with the
    // borrower-representation contract used by lifecycle + underwrite, so a deal
    // with a banker-certified story but no legacy borrower_id is no longer
    // treated as having an empty subject.
    // SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1: the entity profile
    // folds legal name / DBA / website / banker-certified context + private-company
    // mode into the subject so the BIE can disambiguate and avoid web-searching a
    // placeholder deal label.
    const { subject, represented, naics_provisional, name_is_placeholder, certification_level } =
      await buildResearchEntityProfile(sb, dealId);

    if (!represented) {
      console.warn(
        `[research/run] Deal ${dealId}: no borrower representation (borrower_id/story/management profile all absent) — subject will fail subject lock`,
      );
    }
    if ((subject.principals?.length ?? 0) > 0) {
      console.log(`[research/run] Deal ${dealId}: ${subject.principals!.length} principal(s) loaded for BIE context`);
    } else {
      console.warn(`[research/run] Deal ${dealId}: no principals found — BIE will run without management context`);
    }
    if (naics_provisional) {
      console.warn(`[research/run] Deal ${dealId}: NAICS missing/placeholder — using provisional industry description, no NAICS number invented`);
    }
    if (name_is_placeholder) {
      console.warn(`[research/run] Deal ${dealId}: no legal/DBA/website search name (placeholder deal label) — entity lock will not web-search; certification=${certification_level}`);
    }

    // Check for existing running/queued/complete mission with the same run key
    // (idempotency — see P1 fix in runMission.ts's createMission()). This
    // in-route check remains as a fast-path short-circuit for the common
    // double-click case; createMission() now also enforces it at the DB level.
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

    // Run the mission (enriched subject from the canonical builder)
    const result = await runMission(dealId, missionType, subject, {
      depth,
      bankId,
      userId,
      forceRerun,
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
