import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { runSpreadPreflight } from "@/lib/spreads/preflight/runSpreadPreflight";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const result = await runSpreadPreflight(dealId);
    return NextResponse.json(result);
  } catch (e: any) {
    rethrowNextErrors(e);

    console.error("[/api/deals/[dealId]/spreads/preflight]", e);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
