import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = Promise<{ dealId: string }>;

interface AnnualRow {
  revenue: number;
}

interface DiffPkg {
  id: string;
  version_number: number;
  created_at: string;
  dscr_year1_base: number | null;
  dscr_year2_base: number | null;
  dscr_year3_base: number | null;
  break_even_revenue: number | null;
  margin_of_safety_pct: number | null;
  projections_annual: AnnualRow[] | null;
}

const FIELDS: Array<keyof DiffPkg | "revenue_year1"> = [
  "dscr_year1_base",
  "dscr_year2_base",
  "dscr_year3_base",
  "break_even_revenue",
  "margin_of_safety_pct",
  "revenue_year1",
];

function selectField(pkg: DiffPkg, field: string): number | null {
  if (field === "revenue_year1") {
    const first = pkg.projections_annual?.[0]?.revenue;
    return typeof first === "number" ? first : null;
  }
  const value = (pkg as unknown as Record<string, unknown>)[field];
  return typeof value === "number" ? value : null;
}

export async function GET(req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const v1Id = searchParams.get("v1");
    const v2Id = searchParams.get("v2");
    if (!v1Id || !v2Id) {
      return NextResponse.json(
        { ok: false, error: "v1 and v2 query params are required" },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("buddy_sba_packages")
      .select(
        "id, version_number, created_at, deal_id, dscr_year1_base, dscr_year2_base, dscr_year3_base, break_even_revenue, margin_of_safety_pct, projections_annual",
      )
      .in("id", [v1Id, v2Id])
      .eq("deal_id", dealId);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    const v1 = (data ?? []).find((p) => p.id === v1Id) as DiffPkg | undefined;
    const v2 = (data ?? []).find((p) => p.id === v2Id) as DiffPkg | undefined;

    if (!v1 || !v2) {
      return NextResponse.json(
        { ok: false, error: "One or both package IDs not found for this deal" },
        { status: 404 },
      );
    }

    const changes = FIELDS.map((field) => {
      const v1Value = selectField(v1, field as string);
      const v2Value = selectField(v2, field as string);
      const delta =
        v1Value !== null && v2Value !== null ? v2Value - v1Value : null;
      return { field, v1Value, v2Value, delta };
    });

    return NextResponse.json({ ok: true, v1, v2, changes });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
