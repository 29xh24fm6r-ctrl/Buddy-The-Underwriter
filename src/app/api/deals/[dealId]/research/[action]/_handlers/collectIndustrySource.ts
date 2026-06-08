import "server-only";
import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { buildIndustrySourceDescriptor } from "@/lib/research/sourceCollection/industrySourceCollector";
import { persistManualSourceSnapshot } from "@/lib/research/sourceConnectors/persistSnapshot";

export const runtime = "nodejs";
export const maxDuration = 20;

type Params = Promise<{ dealId: string }>;

/**
 * POST /api/deals/[dealId]/research/collect-industry-source
 * SPEC-BIE-ACTIVE-SOURCE-COLLECTION-PR-B
 *
 * Executes the Industry Validation source-collection plan: builds the
 * deterministic official government-data source URL for the deal's NAICS,
 * fetches + snapshots it via the existing safe persist-core, links it to the
 * industry_market_source committee task, and marks the task resolved_status
 * needs_review ("analyst review required"). Runs inside the existing
 * research/[action] dispatcher — ZERO net serverless functions.
 *
 * INVARIANTS: deterministic source only (no AI browsing, no fabricated URLs);
 * NEVER sets committee_grade_accepted; NEVER auto-clears a committee blocker;
 * no scoring / lifecycle / memo change.
 */
export async function POST(_req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }
    const actorId = access.userId ?? null;
    const sb = supabaseAdmin();

    // Latest mission + research subject (NAICS).
    const { data: mission } = await sb
      .from("buddy_research_missions")
      .select("id, subject")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!mission?.id) {
      return NextResponse.json({ ok: false, error: "no_mission" }, { status: 404 });
    }
    const subject = (mission.subject ?? {}) as Record<string, unknown>;

    const { data: story } = await sb
      .from("deal_borrower_story")
      .select("hq_city, hq_state")
      .eq("deal_id", dealId)
      .maybeSingle();

    const descriptor = buildIndustrySourceDescriptor({
      naicsCode: (subject.naics_code as string) ?? null,
      naicsDescription: (subject.naics_description as string) ?? null,
      hqCity: (story as any)?.hq_city ?? null,
      hqState: (story as any)?.hq_state ?? null,
    });
    if (!descriptor) {
      return NextResponse.json({ ok: false, error: "no_usable_naics" }, { status: 422 });
    }

    // The industry_market_source committee task (gate-derived; no scale task case).
    const { data: task } = await sb
      .from("buddy_research_committee_tasks")
      .select("id, mission_id, deal_id, status")
      .eq("deal_id", dealId)
      .eq("mission_id", mission.id)
      .eq("task_type", "industry_market_source")
      .limit(1)
      .maybeSingle();
    if (!task) {
      return NextResponse.json({ ok: false, error: "no_industry_task" }, { status: 404 });
    }

    const r = await persistManualSourceSnapshot(sb, {
      dealId,
      task: {
        id: (task as any).id,
        mission_id: (task as any).mission_id,
        deal_id: (task as any).deal_id,
        status: (task as any).status ?? null,
      },
      connectorKind: descriptor.connectorKind,
      sourceUrl: descriptor.sourceUrl,
      sourceType: descriptor.sourceType,
      note: descriptor.note,
      candidateMetadata: descriptor.candidateMetadata,
      actorId,
    });

    if (!r.ok) {
      return NextResponse.json({ ok: false, error: r.error }, { status: r.status ?? 500 });
    }

    // Collected → analyst review required. Set resolved_status ONLY (never
    // committee_grade_accepted) so the surface reads "collected; analyst review
    // required" rather than committee-ready.
    const collected = (r.snapshot as any)?.status === "collected";
    let reviewState: string | null = null;
    if (collected) {
      const { data: t2 } = await sb
        .from("buddy_research_committee_tasks")
        .update({ resolved_status: "needs_review", updated_at: new Date().toISOString() })
        .eq("id", (task as any).id)
        .eq("deal_id", dealId)
        .select("id, status, review_status, committee_grade_accepted, resolved_status")
        .maybeSingle();
      reviewState = (t2 as any)?.resolved_status ?? "needs_review";
    }

    return NextResponse.json({
      ok: true,
      collected,
      evidence_class: collected ? "official_supported" : null,
      review_state: reviewState,
      source: { label: descriptor.label, source_url: descriptor.sourceUrl, source_type: descriptor.sourceType },
      snapshot: r.snapshot,
      artifact: r.artifact,
      actor_id: actorId,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unexpected_error" },
      { status: 500 },
    );
  }
}
