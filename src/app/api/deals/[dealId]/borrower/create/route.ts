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

const ROUTE = "/api/deals/[dealId]/borrower/create";

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = generateCorrelationId("bcrt");
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
    const legalName = String(body?.legal_name ?? "").trim();
    const entityType = String(body?.entity_type ?? "").trim();
    const primaryContactName = String(body?.primary_contact_name ?? "").trim();
    const primaryContactEmail = String(body?.primary_contact_email ?? "").trim();
    const ein = String(body?.ein ?? "").trim();

    if (!legalName) {
      return respond200({ ok: false, error: { code: "legal_name_required", message: "Legal name is required" }, meta: { dealId, correlationId, ts } }, headers);
    }
    if (!entityType) {
      return respond200({ ok: false, error: { code: "entity_type_required", message: "Entity type is required" }, meta: { dealId, correlationId, ts } }, headers);
    }
    if (!primaryContactName || !primaryContactEmail) {
      return respond200({ ok: false, error: { code: "primary_contact_required", message: "Primary contact name and email are required" }, meta: { dealId, correlationId, ts } }, headers);
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return respond200({ ok: false, error: { code: access.error, message: `Access denied: ${access.error}` }, meta: { dealId, correlationId, ts } }, headers);
    }

    const sb = supabaseAdmin();

    const { data: borrower, error: createError } = await sb
      .from("borrowers")
      .insert({
        bank_id: access.bankId,
        legal_name: legalName,
        entity_type: entityType,
        primary_contact_name: primaryContactName,
        primary_contact_email: primaryContactEmail,
        ein: ein || null,
      })
      .select("id, legal_name")
      .single();

    if (createError || !borrower) {
      return respond200({ ok: false, error: { code: "create_failed", message: createError?.message ?? "Failed to create borrower" }, meta: { dealId, correlationId, ts } }, headers);
    }

    const { error: attachError } = await sb
      .from("deals")
      .update({ borrower_id: borrower.id, borrower_name: borrower.legal_name ?? null })
      .eq("id", dealId)
      .eq("bank_id", access.bankId);

    if (attachError) {
      return respond200({ ok: false, error: { code: "attach_failed", message: attachError.message }, meta: { dealId, correlationId, ts } }, headers);
    }

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "deal.borrower.attached",
      uiState: "done",
      uiMessage: "Borrower attached",
      meta: {
        deal_id: dealId,
        borrower_id: borrower.id,
        created: true,
        correlationId,
      },
    });

    return respond200({ ok: true, borrowerId: borrower.id, meta: { dealId, correlationId, ts } }, headers);
  } catch (error: unknown) {
    rethrowNextErrors(error);

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: error.code === "not_authenticated" ? 401 : 403 },
      );
    }

    const safe = sanitizeError(error, "borrower_create_failed");
    return respond200({ ok: false, error: safe, meta: { dealId: "unknown", correlationId, ts } }, headers);
  }
}
