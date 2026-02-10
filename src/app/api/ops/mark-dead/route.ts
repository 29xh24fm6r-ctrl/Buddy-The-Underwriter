import "server-only";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeSystemEvent } from "@/lib/aegis/writeSystemEvent";
import type { AegisJobTable } from "@/lib/aegis/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TABLES: AegisJobTable[] = ["document_jobs", "deal_spread_jobs"];

/**
 * POST /api/ops/mark-dead
 *
 * Permanently mark a job as FAILED and write a "dead" system event.
 * Also resolves any open system events for this job.
 *
 * Body: { job_id: string, source_table: string, reason?: string }
 * Auth: requireSuperAdmin()
 */
export async function POST(req: Request) {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const { job_id, source_table, reason } = body ?? {};

  if (!job_id || typeof job_id !== "string") {
    return NextResponse.json(
      { ok: false, error: "job_id is required" },
      { status: 400 },
    );
  }
  if (!VALID_TABLES.includes(source_table)) {
    return NextResponse.json(
      {
        ok: false,
        error: `source_table must be one of: ${VALID_TABLES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  try {
    // Fetch current job state
    const { data: job, error: fetchErr } = await sb
      .from(source_table as any)
      .select("id, deal_id, status, attempt, error")
      .eq("id", job_id)
      .maybeSingle();

    if (fetchErr || !job) {
      return NextResponse.json(
        { ok: false, error: "job_not_found" },
        { status: 404 },
      );
    }

    const row = job as any;
    const now = new Date().toISOString();

    // Mark job as permanently FAILED
    const { error: updateErr } = await sb
      .from(source_table as any)
      .update({
        status: "FAILED",
        error: `[admin-dead] ${reason ?? "Manually marked dead"} | previous: ${row.error ?? "none"}`,
        updated_at: now,
      } as any)
      .eq("id", job_id);

    if (updateErr) {
      return NextResponse.json(
        { ok: false, error: updateErr.message },
        { status: 500 },
      );
    }

    // Write dead system event
    await writeSystemEvent({
      event_type: "error",
      severity: "critical",
      source_system: "api",
      source_job_id: job_id,
      source_job_table: source_table as AegisJobTable,
      deal_id: row.deal_id,
      error_message: reason ?? "Manually marked dead by admin",
      resolution_status: "dead",
      resolved_at: now,
      resolved_by: "admin",
      resolution_note: reason ?? undefined,
      retry_attempt: row.attempt,
      payload: { triggered_by: "admin_mark_dead", previous_error: row.error },
    });

    // Resolve any open system events for this job
    await sb
      .from("buddy_system_events" as any)
      .update({
        resolution_status: "dead",
        resolved_at: now,
        resolved_by: "admin",
        resolution_note: reason ?? "Job manually marked dead",
      } as any)
      .eq("source_job_id", job_id)
      .eq("resolution_status", "open");

    return NextResponse.json({
      ok: true,
      job_id,
      source_table,
      previous_status: row.status,
      new_status: "FAILED (dead)",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
