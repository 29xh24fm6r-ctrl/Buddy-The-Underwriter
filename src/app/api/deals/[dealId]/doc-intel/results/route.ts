// src/app/api/deals/[dealId]/doc-intel/results/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
    const { dealId } = await ctx.params;
await requireRole(["super_admin", "bank_admin", "underwriter"]);

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("doc_intel_results")
    .select(
      "id, file_id, doc_type, tax_year, extracted_json, quality_json, confidence, evidence_json, created_at",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  return NextResponse.json({ ok: true, results: data ?? [] });
}
