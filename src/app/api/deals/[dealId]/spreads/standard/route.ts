import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { computeAuthoritativeEngine } from "@/lib/modelEngine/engineAuthority";
import { emitV2Event, V2_EVENT_CODES } from "@/lib/modelEngine/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/spreads/standard
 *
 * Authoritative V2 standard spread endpoint.
 * No V1 fallback. No legacy comparison. V2 is sole engine.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    // V2 authoritative — all persistence happens inside
    const authResult = await computeAuthoritativeEngine(dealId, access.bankId);

    return NextResponse.json({
      ok: true,
      dealId,
      viewModel: authResult.viewModel,
      validation: authResult.validation,
      snapshotId: authResult.snapshotId ?? null,
    });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[/api/deals/[dealId]/spreads/standard]", e);

    emitV2Event({
      code: V2_EVENT_CODES.MODEL_V2_HARD_FAILURE,
      dealId: "unknown",
      payload: { surface: "standard", error: e?.message ?? "unknown" },
    });

    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
