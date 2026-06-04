import "server-only";
import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import {
  isAllowedConnectorKind,
  isAllowedSourceType,
  runManualUrlConnector,
  sourceDomainOf,
} from "@/lib/research/sourceConnectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Params = Promise<{ dealId: string; taskId: string }>;

/**
 * POST /api/deals/[dealId]/research/committee-tasks/[taskId]/source-snapshot
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1 — Phase 8
 *
 * Attach a banker-supplied source URL to a committee task via the manual URL
 * connector: fetch + hash + snapshot linked to the task. NEVER sets
 * committee_grade_accepted, never touches review_status, never changes the gate
 * or auto-clears a blocker. The task may advance pending → collected (workflow
 * status only) when the snapshot is collected.
 *
 * Body: { connector_kind, source_url, source_type, note?, candidate_metadata? }
 * Response: { ok: true, snapshot, task }
 *
 * mission_id / deal_id come from the trusted DB row, never the client.
 */
export async function POST(req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId, taskId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }
    const actorId = access.userId ?? null;

    let body: {
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

    const result = await runManualUrlConnector({
      missionId: (task as any).mission_id,
      dealId: (task as any).deal_id,
      taskId,
      connectorKind: body.connector_kind,
      sourceUrl,
      sourceType: body.source_type,
      note,
    });

    if (result.error === "invalid_url") {
      return NextResponse.json({ ok: false, error: "invalid_url" }, { status: 400 });
    }

    const snap = result.snapshots[0];
    const now = new Date().toISOString();
    const { data: inserted, error: insErr } = await sb
      .from("buddy_research_source_snapshots")
      .insert({
        mission_id: snap.mission_id,
        deal_id: snap.deal_id,
        task_id: taskId,
        source_url: snap.source_url,
        source_type: snap.source_type,
        status: snap.status,
        http_status: snap.http_status,
        content_hash: snap.content_hash,
        content_type: snap.content_type,
        title: snap.title,
        source_title: snap.title,
        source_domain: sourceDomainOf(snap.source_url),
        byte_size: snap.byte_size,
        error: snap.error,
        connector_kind: result.connector_kind,
        connector_mode: result.mode,
        limitations: result.limitations,
        candidate_metadata: candidateMetadata,
        fetched_at: now,
      })
      .select(
        "id, task_id, source_url, source_type, status, connector_kind, connector_mode, source_domain, content_hash, limitations, created_at",
      )
      .maybeSingle();

    if (insErr || !inserted) {
      return NextResponse.json(
        { ok: false, error: insErr?.message ?? "snapshot_insert_failed" },
        { status: 500 },
      );
    }

    // Advance the banker WORKFLOW status pending → collected on success only.
    // NEVER touch review_status / committee_grade_accepted / resolved_status.
    let updatedTask = task;
    if (snap.status === "collected" && (task as any).status === "pending") {
      const { data: t2 } = await sb
        .from("buddy_research_committee_tasks")
        .update({ status: "collected", source_snapshot_id: inserted.id, updated_at: now })
        .eq("id", taskId)
        .eq("deal_id", dealId)
        .select("id, status, review_status, committee_grade_accepted, resolved_status")
        .maybeSingle();
      if (t2) updatedTask = t2 as any;
    }

    return NextResponse.json({
      ok: true,
      snapshot: inserted,
      task: updatedTask,
      actor_id: actorId,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unexpected_error" },
      { status: 500 },
    );
  }
}
