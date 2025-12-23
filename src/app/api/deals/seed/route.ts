import { NextResponse } from "next/server";
import { upsertDealRecord } from "@/lib/db/dealRecords";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const dealId = String(body?.dealId ?? "DEAL-DEMO-001");

  const record = upsertDealRecord({
    id: dealId,
    dealName: body?.dealName ?? "Real Deal Seed",
    status: body?.status ?? "UNDERWRITING",
    borrower: body?.borrower ?? { legalName: "Borrower LLC", naics: "xxxxxx", state: "FL" },
    sponsors: body?.sponsors ?? [{ name: "Sponsor One", ownershipPct: 100, creditScore: 720 }],
    facilities: body?.facilities ?? [{ name: "Term Loan", amount: 1000000, termMonths: 120, rateType: "FLOATING", index: "SOFR", spreadBps: 450 }],
    collateral: body?.collateral ?? [{ type: "Real Estate", description: "Primary property", value: 1500000 }],
    sourcesUses: body?.sourcesUses ?? {
      sources: [{ label: "Loan Proceeds", amount: 1000000 }],
      uses: [{ label: "Purchase", amount: 950000 }, { label: "Closing Costs", amount: 50000 }],
    },
    financials: body?.financials ?? [],
  });

  return NextResponse.json({ ok: true, deal: record });
}
