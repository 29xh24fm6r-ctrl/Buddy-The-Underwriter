/**
 * POST /api/deals/[dealId]/decision/[snapshotId]/counterfactual
 * 
 * Generates counterfactual decision outcomes ("what if" scenarios).
 * Examples:
 * - "What if we removed all exceptions?"
 * - "What if DSCR was 0.1 higher?"
 * - "What if this was a different loan size?"
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { aiJson } from "@/lib/ai/openai";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; snapshotId: string }> }
) {
  const { snapshotId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const body = await req.json();
  const { scenario } = body;

  if (!scenario) {
    return NextResponse.json(
      { ok: false, error: "scenario is required" },
      { status: 400 }
    );
  }

  // Fetch original decision snapshot
  const { data: snapshot, error: snapError } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .eq("bank_id", bankId)
    .single();

  if (snapError || !snapshot) {
    return NextResponse.json(
      { ok: false, error: "Decision snapshot not found" },
      { status: 404 }
    );
  }

  try {
    // Generate counterfactual outcome using AI
    const result = await aiJson({
      system: `You are an underwriting decision simulator. Given an original decision and a scenario modification, 
predict what the outcome would have been. Be specific about confidence level.`,
      prompt: JSON.stringify({
        original_snapshot: {
          decision: snapshot.decision,
          inputs: snapshot.inputs_json,
          policy_eval: snapshot.policy_eval_json,
          exceptions: snapshot.exceptions_json
        },
        scenario_modification: scenario
      }),
      schema: {
        type: "object",
        properties: {
          outcome: { 
            type: "string",
            enum: ["approve", "approve_with_conditions", "decline", "refer_to_committee"]
          },
          confidence: { 
            type: "number",
            minimum: 0,
            maximum: 1
          },
          explanation: { type: "string" }
        },
        required: ["outcome", "confidence", "explanation"]
      }
    });

    // Store counterfactual result
    const { data: counterfactual } = await sb
      .from("counterfactual_decisions")
      .insert({
        decision_snapshot_id: snapshotId,
        scenario_json: scenario,
        outcome: result.outcome,
        confidence: result.confidence,
        explanation: result.explanation
      })
      .select()
      .single();

    return NextResponse.json({ 
      ok: true, 
      counterfactual: {
        ...counterfactual,
        original_decision: snapshot.decision
      }
    });
  } catch (error: any) {
    console.error("Counterfactual generation error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to generate counterfactual" },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; snapshotId: string }> }
) {
  const { snapshotId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Fetch all counterfactuals for this snapshot
  const { data, error } = await sb
    .from("counterfactual_decisions")
    .select("*")
    .eq("decision_snapshot_id", snapshotId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, counterfactuals: data });
}
