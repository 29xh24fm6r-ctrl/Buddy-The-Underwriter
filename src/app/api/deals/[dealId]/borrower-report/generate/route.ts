import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { requireDealAccess } from "@/lib/server/authz";
import { buildBorrowerReport } from "@/lib/borrowerReport/borrowerReportBuilder";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;

  // Previously only checked "some Clerk user is signed in", never that
  // they belong to the deal's own bank — buildBorrowerReport() queries by
  // dealId alone, so any authenticated user from any bank could pull
  // another bank's computed financial ratios/Altman Z-score.
  // requireDealAccess authenticates, resolves bank, and checks
  // deal.bank_id matches in one call (src/lib/server/authz.ts).
  try {
    await requireDealAccess(dealId);
  } catch (e: any) {
    const status =
      e?.name === "AuthenticationRequiredError" ? 401 :
      e?.name === "DealAccessDeniedError" ? 404 :
      e?.name === "BankMembershipRequiredError" ? 403 :
      500;
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status });
  }

  try {
    const report = await buildBorrowerReport(dealId);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error("[POST borrower-report/generate]", err);
    return NextResponse.json({ ok: false, error: "Failed to generate" }, { status: 500 });
  }
}
