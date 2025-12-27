/**
 * SBA Difficulty Score API
 * Calculate gamified readiness score
 */

import { NextRequest, NextResponse } from "next/server";
import { calculateDifficultyScore, formatDifficultyScore } from "@/lib/sba/difficulty";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await context.params;
    const body = await req.json();
    
    const { program = "7A", dealData } = body;

    if (!dealData) {
      return NextResponse.json(
        { ok: false, error: "Missing 'dealData'" },
        { status: 400 }
      );
    }

    // Calculate difficulty score
    const score = await calculateDifficultyScore({
      dealId,
      program,
      dealData,
    });

    const formatted = formatDifficultyScore(score);

    return NextResponse.json({
      ok: true,
      readiness_percentage: score.readiness_percentage,
      difficulty_score: score.difficulty_score,
      hard_stops: score.hard_stops,
      estimated_time: score.estimated_time_to_ready,
      top_fixes: score.top_fixes,
      formatted,
      details: score,
    });
  } catch (error: any) {
    console.error("Difficulty score error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}
