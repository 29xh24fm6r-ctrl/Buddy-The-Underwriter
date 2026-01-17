// src/app/api/deals/[dealId]/pricing/quote/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { quotePricing } from "@/lib/pricing/engine";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { clerkCurrentUser } from "@/lib/auth/clerkServer";
import { logDemoUsageEvent } from "@/lib/tenant/demoTelemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  requestedAmount: z.number().positive(),
  termMonths: z.number().int().positive(),
  riskRating: z.number().int().min(1).max(10),
  collateralStrength: z.enum(["strong", "moderate", "weak"]),
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
    const out = await quotePricing({ dealId, ...body });

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

    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "pricing quote failed" },
      { status: 500 },
    );
  }
}
