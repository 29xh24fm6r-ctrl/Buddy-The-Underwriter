// src/app/api/banker/deals/[dealId]/pricing/quote/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { computePricing, formatBorrowerRate } from "@/lib/pricing/compute";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { clerkCurrentUser } from "@/lib/auth/clerkServer";
import { logDemoUsageEvent } from "@/lib/tenant/demoTelemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  productType: z.string().min(1),
  riskGrade: z.string().min(1),
  termMonths: z.number().int().positive(),
  indexName: z.string().min(1).default("SOFR"),
  indexRateBps: z.number().int().nonnegative(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok)
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "unauthorized" ? 401 : 403 },
      );

    const body = BodySchema.parse(await req.json());
    const { productType, riskGrade, termMonths, indexName, indexRateBps } = body;

    const res = await computePricing({
      dealId,
      productType,
      riskGrade,
      termMonths,
      indexName,
      indexRateBps,
    });

    const user = await clerkCurrentUser();
    const email =
      user?.emailAddresses?.find((e) => e.id === user.primaryEmailAddressId)
        ?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;

    await logDemoUsageEvent({
      email,
      bankId: access.ok ? access.bankId : null,
      path: new URL(req.url).pathname,
      eventType: "action",
      label: "pricing_quote",
    });

    return NextResponse.json({
      ok: true,
      quote: {
        id: res.quoteId,
        final_rate_bps: res.finalRateBps,
        final_rate: formatBorrowerRate(res.finalRateBps),
        base_spread_bps: res.baseSpreadBps,
        override_spread_bps: res.overrideSpreadBps,
        explain: res.explain,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
