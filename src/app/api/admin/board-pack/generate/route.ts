/**
 * POST /api/admin/board-pack/generate
 * 
 * Generates board-ready quarterly risk pack.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { generateBoardPack } from "@/lib/reports/generateBoardPack";

export async function POST(req: NextRequest) {
  await requireSuperAdmin();

  const bankId = await getCurrentBankId();
  const body = await req.json();
  const { quarter } = body;

  if (!quarter) {
    return NextResponse.json(
      { ok: false, error: "quarter is required (format: 2025-Q4)" },
      { status: 400 }
    );
  }

  try {
    const report = await generateBoardPack(bankId, quarter);

    return NextResponse.json({ ok: true, report });
  } catch (error: any) {
    console.error("Board pack generation error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to generate board pack" },
      { status: 500 }
    );
  }
}
