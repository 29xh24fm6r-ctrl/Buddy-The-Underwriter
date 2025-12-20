/**
 * POST /api/packs/override
 * 
 * Override pack selection with manual choice
 */

import { NextRequest, NextResponse } from "next/server";
import { overridePackSelection } from "@/lib/packs/overridePack";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dealId, toPackId, reason } = body;

    if (!dealId || !toPackId) {
      return NextResponse.json(
        { error: "dealId and toPackId are required" },
        { status: 400 }
      );
    }

    const result = await overridePackSelection(dealId, toPackId, reason);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to override pack" },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Override pack API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
