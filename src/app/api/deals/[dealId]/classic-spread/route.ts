import "server-only";

import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadClassicSpreadData } from "@/lib/classicSpread/classicSpreadLoader";
import { renderClassicSpread } from "@/lib/classicSpread/classicSpreadRenderer";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const input = await loadClassicSpreadData(dealId);
    const pdf = await renderClassicSpread(input);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="FinancialSpread_${dealId.slice(0, 8)}.pdf"`,
      },
    });
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[classic-spread] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
