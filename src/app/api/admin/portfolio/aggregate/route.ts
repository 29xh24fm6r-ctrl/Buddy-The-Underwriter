/**
 * POST /api/admin/portfolio/aggregate
 * 
 * Triggers portfolio aggregation for a bank.
 * Run nightly via cron/scheduled function.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { aggregatePortfolio } from "@/lib/macro/aggregatePortfolio";

export async function POST(req: NextRequest) {
  await requireSuperAdmin();

  const bankId = await getCurrentBankId();

  try {
    const snapshot = await aggregatePortfolio(bankId);

    return NextResponse.json({ ok: true, snapshot });
  } catch (error: any) {
    console.error("Portfolio aggregation error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to aggregate portfolio" },
      { status: 500 }
    );
  }
}
