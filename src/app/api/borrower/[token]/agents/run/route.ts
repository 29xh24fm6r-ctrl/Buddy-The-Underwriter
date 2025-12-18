import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBorrowerToken } from "@/lib/borrower/token";
import { runAgents } from "@/lib/agents/runAgents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const { application } = await requireBorrowerToken(token);
    const sb = supabaseAdmin();

    const [{ data: preflight }, { data: reqs }, { data: forms }] = await Promise.all([
      (sb as any).from("sba_preflight_results").select("*").eq("application_id", application.id).order("created_at", { ascending: false }).limit(1).single(),
      (sb as any).from("borrower_requirements_snapshots").select("*").eq("application_id", application.id).order("created_at", { ascending: false }).limit(1).single(),
      (sb as any).from("sba_form_payloads").select("*").eq("application_id", application.id).limit(1).single(),
    ]);

    const recommendations = await runAgents({
      application_id: application.id,
      preflight,
      requirements: reqs,
      forms,
    });

    // Log all agent events (NEVER auto-execute)
    for (const rec of recommendations) {
      await (sb as any).from("autonomous_events").insert({
        application_id: application.id,
        agent_name: rec.agent,
        action: rec.action,
        recommendation: rec.recommendation,
        confidence: rec.confidence,
        requires_approval: rec.requires_approval,
        status: "PENDING",
        created_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      ok: true,
      recommendations,
      total_count: recommendations.length,
      requires_approval_count: recommendations.filter(r => r.requires_approval).length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "agent_execution_failed" },
      { status: 400 }
    );
  }
}
