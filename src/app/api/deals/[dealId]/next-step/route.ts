import "server-only";

import { NextResponse } from "next/server";
import { computeNextStep } from "@/core/nextStep/computeNextStep";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;

  if (!dealId) {
    return NextResponse.json({ ok: false, error: "missing_deal_id" }, { status: 400 });
  }

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "unauthorized" ? 401 : access.error === "tenant_mismatch" ? 403 : 404;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  const nextAction = await computeNextStep({ dealId });

  const isBuilder = process.env.NEXT_PUBLIC_BUDDY_ROLE === "builder";
  if (isBuilder) {
    try {
      await logLedgerEvent({
        dealId,
        bankId: access.bankId,
        eventKey: "deal.next_step.computed",
        uiState: "done",
        uiMessage: "Next step computed",
        meta: {
          deal_id: dealId,
          nextAction: nextAction.key,
          missing:
            "missing" in nextAction
              ? nextAction.missing
              : "missingDocCodes" in nextAction
                ? nextAction.missingDocCodes
                : [],
          computedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error("[next-step] failed to log ledger event", err);
    }
  }

  return NextResponse.json({ ok: true, nextAction });
}
