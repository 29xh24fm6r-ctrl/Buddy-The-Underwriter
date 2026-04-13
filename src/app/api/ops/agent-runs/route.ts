import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ops/agent-runs
 *
 * Unified agent workflow runs query — reads from agent_workflow_runs VIEW.
 * Auth: super_admin only (ops layout also enforces this).
 *
 * Query params:
 *   deal_id       — filter by deal
 *   workflow_code  — filter by workflow type
 *   status        — filter by status
 *   limit         — max rows (default 50, max 200)
 *
 * ALWAYS returns JSON — never 500.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  try {
    const url = new URL(req.url);
    const dealId = url.searchParams.get("deal_id");
    const workflowCode = url.searchParams.get("workflow_code");
    const status = url.searchParams.get("status");
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "50", 10) || 50,
      200,
    );

    const sb = supabaseAdmin();
    let query = sb
      .from("agent_workflow_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (dealId) query = query.eq("deal_id", dealId);
    if (workflowCode) query = query.eq("workflow_code", workflowCode);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;

    if (error) {
      console.error("[ops/agent-runs] query error:", error.message);
      return NextResponse.json({ ok: true, runs: [] });
    }

    return NextResponse.json({ ok: true, runs: data ?? [] });
  } catch (err) {
    console.error("[ops/agent-runs] unexpected error:", err);
    return NextResponse.json({ ok: true, runs: [] });
  }
}
