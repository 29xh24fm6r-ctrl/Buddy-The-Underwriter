import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { buildBorrowerReport } from "@/lib/borrowerReport/borrowerReportBuilder";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;

  try {
    const report = await buildBorrowerReport(dealId);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error("[POST borrower-report/generate]", err);
    return NextResponse.json({ ok: false, error: "Failed to generate" }, { status: 500 });
  }
}
