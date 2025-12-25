// src/app/api/banker/deals/[dealId]/underwrite/guard/route.ts
import { NextResponse } from "next/server";
import {
  listLoanRequests,
  listUnderwriteInputs,
} from "@/lib/deals/loanRequests";
import { fetchDealDocFacts } from "@/lib/underwrite/docFacts";
import { normalizeUnderwrite } from "@/lib/underwrite/normalize";
import { underwriteConsistencyGuard } from "@/lib/underwrite/guard";
import { applyGuardAutomation } from "@/lib/underwrite/guardAutomation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const bankerUserId = requireUserId(req);
    const { dealId } = await ctx.params;
    const [borrowerRequests, bankerUnderwriteInputs, docFacts] =
      await Promise.all([
        listLoanRequests(dealId),
        listUnderwriteInputs(dealId),
        fetchDealDocFacts(dealId),
      ]);

    const normalized = normalizeUnderwrite({
      dealId,
      borrowerRequests,
      bankerUnderwriteInputs,
      docFacts,
    });

    const guard = underwriteConsistencyGuard({
      dealId,
      underwrite: normalized,
    });

    // Best-effort automation: never block the guard response
    let automation: any = { ok: true, changed: false };
    try {
      automation = await applyGuardAutomation({
        bankerUserId,
        guard: guard as any,
      });
    } catch (e: any) {
      automation = { ok: false, error: e?.message ?? "automation failed" };
    }

    return NextResponse.json({
      ok: true,
      guard,
      selected: normalized.selected,
      automation,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
