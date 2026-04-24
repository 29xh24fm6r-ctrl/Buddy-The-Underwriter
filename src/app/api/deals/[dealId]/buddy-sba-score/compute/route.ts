import "server-only";

/**
 * POST /api/deals/[dealId]/buddy-sba-score/compute
 *
 * Computes the Buddy SBA Score for a deal. Persists via the transactional
 * supersede-and-insert RPC. Returns the full BuddySBAScore object.
 *
 * Authorization: requireDealAccess from src/lib/server/authz.ts enforces
 * tenant isolation on the deal (no caller-supplied bank ID).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/server/authz";
import { computeBuddySBAScore } from "@/lib/score/buddySbaScore";
import type { ComputationContext } from "@/lib/score/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ComputeBody = {
  context?: ComputationContext;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;
  try {
    await requireDealAccess(dealId);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status =
      e?.name === "AuthenticationRequiredError" ? 401 :
      e?.name === "DealAccessDeniedError" ? 404 :
      e?.name === "BankMembershipRequiredError" ? 403 :
      500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }

  let body: ComputeBody = {};
  try {
    body = (await req.json()) as ComputeBody;
  } catch {
    // Empty body is fine — context defaults to "manual".
  }

  const sb = supabaseAdmin();

  try {
    const score = await computeBuddySBAScore({
      dealId,
      sb,
      context: body.context ?? "manual",
    });
    return NextResponse.json({ ok: true, result: score });
  } catch (e: any) {
    console.error("[buddy-sba-score/compute] failed", {
      dealId,
      error: e?.message ?? String(e),
    });
    return NextResponse.json(
      { ok: false, error: e?.message ?? "compute_failed" },
      { status: 500 },
    );
  }
}
