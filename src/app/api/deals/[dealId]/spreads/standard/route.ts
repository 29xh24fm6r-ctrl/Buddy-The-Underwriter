import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { computeAuthoritativeEngine } from "@/lib/modelEngine/engineAuthority";
import { emitV2Event, V2_EVENT_CODES } from "@/lib/modelEngine/events";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

    // Query IRS identity validation results for this deal
    const sb = supabaseAdmin();
    const { data: validationRows } = await (sb as any)
      .from("deal_document_validation_results")
      .select("document_id, status, summary")
      .eq("deal_id", dealId);

    const rows = (validationRows ?? []) as { document_id: string; status: string; summary: string | null }[];
    const blockedDocs = rows.filter(r => r.status === "BLOCKED");
    const flaggedDocs = rows.filter(r => r.status === "FLAGGED");

    const validationGate = {
      blocked: blockedDocs.length > 0,
      requiresAnalystSignOff: flaggedDocs.length > 0,
      reason: blockedDocs.length > 0
        ? `${blockedDocs.length} document(s) failed IRS identity validation. Correct extraction before proceeding.`
        : flaggedDocs.length > 0
          ? `${flaggedDocs.length} document(s) require analyst verification before distribution.`
          : rows.length > 0
            ? "All documents verified."
            : "No validated documents.",
      blockedDocuments: blockedDocs.map(d => ({ documentId: d.document_id, summary: d.summary })),
      flaggedDocuments: flaggedDocs.map(d => ({ documentId: d.document_id, summary: d.summary })),
    };

    return NextResponse.json({
      ok: true,
      dealId,
      viewModel: authResult.viewModel,
      validation: authResult.validation,
      snapshotId: authResult.snapshotId ?? null,
      validationGate,
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

    return NextResponse.json({
      ok: false,
      error: "unexpected_error",
      detail: e?.message ?? String(e),
      stack: process.env.NODE_ENV !== "production" ? e?.stack : undefined,
    }, { status: 500 });
  }
}
