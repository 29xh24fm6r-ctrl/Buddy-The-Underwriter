// src/app/api/dashboard/overview/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { DashboardFiltersSchema } from "@/lib/dashboard/contracts";
import { fetchDealsForDashboard, computePipelineKpis } from "@/lib/dashboard/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  filters: DashboardFiltersSchema.optional().default({}),
});

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json());
    const deals = await fetchDealsForDashboard({
      userId: body.filters.userId,
      stage: body.filters.stage,
      dealType: body.filters.dealType,
    });

    const kpis = computePipelineKpis(deals);

    return NextResponse.json({ ok: true, kpis });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
