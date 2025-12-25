// src/app/api/banker/pricing/policies/seed/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

export async function POST(req: Request) {
  try {
    requireUserId(req);
    const sb = supabaseAdmin();

    // Create active policy
    const { data: pol, error: pErr } = await sb
      .from("pricing_policies")
      .insert({
        name: "Policy v1",
        status: "active",
        effective_date: new Date().toISOString().slice(0, 10),
        notes: "Seeded by API",
      })
      .select("*")
      .single();
    if (pErr) throw pErr;

    // Minimal grid examples (you will replace)
    const rows = [
      {
        product_type: "SBA_7A",
        risk_grade: "1",
        term_min_months: 1,
        term_max_months: 60,
        base_spread_bps: 250,
      },
      {
        product_type: "SBA_7A",
        risk_grade: "1",
        term_min_months: 61,
        term_max_months: 120,
        base_spread_bps: 275,
      },
      {
        product_type: "SBA_7A",
        risk_grade: "6",
        term_min_months: 1,
        term_max_months: 60,
        base_spread_bps: 325,
      },
      {
        product_type: "SBA_7A",
        risk_grade: "6",
        term_min_months: 61,
        term_max_months: 120,
        base_spread_bps: 350,
      },
      {
        product_type: "CLOC",
        risk_grade: "6",
        term_min_months: 1,
        term_max_months: 60,
        base_spread_bps: 400,
      },
    ].map((r) => ({ ...r, policy_id: pol.id }));

    const { error: gErr } = await sb.from("pricing_grid_rows").insert(rows);
    if (gErr) throw gErr;

    return NextResponse.json({ ok: true, policyId: pol.id, rows: rows.length });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
