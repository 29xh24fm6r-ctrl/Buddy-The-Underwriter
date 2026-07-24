import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { buildBorrowerReport } from "@/lib/borrowerReport/borrowerReportBuilder";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;

  try {
    const report = await buildBorrowerReport(dealId);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error("[POST borrower-report/generate]", err);
    return NextResponse.json({ ok: false, error: "Failed to generate" }, { status: 500 });
  }
}
