/**
 * POST /api/packs/auto-apply
 * 
 * Auto-apply the top-ranked pack to a deal
 */

import { NextRequest, NextResponse } from "next/server";
import { autoApplyTopRankedPack } from "@/lib/packs/autoApplyPack";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dealId } = body;

    if (!dealId) {
      return NextResponse.json(
        { error: "dealId is required" },
        { status: 400 }
      );
    }

    const result = await autoApplyTopRankedPack(dealId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to apply pack" },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Auto-apply pack API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
