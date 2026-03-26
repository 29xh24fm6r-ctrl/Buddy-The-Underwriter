import { NextResponse } from "next/server";
import { upsertDealRecord } from "@/lib/db/dealRecords";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";

/**
 * POST /api/deals/seed
 *
 * Demo data seeding endpoint.
 * Phase 53C: Blocked in production, authenticated in non-prod.
 */
export async function POST(req: Request) {
  // Hard deny in production
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    console.warn("[deals/seed] Blocked seed route in production", {
      event: "seed_route_denied",
      environment: process.env.NODE_ENV,
      severity: "warn",
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ ok: false, error: "Not available" }, { status: 404 });
  }

  // In non-prod, require authenticated user
  if (isClerkConfigured()) {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    console.log("[deals/seed] Seed invoked by authenticated user", {
      event: "seed_route_invoked",
      userId,
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  }

  const body = await req.json().catch(() => ({}));
  const dealId = String(body?.dealId ?? "DEAL-DEMO-001");

  const record = upsertDealRecord({
    id: dealId,
    dealName: body?.dealName ?? "Real Deal Seed",
    status: body?.status ?? "UNDERWRITING",
    borrower: body?.borrower ?? {
      legalName: "Borrower LLC",
      naics: "xxxxxx",
      state: "FL",
    },
    sponsors: body?.sponsors ?? [
      { name: "Sponsor One", ownershipPct: 100, creditScore: 720 },
    ],
    facilities: body?.facilities ?? [
      {
        name: "Term Loan",
        amount: 1000000,
        termMonths: 120,
        rateType: "FLOATING",
        index: "SOFR",
        spreadBps: 450,
      },
    ],
    collateral: body?.collateral ?? [
      { type: "Real Estate", description: "Primary property", value: 1500000 },
    ],
    sourcesUses: body?.sourcesUses ?? {
      sources: [{ label: "Loan Proceeds", amount: 1000000 }],
      uses: [
        { label: "Purchase", amount: 950000 },
        { label: "Closing Costs", amount: 50000 },
      ],
    },
    financials: body?.financials ?? [],
  });

  return NextResponse.json({ ok: true, deal: record });
}
