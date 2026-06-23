import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getWorkflowDefinition } from "@/lib/agentWorkflows/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ runId: string }> };

/**
 * GET /api/ops/agent-runs/[runId]?workflow_code=...
 *
 * Returns detail for a single workflow run.
 * Requires workflow_code param to know which source table to query.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const { runId } = await ctx.params;
    const url = new URL(req.url);
    const workflowCode = url.searchParams.get("workflow_code");

    if (!workflowCode) {
      return NextResponse.json({ ok: false, error: "workflow_code required" }, { status: 400 });
    }

    const def = getWorkflowDefinition(workflowCode);
    if (!def) {
      return NextResponse.json({ ok: false, error: `Unknown workflow: ${workflowCode}` }, { status: 404 });
    }

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from(def.sourceTable)
      .select("*")
      .eq(def.sourceIdColumn, runId)
      .maybeSingle();

    if (error) {
      console.error("[ops/agent-runs/detail] query error:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, run: data, workflow: def });
  } catch (err) {
    console.error("[ops/agent-runs/detail] unexpected error:", err);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
