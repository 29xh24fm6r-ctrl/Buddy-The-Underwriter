import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { verifyDealIdMatch } from "@/lib/integrity/dealIdGuard";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string; memoId: string }> },
) {

  const { dealId, memoId } = await ctx.params;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("credit_memo_citations")
    .select("*")
    .eq("deal_id", dealId)
    .eq("memo_draft_id", memoId)
    .order("created_at", { ascending: true });

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );

  // P0c integrity guard: defense-in-depth verify every returned citation
  // belongs to the route's dealId. The .eq("deal_id", dealId) filter above
  // should make a mismatch impossible — if any row leaks through, fail
  // loudly with no fallback.
  for (const row of data ?? []) {
    const check = verifyDealIdMatch(
      row as { deal_id: string | null; id?: string },
      dealId,
      {
        surface: "credit-memo/citations",
        recordKind: "CreditMemoCitation",
        recordId: (row as { id?: string }).id ?? null,
      },
    );
    if (!check.ok) {
      return NextResponse.json(
        { ok: false, error: "data_integrity_violation", reason: check.reason },
        { status: 409 },
      );
    }
  }

  return NextResponse.json({ ok: true, citations: data || [] });
}
