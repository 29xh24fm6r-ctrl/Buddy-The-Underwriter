import "server-only";

import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
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

const ROUTE = "/api/deals/[dealId]/borrower/debug";

async function buildPayload(dealId: string, correlationId: string) {
  const sb = supabaseAdmin();

  // 1) Load deal
  const dealResult = await safeWithTimeout(
    sb.from("deals")
      .select("id, bank_id, borrower_id, borrower_name, entity_type")
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

  // 2) Load borrower if attached
  let borrower: any = null;
  if (deal.borrower_id) {
    const bResult = await safeWithTimeout(
      sb.from("borrowers")
        .select("id, legal_name, entity_type, ein, naics_code, naics_description, primary_contact_name, primary_contact_email, state, state_of_formation, profile_provenance")
        .eq("id", deal.borrower_id)
        .maybeSingle(),
      5000,
      "borrower_lookup",
      correlationId,
    );
    if (bResult.ok) {
      borrower = bResult.data?.data ?? null;
    }
  }

  // 3) Load owners if borrower exists
  let owners: any[] = [];
  if (borrower?.id) {
    const oResult = await safeWithTimeout(
      sb.from("borrower_owners")
        .select("id, full_name, title, ownership_percent, ownership_source, is_guarantor, requires_pfs, source_doc_id")
        .eq("borrower_id", borrower.id)
        .order("ownership_percent", { ascending: false }),
      5000,
      "owners_lookup",
      correlationId,
    );
    if (oResult.ok && !oResult.data?.error) {
      owners = oResult.data?.data ?? [];
    }
  }

  // 4) Check document extraction state
  const docsResult = await safeWithTimeout(
    sb.from("deal_documents")
      .select("id, document_type, original_filename")
      .eq("deal_id", dealId)
      .limit(50),
    5000,
    "docs_lookup",
    correlationId,
  );
  const docs = docsResult.ok ? (docsResult.data?.data ?? []) : [];

  const taxReturnDocs = docs.filter((d: any) => {
    const dt = String(d.document_type ?? "").toLowerCase();
    const fn = String(d.original_filename ?? "").toLowerCase();
    return dt.includes("tax") || dt.includes("1120") || dt.includes("1065") || dt.includes("1040")
      || fn.includes("1120") || fn.includes("1065") || fn.includes("1040") || fn.includes("tax");
  });

  // 5) Check OCR coverage for tax docs
  let ocrCoverage = 0;
  if (taxReturnDocs.length > 0) {
    const ocrResult = await safeWithTimeout(
      sb.from("document_ocr_results")
        .select("attachment_id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .in("attachment_id", taxReturnDocs.map((d: any) => d.id)),
      5000,
      "ocr_check",
      correlationId,
    );
    if (ocrResult.ok) {
      ocrCoverage = (ocrResult.data as any)?.count ?? 0;
    }
  }

  // 6) Compute missing fields + autofill availability
  const missingFields: string[] = [];
  if (!borrower?.legal_name) missingFields.push("legal_name");
  if (!borrower?.entity_type) missingFields.push("entity_type");
  if (!borrower?.ein) missingFields.push("ein");
  if (!borrower?.naics_code) missingFields.push("naics_code");
  if (!borrower?.state) missingFields.push("state");
  if (!borrower?.primary_contact_name) missingFields.push("primary_contact");
  if (owners.length === 0) missingFields.push("owners");

  const autofillAvailable = taxReturnDocs.length > 0 && ocrCoverage > 0;

  // --- Omega belief augmentation (read-only, non-blocking) ---
  let omegaState: unknown = null;
  let omegaAvailable = false;
  if (deal.borrower_id) {
    try {
      const { readOmegaState } = await import("@/lib/omega/readOmegaState");
      const omegaResult = await readOmegaState({
        stateType: "borrower",
        id: deal.borrower_id,
        correlationId,
      });
      if (omegaResult.ok) {
        omegaState = omegaResult.data;
        omegaAvailable = true;
      }
    } catch {
      // Omega unavailable — no change to debug output
    }
  }

  return {
    ok: true,
    debug: {
      deal: {
        id: deal.id,
        bank_id: deal.bank_id,
        borrower_id: deal.borrower_id,
        borrower_name: deal.borrower_name,
      },
      borrower,
      owners,
      extraction: {
        tax_return_docs: taxReturnDocs.length,
        ocr_coverage: ocrCoverage,
        total_docs: docs.length,
      },
      suggestions: {
        autofill_available: autofillAvailable,
        missing_fields: missingFields,
        has_borrower: Boolean(deal.borrower_id),
      },
      omega_state: omegaState,
      omega_available: omegaAvailable,
    },
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = generateCorrelationId("bdbg");
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

    const result = await buildPayload(dealId, correlationId);

    return respond200({ ...result, meta: { dealId, correlationId, ts } } as any, headers);
  } catch (err) {
    const safe = sanitizeError(err, "borrower_debug_failed");
    return respond200({ ok: false, error: safe, meta: { dealId: "unknown", correlationId, ts } }, headers);
  }
}
