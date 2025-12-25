import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  evaluateAllConditions,
  calculateClosingReadiness,
} from "@/lib/conditions/evaluate";
import { aiExplainCondition } from "@/lib/conditions/aiExplain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _: Request,
  context: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await context.params;
    const sb = supabaseAdmin();

    // Load all required context in parallel
    const [
      { data: conditions },
      { data: attachments },
      { data: requirements },
      { data: preflight },
    ] = await Promise.all([
      (sb as any)
        .from("conditions_to_close")
        .select("*")
        .eq("application_id", dealId),
      (sb as any)
        .from("borrower_attachments")
        .select("*")
        .eq("application_id", dealId),
      (sb as any)
        .from("borrower_requirements_snapshots")
        .select("*")
        .eq("application_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
      (sb as any)
        .from("sba_preflight_results")
        .select("*")
        .eq("application_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
    ]);

    if (!conditions || conditions.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No conditions to evaluate",
        updated: 0,
      });
    }

    // Build evaluation context
    const ctx = {
      attachments: attachments || [],
      requirements: requirements?.result,
      preflight,
    };

    // Evaluate all conditions deterministically
    const evaluations = evaluateAllConditions(conditions, ctx);

    // Calculate overall readiness
    const readiness = calculateClosingReadiness(conditions, evaluations);

    // Update each condition with evaluation results + AI explanation
    let updated = 0;
    for (const condition of conditions) {
      const evaluation = evaluations.get(condition.id);
      if (!evaluation) continue;

      const conditionWithStatus = {
        ...condition,
        satisfied: evaluation.satisfied,
        evidence: evaluation.evidence,
        reason: evaluation.reason,
      };

      const aiExplanation = aiExplainCondition(conditionWithStatus, ctx);

      await (sb as any)
        .from("conditions_to_close")
        .update({
          satisfied: evaluation.satisfied,
          ai_explanation: aiExplanation,
          last_evaluated_at: new Date().toISOString(),
          auto_resolved: evaluation.auto_resolved || false,
          resolution_evidence: evaluation.evidence || null,
        })
        .eq("id", condition.id);

      updated++;
    }

    return NextResponse.json({
      ok: true,
      updated,
      readiness: {
        ready: readiness.ready,
        required_remaining: readiness.required_remaining,
        important_remaining: readiness.important_remaining,
        total_remaining: readiness.total_remaining,
        completion_pct: readiness.completion_pct,
      },
    });
  } catch (err: any) {
    console.error("Conditions recompute failed:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "recompute_failed" },
      { status: 500 },
    );
  }
}

// Get current conditions status
export async function GET(
  _: Request,
  context: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await context.params;
    const sb = supabaseAdmin();

    const { data: conditions } = await (sb as any)
      .from("conditions_to_close")
      .select("*")
      .eq("application_id", dealId)
      .order("severity", { ascending: true })
      .order("satisfied", { ascending: true });

    // Calculate summary stats
    const total = conditions?.length || 0;
    const satisfied = conditions?.filter((c: any) => c.satisfied).length || 0;
    const required =
      conditions?.filter((c: any) => c.severity === "REQUIRED").length || 0;
    const requiredSatisfied =
      conditions?.filter((c: any) => c.severity === "REQUIRED" && c.satisfied)
        .length || 0;

    return NextResponse.json({
      ok: true,
      conditions: conditions || [],
      summary: {
        total,
        satisfied,
        remaining: total - satisfied,
        required,
        required_satisfied: requiredSatisfied,
        required_remaining: required - requiredSatisfied,
        completion_pct: total > 0 ? Math.round((satisfied / total) * 100) : 0,
        ready: required === requiredSatisfied,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "fetch_failed" },
      { status: 500 },
    );
  }
}
