// src/app/api/dashboard/predictions/refresh/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchDealsForDashboard } from "@/lib/dashboard/analytics";
import { scoreDealRulesV1 } from "@/lib/dashboard/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const sb = supabaseAdmin();

    const deals = await fetchDealsForDashboard({});
    const openDeals = deals.filter((d) => {
      const st = String(d.stage || "").toLowerCase();
      return !st.includes("closed") && !st.includes("declined");
    });

    // Compute + upsert prediction cache
    for (const d of openDeals) {
      const s = scoreDealRulesV1(d);
      const up = await sb.from("deal_predictions").upsert(
        {
          deal_id: d.id,
          probability: s.probability,
          eta_close_date: s.eta_close_date,
          risk_flags: s.risk_flags,
          reasons: s.reasons,
          computed_at: new Date().toISOString(),
          model_version: "rules_v1",
        },
        { onConflict: "deal_id" }
      );
      if (up.error) throw up.error;
    }

    return NextResponse.json({ ok: true, refreshed: openDeals.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
