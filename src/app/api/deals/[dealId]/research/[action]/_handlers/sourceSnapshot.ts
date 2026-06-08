import "server-only";
import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import {
  isAllowedConnectorKind,
  isAllowedSourceType,
} from "@/lib/research/sourceConnectors";
import { persistManualSourceSnapshot } from "@/lib/research/sourceConnectors/persistSnapshot";

export const runtime = "nodejs";
export const maxDuration = 20;

type Params = Promise<{ dealId: string }>;

/**
 * POST /api/deals/[dealId]/research/source-snapshot
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1 — Phase 8
 *
 * Consolidated dispatcher handler (SPEC-ROUTE-CONSOLIDATION-1) — runs inside the
 * existing research/[action] function so this feature adds ZERO net serverless
 * functions (avoids the deploy-output / function-ceiling failure). Behavior is
 * identical to the prior standalone route: attach a banker-supplied source URL
 * to a committee task via the manual URL connector. NEVER sets
 * committee_grade_accepted, never touches review_status, never changes the gate
 * or auto-clears a blocker.
 *
 * Body: { taskId, connector_kind, source_url, source_type, note?, candidate_metadata? }
 * Response: { ok: true, snapshot, task }
 *
 * taskId is in the body (the dispatcher path has no taskId segment); mission_id /
 * deal_id are still read from the trusted DB task row, never the client, and the
 * task is verified to belong to the URL dealId.
 */
export async function POST(req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }
    const actorId = access.userId ?? null;

    let body: {
      taskId?: unknown;
      connector_kind?: unknown;
      source_url?: unknown;
      source_type?: unknown;
      note?: unknown;
      candidate_metadata?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
    if (!taskId) {
      return NextResponse.json({ ok: false, error: "taskId_required" }, { status: 400 });
    }
    if (!isAllowedConnectorKind(body.connector_kind)) {
      return NextResponse.json({ ok: false, error: "invalid_connector_kind" }, { status: 400 });
    }
    if (!isAllowedSourceType(body.source_type)) {
      return NextResponse.json({ ok: false, error: "invalid_source_type" }, { status: 400 });
    }
    const sourceUrl = typeof body.source_url === "string" ? body.source_url : "";
    if (!sourceUrl.trim()) {
      return NextResponse.json({ ok: false, error: "source_url_required" }, { status: 400 });
    }
    const note = typeof body.note === "string" ? body.note : null;
    const candidateMetadata =
      body.candidate_metadata && typeof body.candidate_metadata === "object"
        ? (body.candidate_metadata as Record<string, unknown>)
        : {};

    const sb = supabaseAdmin();

    // Verify the task belongs to this deal; read trusted mission_id / deal_id.
    const { data: task } = await sb
      .from("buddy_research_committee_tasks")
      .select("id, mission_id, deal_id, status, review_status")
      .eq("id", taskId)
      .eq("deal_id", dealId)
      .maybeSingle();
    if (!task) {
      return NextResponse.json({ ok: false, error: "task_not_found" }, { status: 404 });
    }

    const r = await persistManualSourceSnapshot(sb, {
      dealId,
      task: {
        id: taskId,
        mission_id: (task as any).mission_id,
        deal_id: (task as any).deal_id,
        status: (task as any).status ?? null,
      },
      connectorKind: body.connector_kind,
      sourceUrl,
      sourceType: body.source_type,
      note,
      candidateMetadata,
      actorId,
    });

    if (!r.ok) {
      return NextResponse.json({ ok: false, error: r.error }, { status: r.status ?? 500 });
    }

    return NextResponse.json({ ok: true, snapshot: r.snapshot, task: r.task ?? task, artifact: r.artifact, actor_id: actorId });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unexpected_error" },
      { status: 500 },
    );
  }
}
