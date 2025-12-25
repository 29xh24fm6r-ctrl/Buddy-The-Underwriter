// src/app/api/banker/deals/[dealId]/underwrite/inputs/route.ts
import { NextResponse } from "next/server";
import {
  listLoanRequests,
  listUnderwriteInputs,
} from "@/lib/deals/loanRequests";
import { fetchDealDocFacts } from "@/lib/underwrite/docFacts";
import { normalizeUnderwrite } from "@/lib/underwrite/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

function toFlatVars(n: any) {
  // simple, deterministic flatten for models / exports
  return {
    dealId: n.dealId,
    primaryProductType: n.primaryProductType?.value ?? null,
    requestedProducts: n.requestedProducts ?? [],

    amount: n.amount?.value ?? null,
    termMonths: n.termMonths?.value ?? null,
    amortMonths: n.amortMonths?.value ?? null,
    interestOnlyMonths: n.interestOnlyMonths?.value ?? null,
    rateType: n.rateType?.value ?? null,
    rateIndex: n.rateIndex?.value ?? null,
    spreadBps: n.spreadBps?.value ?? null,

    purpose: n.purpose?.value ?? null,
    useOfProceeds: n.useOfProceeds?.value ?? null,
    collateralSummary: n.collateralSummary?.value ?? null,
    guarantorsSummary: n.guarantorsSummary?.value ?? null,

    guaranteePercent: n.guaranteePercent?.value ?? null,
    ltvTarget: n.ltvTarget?.value ?? null,
    dscrTarget: n.dscrTarget?.value ?? null,
    globalDscrTarget: n.globalDscrTarget?.value ?? null,
    pricingFloorRate: n.pricingFloorRate?.value ?? null,

    docFacts: n.docFacts ?? {},
    selectedBorrowerRequestId: n.selected?.borrowerRequestId ?? null,
    selectedBankerUnderwriteInputId:
      n.selected?.bankerUnderwriteInputId ?? null,
  };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    requireUserId(req);
    const { dealId } = await ctx.params;
    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "normalized"; // normalized | flat

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

    if (format === "flat") {
      return NextResponse.json({
        ok: true,
        format: "flat",
        underwrite: toFlatVars(normalized),
      });
    }

    return NextResponse.json({
      ok: true,
      format: "normalized",
      underwrite: normalized,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
