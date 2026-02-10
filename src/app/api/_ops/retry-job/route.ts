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
 * POST /api/_ops/retry-job
 *
 * Reset a failed job to QUEUED with next_run_at = now().
 *
 * Body: { job_id: string, source_table: "document_jobs" | "deal_spread_jobs" }
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

  const { job_id, source_table } = body ?? {};

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

    // Reset to QUEUED
    const now = new Date().toISOString();
    const { error: updateErr } = await sb
      .from(source_table as any)
      .update({
        status: "QUEUED",
        next_run_at: now,
        leased_until: null,
        lease_owner: null,
        error: `[admin-retry] previous: ${row.error ?? "none"}`,
        updated_at: now,
      } as any)
      .eq("id", job_id);

    if (updateErr) {
      return NextResponse.json(
        { ok: false, error: updateErr.message },
        { status: 500 },
      );
    }

    // Write system event
    await writeSystemEvent({
      event_type: "retry",
      severity: "info",
      source_system: "api",
      source_job_id: job_id,
      source_job_table: source_table as AegisJobTable,
      deal_id: row.deal_id,
      resolution_status: "retrying",
      retry_attempt: row.attempt,
      error_message: row.error,
      payload: { triggered_by: "admin_retry" },
    });

    return NextResponse.json({
      ok: true,
      job_id,
      source_table,
      previous_status: row.status,
      new_status: "QUEUED",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
