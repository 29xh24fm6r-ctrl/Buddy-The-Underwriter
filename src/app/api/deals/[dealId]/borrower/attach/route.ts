import "server-only";

import { NextResponse, NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
  validateUuidParam,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/deals/[dealId]/borrower/attach";

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = generateCorrelationId("batt");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const uuidCheck = validateUuidParam(dealId, "dealId");
    if (!uuidCheck.ok) {
      return respond200({ ok: false, error: { code: "invalid_deal_id", message: uuidCheck.error }, meta: { dealId: String(dealId), correlationId, ts } }, headers);
    }

    const body = await req.json().catch(() => ({}));
    const borrowerId = body?.borrowerId as string | undefined;

    if (!borrowerId) {
      return respond200({ ok: false, error: { code: "missing_borrower_id", message: "borrowerId is required" }, meta: { dealId, correlationId, ts } }, headers);
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return respond200({ ok: false, error: { code: access.error, message: `Access denied: ${access.error}` }, meta: { dealId, correlationId, ts } }, headers);
    }

    const sb = supabaseAdmin();

    // Verify borrower belongs to same bank (tenant safety)
    const { data: borrower } = await sb
      .from("borrowers")
      .select("id, legal_name, bank_id")
      .eq("id", borrowerId)
      .maybeSingle();

    if (!borrower) {
      return respond200({ ok: false, error: { code: "borrower_not_found", message: "Borrower not found" }, meta: { dealId, correlationId, ts } }, headers);
    }

    if (borrower.bank_id !== access.bankId) {
      return respond200({ ok: false, error: { code: "tenant_mismatch", message: "Borrower belongs to a different bank" }, meta: { dealId, correlationId, ts } }, headers);
    }

    const { data, error } = await sb
      .from("deals")
      .update({
        borrower_id: borrowerId,
        borrower_name: borrower.legal_name ?? null,
      })
      .eq("id", dealId)
      .eq("bank_id", access.bankId)
      .select("id, borrower_id")
      .maybeSingle();

    if (error || !data) {
      return respond200({ ok: false, error: { code: "attach_failed", message: error?.message ?? "Failed to attach borrower" }, meta: { dealId, correlationId, ts } }, headers);
    }

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "deal.borrower.attached",
      uiState: "done",
      uiMessage: "Borrower attached",
      meta: {
        deal_id: dealId,
        borrower_id: borrowerId,
        correlationId,
      },
    });

    return respond200({ ok: true, dealId, borrowerId, meta: { dealId, correlationId, ts } }, headers);
  } catch (error: unknown) {
    rethrowNextErrors(error);

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: error.code === "not_authenticated" ? 401 : 403 },
      );
    }

    const safe = sanitizeError(error, "borrower_attach_failed");
    return respond200({ ok: false, error: safe, meta: { dealId: "unknown", correlationId, ts } }, headers);
  }
}
