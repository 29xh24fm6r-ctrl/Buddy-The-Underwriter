import "server-only";

import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { autofillBorrowerFromDocs } from "@/lib/borrower/autofillBorrower";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
  safeWithTimeout,
  validateUuidParam,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/deals/[dealId]/borrower/ensure";

type EnsureBody = {
  source?: "manual" | "autofill" | "existing";
  borrowerId?: string;
  legal_name?: string;
  entity_type?: string;
  ein?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
  include_owners?: boolean;
};

async function buildPayload(
  dealId: string,
  bankId: string,
  body: EnsureBody,
  correlationId: string,
) {
  const sb = supabaseAdmin();
  const source = body.source ?? "manual";
  const warnings: string[] = [];

  // ── Ledger: ensure started ─────────────────────────────
  await logLedgerEvent({
    dealId,
    bankId,
    eventKey: "buddy.borrower.ensure_started",
    uiState: "working",
    uiMessage: `Borrower ensure started (${source})`,
    meta: { source, correlationId },
  });

  // ── Load deal ──────────────────────────────────────────
  const dealResult = await safeWithTimeout(
    sb.from("deals")
      .select("id, bank_id, borrower_id, borrower_name")
      .eq("id", dealId)
      .maybeSingle(),
    5000,
    "deal_lookup",
    correlationId,
  );

  if (!dealResult.ok) {
    return { ok: false, error: { code: "deal_lookup_failed", message: dealResult.error } };
  }

  const deal = dealResult.data?.data;
  if (!deal) {
    return { ok: false, error: { code: "deal_not_found", message: "Deal not found" } };
  }

  // ── If already attached → return current borrower ──────
  if (deal.borrower_id && source !== "existing") {
    const existing = await safeWithTimeout(
      sb.from("borrowers")
        .select("id, legal_name, ein, naics_code, entity_type")
        .eq("id", deal.borrower_id)
        .maybeSingle(),
      5000,
      "borrower_lookup",
      correlationId,
    );

    const borrower = existing.ok ? existing.data?.data : null;

    // If autofill requested on existing borrower, still run it
    if (source === "autofill" && borrower) {
      const autofill = await autofillBorrowerFromDocs({
        dealId,
        bankId,
        borrowerId: borrower.id,
        includeOwners: body.include_owners ?? true,
      });

      if (autofill.ok) {
        await logLedgerEvent({
          dealId,
          bankId,
          eventKey: "buddy.borrower.autofilled_from_docs",
          uiState: "done",
          uiMessage: `Autofilled ${autofill.fieldsAutofilled.length} fields`,
          meta: { correlationId, fields: autofill.fieldsAutofilled, owners: autofill.ownersUpserted },
        });
      }

      return {
        ok: true,
        action: "autofilled",
        borrower: { ...borrower, ...autofill.borrowerPatch },
        created: false,
        attached: true,
        updatedFromDocs: autofill.ok,
        fields_autofilled: autofill.fieldsAutofilled,
        field_statuses: autofill.fieldStatuses,
        extracted_confidence: autofill.extractedConfidence,
        owners_created: autofill.ownersUpserted,
        warnings: [...warnings, ...autofill.warnings],
      };
    }

    return {
      ok: true,
      action: "already_attached",
      borrower: borrower ?? { id: deal.borrower_id, legal_name: deal.borrower_name },
      created: false,
      attached: true,
      updatedFromDocs: false,
      warnings,
    };
  }

  // ── SOURCE: existing → attach existing borrower ────────
  if (source === "existing") {
    const borrowerId = body.borrowerId;
    if (!borrowerId) {
      return { ok: false, error: { code: "missing_borrower_id", message: "borrowerId is required for source=existing" } };
    }

    // Verify borrower belongs to same bank
    const bResult = await safeWithTimeout(
      sb.from("borrowers")
        .select("id, legal_name, bank_id, ein, naics_code, entity_type")
        .eq("id", borrowerId)
        .maybeSingle(),
      5000,
      "borrower_tenant_check",
      correlationId,
    );

    if (!bResult.ok) {
      return { ok: false, error: { code: "borrower_lookup_failed", message: bResult.error } };
    }

    const borrower = bResult.data?.data;
    if (!borrower) {
      return { ok: false, error: { code: "borrower_not_found", message: "Borrower not found" } };
    }

    if (borrower.bank_id !== bankId) {
      return { ok: false, error: { code: "tenant_mismatch", message: "Borrower belongs to a different bank" } };
    }

    // Attach
    const attachResult = await safeWithTimeout(
      sb.from("deals")
        .update({ borrower_id: borrower.id, borrower_name: borrower.legal_name ?? null })
        .eq("id", dealId)
        .eq("bank_id", bankId),
      5000,
      "deal_attach",
      correlationId,
    );

    if (!attachResult.ok) {
      return { ok: false, error: { code: "attach_failed", message: attachResult.error } };
    }

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "buddy.borrower.attached",
      uiState: "done",
      uiMessage: "Existing borrower attached",
      meta: { correlationId, borrower_id: borrower.id, created: false },
    });

    return {
      ok: true,
      action: "attached",
      borrower,
      created: false,
      attached: true,
      updatedFromDocs: false,
      warnings,
    };
  }

  // ── SOURCE: manual or autofill → create new borrower ───
  const legalName = source === "manual"
    ? String(body.legal_name ?? "").trim()
    : "Pending Autofill";

  if (source === "manual" && !legalName) {
    return { ok: false, error: { code: "legal_name_required", message: "Legal name is required" } };
  }

  const entityType = String(body.entity_type ?? "Unknown").trim() || "Unknown";
  const contactName = String(body.primary_contact_name ?? "").trim() || null;
  const contactEmail = String(body.primary_contact_email ?? "").trim() || null;
  const ein = String(body.ein ?? "").trim() || null;

  const createResult = await safeWithTimeout(
    sb.from("borrowers")
      .insert({
        bank_id: bankId,
        legal_name: legalName,
        entity_type: entityType,
        primary_contact_name: contactName,
        primary_contact_email: contactEmail,
        ein,
      })
      .select("id, legal_name, ein, entity_type")
      .single(),
    8000,
    "borrower_create",
    correlationId,
  );

  if (!createResult.ok) {
    return { ok: false, error: { code: "borrower_create_failed", message: createResult.error } };
  }

  const newBorrower = createResult.data?.data;
  if (!newBorrower || createResult.data?.error) {
    return { ok: false, error: { code: "borrower_create_failed", message: createResult.data?.error?.message ?? "Insert returned no data" } };
  }

  await logLedgerEvent({
    dealId,
    bankId,
    eventKey: "buddy.borrower.created",
    uiState: "done",
    uiMessage: `Borrower created: ${newBorrower.legal_name}`,
    meta: { correlationId, borrower_id: newBorrower.id },
  });

  // Attach to deal
  const attachResult = await safeWithTimeout(
    sb.from("deals")
      .update({ borrower_id: newBorrower.id, borrower_name: newBorrower.legal_name ?? null })
      .eq("id", dealId)
      .eq("bank_id", bankId),
    5000,
    "deal_attach_new",
    correlationId,
  );

  if (!attachResult.ok) {
    warnings.push(`attach_warning: ${attachResult.error}`);
  }

  await logLedgerEvent({
    dealId,
    bankId,
    eventKey: "buddy.borrower.attached",
    uiState: "done",
    uiMessage: "Borrower attached to deal",
    meta: { correlationId, borrower_id: newBorrower.id, created: true },
  });

  // ── Autofill if requested ──────────────────────────────
  let updatedFromDocs = false;
  let fieldsAutofilled: string[] = [];
  let ownersCreated = 0;
  let fieldStatuses: unknown[] = [];
  let extractedConfidence: Record<string, number> = {};

  if (source === "autofill") {
    const autofill = await autofillBorrowerFromDocs({
      dealId,
      bankId,
      borrowerId: newBorrower.id,
      includeOwners: body.include_owners ?? true,
    });

    updatedFromDocs = autofill.ok;
    fieldsAutofilled = autofill.fieldsAutofilled;
    ownersCreated = autofill.ownersUpserted;
    fieldStatuses = autofill.fieldStatuses;
    extractedConfidence = autofill.extractedConfidence;
    warnings.push(...autofill.warnings);

    if (autofill.ok) {
      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "buddy.borrower.autofilled_from_docs",
        uiState: "done",
        uiMessage: `Autofilled ${autofill.fieldsAutofilled.length} fields from documents`,
        meta: { correlationId, fields: autofill.fieldsAutofilled, owners: autofill.ownersUpserted },
      });

      // Re-read borrower to get updated fields
      const reread = await sb.from("borrowers")
        .select("id, legal_name, ein, naics_code, entity_type, naics_description, state, state_of_formation")
        .eq("id", newBorrower.id)
        .maybeSingle();

      if (reread.data) {
        return {
          ok: true,
          action: "created" as const,
          borrower: reread.data,
          created: true,
          attached: true,
          updatedFromDocs: true,
          fields_autofilled: fieldsAutofilled,
          field_statuses: fieldStatuses,
          extracted_confidence: extractedConfidence,
          owners_created: ownersCreated,
          warnings,
        };
      }
    }
  }

  return {
    ok: true,
    action: "created" as const,
    borrower: newBorrower,
    created: true,
    attached: true,
    updatedFromDocs,
    fields_autofilled: fieldsAutofilled,
    owners_created: ownersCreated,
    warnings,
  };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = generateCorrelationId("bens");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const uuidCheck = validateUuidParam(dealId, "dealId");
    if (!uuidCheck.ok) {
      return respond200({ ok: false, error: { code: "invalid_deal_id", message: uuidCheck.error }, meta: { dealId: String(dealId), correlationId, ts } }, headers);
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return respond200({ ok: false, error: { code: access.error, message: `Access denied: ${access.error}` }, meta: { dealId, correlationId, ts } }, headers);
    }

    const body = await req.json().catch(() => ({} as EnsureBody));
    const result = await buildPayload(dealId, access.bankId, body, correlationId);

    // After successful borrower attach/create, trigger lifecycle recompute + naming
    // (fire-and-forget — must not delay the response)
    if (result.ok && result.attached) {
      void (async () => {
        try {
          const { recomputeDealReady } = await import("@/lib/deals/readiness");
          await recomputeDealReady(dealId);
        } catch {}
        try {
          const { maybeTriggerDealNaming } = await import(
            "@/lib/naming/maybeTriggerDealNaming"
          );
          await maybeTriggerDealNaming(dealId, {
            bankId: access.bankId,
            reason: "borrower_attached",
          });
        } catch {}
      })();
    }

    return respond200({ ...result, meta: { dealId, correlationId, ts } } as any, headers);
  } catch (err) {
    const safe = sanitizeError(err, "borrower_ensure_failed");
    return respond200({ ok: false, error: safe, meta: { dealId: "unknown", correlationId, ts } }, headers);
  }
}
