/**
 * Committee Evaluation API
 * Run multi-persona evaluation on a deal
 */

import { NextRequest, NextResponse } from "next/server";
import { runCommittee, formatCommitteeSummary } from "@/lib/sba/committee";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await context.params;
    const body = await req.json();
    
    const { question, bankId, personas } = body;

    if (!question) {
      return NextResponse.json(
        { ok: false, error: "Missing 'question'" },
        { status: 400 }
      );
    }

    // Run committee evaluation
    const result = await runCommittee({
      dealId,
      bankId,
      question,
      personas,
    });

    const summary = formatCommitteeSummary(result);

    return NextResponse.json({
      ok: true,
      event_id: result.event_id,
      evaluations: result.evaluations,
      consensus: result.consensus,
      summary,
    });
  } catch (error: any) {
    console.error("Committee evaluation error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}
