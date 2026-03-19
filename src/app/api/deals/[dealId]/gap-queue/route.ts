import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeDealGaps, REQUIRED_FACT_KEYS } from "@/lib/gapEngine/computeDealGaps";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET — returns current gap queue state, always recomputing first.
 *
 * This route is self-healing by design. Every call to GET triggers
 * computeDealGaps() before reading, so the UI always reflects the true
 * state of the deal regardless of whether gaps were previously seeded.
 *
 * This prevents the "Complete" false positive that occurs when the gap
 * queue was never populated for a deal.
 */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    // Always recompute before reading — ensures queue is never stale or empty
    // from a deal that was never seeded. Non-fatal: if this fails, we still
    // return whatever is in the queue rather than erroring the whole request.
    await computeDealGaps({ dealId, bankId: bankPick.bankId }).catch((err) => {
      console.error("[gap-queue GET] computeDealGaps failed (non-fatal)", err);
    });

    const sb = supabaseAdmin();
    const { data: gaps } = await sb
      .from("deal_gap_queue")
      .select("*")
      .eq("deal_id", dealId)
      .eq("bank_id", bankPick.bankId)
      .eq("status", "open")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });

    // Completeness score: confirmed required facts / total required facts
    // This is the ONLY accurate measure of deal completeness.
    // A deal is NOT complete just because the gap queue is empty —
    // it is complete only when all required facts have resolution_status = 'confirmed'.
    const { data: confirmedFacts } = await sb
      .from("deal_financial_facts")
      .select("fact_key")
      .eq("deal_id", dealId)
      .eq("bank_id", bankPick.bankId)
      .eq("resolution_status", "confirmed")
      .eq("is_superseded", false)
      .in("fact_key", REQUIRED_FACT_KEYS as unknown as string[]);

    const totalRequired = REQUIRED_FACT_KEYS.length;
    const confirmedRequired = (confirmedFacts ?? []).filter(f =>
      (REQUIRED_FACT_KEYS as readonly string[]).includes(f.fact_key)
    ).length;
    const completenessScore = Math.round((confirmedRequired / totalRequired) * 100);
    const isGenuinelyComplete = confirmedRequired === totalRequired;

    return NextResponse.json({
      ok: true,
      gaps: gaps ?? [],
      openCount: (gaps ?? []).length,
      completenessScore,
      // isGenuinelyComplete = ALL required facts have been banker-confirmed.
      // Use this — not openCount === 0 — to decide whether to show "Complete".
      isGenuinelyComplete,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// POST — explicit gap recompute trigger (e.g. after manual confirmation)
export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const result = await computeDealGaps({ dealId, bankId: bankPick.bankId });
    return NextResponse.json(result);
  } catch (e: unknown) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
