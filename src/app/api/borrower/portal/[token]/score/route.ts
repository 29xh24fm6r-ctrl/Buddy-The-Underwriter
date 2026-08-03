import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

export async function GET(
  _req: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid token" },
      { status: 401 },
    );
  }

  const sb = supabaseAdmin();

  const { data: row } = await sb
    .from("buddy_sba_scores")
    .select("*")
    .eq("deal_id", ctx.dealId)
    .eq("score_status", "locked")
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    const { data: draft } = await sb
      .from("buddy_sba_scores")
      .select("*")
      .eq("deal_id", ctx.dealId)
      .eq("score_status", "draft")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!draft) {
      return NextResponse.json({ ok: true, score: null });
    }

    return NextResponse.json({
      ok: true,
      score: toBorrowerView(draft),
    });
  }

  return NextResponse.json({
    ok: true,
    score: toBorrowerView(row),
  });
}

function toBorrowerView(row: Record<string, unknown>) {
  const failures = Array.isArray(row.eligibility_failures) ? row.eligibility_failures : [];
  return {
    score: row.score,
    band: row.band,
    eligibilityPassed: row.eligibility_passed,
    eligibilityFailures: failures.map((f: Record<string, unknown>) => ({
      check: f.check,
      reason: f.reason,
    })),
    topStrengths: row.top_strengths ?? [],
    topWeaknesses: row.top_weaknesses ?? [],
    narrative: row.narrative ?? "",
    computedAt: row.computed_at ?? null,
  };
}
