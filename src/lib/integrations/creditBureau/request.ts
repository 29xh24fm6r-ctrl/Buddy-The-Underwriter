import * as crypto from "node:crypto";
import { parseCreditReport, type ParsedCreditReport } from "./parser";
import { detectAbnormalities } from "./gapDetector";

/**
 * SPEC S4 B-1 — soft-pull orchestration. Kept free of "server-only" so it
 * stays testable under `node --test` (same pattern as kyc/service.ts,
 * esign/docuseal/service.ts). API routes inject the real Supabase client
 * and the real vendor client function; tests inject fakes.
 *
 * **Three-layer soft-pull guard (principle #20 — no exceptions, no
 * flags):**
 *   1. DB — `borrower_credit_pulls.pull_type` has `CHECK (pull_type = 'soft')`.
 *   2. Service layer (here) — `pull_type: "soft"` is hardcoded into the
 *      insert row; there is no parameter that can change it.
 *   3. Vendor request — `client.ts#requestVendorSoftPull` hardcodes
 *      `pull_type: "soft"` into the outbound HTTP body.
 * All three must independently agree; removing any one is a regression.
 */

export type CreditBureauSupabaseClient = {
  from: (table: string) => any;
  storage?: { from: (bucket: string) => { upload: (path: string, data: Buffer | string, opts?: any) => Promise<{ error: any }> } };
};

export type CreditBureauVendorClient = {
  requestVendorSoftPull: (args: {
    taxIdLast4: string;
    ssnFull?: string;
    dateOfBirth: string;
    firstName: string;
    lastName: string;
    address: { line1: string; city: string; state: string; postalCode: string };
  }) => Promise<{ request_id: string; status: string; bureau?: string | null; report?: Record<string, unknown> | null }>;
  currentVendor: () => string;
};

export type RequestSoftPullArgs = {
  dealId: string;
  bankId: string;
  ownershipEntityId: string;
  taxIdLast4: string;
  ssnFull?: string;
  dateOfBirth: string;
  firstName: string;
  lastName: string;
  address: { line1: string; city: string; state: string; postalCode: string };
  consentVersion: string;
  consentTextHash: string;
  consentIp?: string | null;
  consentUserAgent?: string | null;
  consentAt: string;
};

export type RequestSoftPullResult =
  | { ok: true; pullId: string; status: string; reused: boolean; abnormalityCount: number }
  | { ok: false; reason: "MISSING_CONSENT" | "VENDOR_REQUEST_FAILED" | "DB_INSERT_FAILED"; detail?: string };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildSoftPullIdempotencyKey(dealId: string, ownershipEntityId: string, vendor: string, date = todayUtc()): string {
  return crypto.createHash("sha256").update(`${dealId}:${ownershipEntityId}:${vendor}:${date}`).digest("hex");
}

export async function requestSoftPull(
  args: RequestSoftPullArgs,
  deps: { sb: CreditBureauSupabaseClient; vendor: CreditBureauVendorClient },
): Promise<RequestSoftPullResult> {
  const { sb, vendor } = deps;

  // Consent capture is mandatory — FCRA § 1681b(a)(2) written instruction.
  if (!args.consentVersion || !args.consentTextHash || !args.consentAt) {
    return { ok: false, reason: "MISSING_CONSENT" };
  }

  const vendorName = vendor.currentVendor();
  const idempotencyKey = buildSoftPullIdempotencyKey(args.dealId, args.ownershipEntityId, vendorName);

  const { data: existing } = await sb
    .from("borrower_credit_pulls")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    const { data: existingTradelines } = await sb
      .from("borrower_credit_tradelines")
      .select("id")
      .eq("pull_id", existing.id);
    return { ok: true, pullId: existing.id, status: existing.status, reused: true, abnormalityCount: (existingTradelines ?? []).length };
  }

  let vendorResponse;
  try {
    vendorResponse = await vendor.requestVendorSoftPull({
      taxIdLast4: args.taxIdLast4,
      ssnFull: args.ssnFull,
      dateOfBirth: args.dateOfBirth,
      firstName: args.firstName,
      lastName: args.lastName,
      address: args.address,
    });
  } catch (err: any) {
    return { ok: false, reason: "VENDOR_REQUEST_FAILED", detail: err?.message ?? String(err) };
  }

  const { data: inserted, error: insertError } = await sb
    .from("borrower_credit_pulls")
    .insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      ownership_entity_id: args.ownershipEntityId,
      pull_type: "soft", // hardcoded — layer 2 of the guard, see module docstring
      vendor: vendorName,
      vendor_request_id: vendorResponse.request_id,
      bureau: vendorResponse.bureau ?? null,
      status: "requested",
      consent_version: args.consentVersion,
      consent_text_hash: args.consentTextHash,
      consent_ip: args.consentIp ?? null,
      consent_user_agent: args.consentUserAgent ?? null,
      consent_at: args.consentAt,
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return { ok: false, reason: "DB_INSERT_FAILED", detail: insertError?.message };
  }

  const pullId = inserted.id;

  // Vendor hasn't returned a report yet (async vendor) — leave status
  // 'requested' for a later webhook/poll to complete. Most soft-pull
  // vendors (Plaid Check included) return synchronously, so this is the
  // common path in practice.
  if (!vendorResponse.report) {
    return { ok: true, pullId, status: "requested", reused: false, abnormalityCount: 0 };
  }

  let parsed: ParsedCreditReport;
  try {
    parsed = parseCreditReport({ report: vendorResponse.report }, vendorName);
  } catch (err: any) {
    await sb.from("borrower_credit_pulls").update({ status: "failed", status_reason: `parse_error: ${err?.message ?? String(err)}` }).eq("id", pullId);
    return { ok: false, reason: "VENDOR_REQUEST_FAILED", detail: err?.message ?? String(err) };
  }

  if (sb.storage) {
    await sb.storage.from("credit-reports").upload(
      `credit-reports/${args.dealId}/${pullId}.json`,
      JSON.stringify(vendorResponse.report),
      { contentType: "application/json" },
    );
  }

  if (parsed.tradelines.length > 0) {
    await sb.from("borrower_credit_tradelines").insert(
      parsed.tradelines.map((t) => ({
        pull_id: pullId,
        deal_id: args.dealId,
        bank_id: args.bankId,
        account_type: t.account_type,
        creditor_name: t.creditor_name,
        account_number_masked: t.account_number_masked,
        open_date: t.open_date,
        closed_date: t.closed_date,
        high_credit: t.high_credit,
        current_balance: t.current_balance,
        monthly_payment: t.monthly_payment,
        payment_history_24mo: t.payment_history_24mo,
        is_delinquent: t.is_delinquent,
        is_charged_off: t.is_charged_off,
        is_in_collection: t.is_in_collection,
        raw_json: t.raw_json,
      })),
    );
  }

  const abnormalities = detectAbnormalities(parsed.tradelines, parsed.summary.inquiries_24mo_count);
  if (abnormalities.length > 0) {
    await sb.from("deal_gap_queue").insert(
      abnormalities.map((a) => ({
        deal_id: args.dealId,
        bank_id: args.bankId,
        gap_type: "credit_explanation",
        fact_type: "credit_tradeline",
        fact_key: a.tradeline_index >= 0 ? `credit_pull.${pullId}.tradeline.${a.tradeline_index}` : `credit_pull.${pullId}.inquiries`,
        owner_entity_id: args.ownershipEntityId,
        description: a.suggested_explanation_prompt,
        resolution_prompt: a.suggested_explanation_prompt,
        priority: a.severity === "HIGH" ? 1 : a.severity === "MEDIUM" ? 2 : a.severity === "LOW" ? 3 : 4,
        status: "open",
      })),
    );
  }

  await sb
    .from("borrower_credit_pulls")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      result_summary: parsed.summary,
      fico_score: parsed.summary.fico_score,
      delinquencies_count: parsed.summary.delinquencies_count,
      public_records_count: parsed.summary.public_records_count,
      inquiries_24mo_count: parsed.summary.inquiries_24mo_count,
    })
    .eq("id", pullId);

  await sb.from("deal_events").insert({
    deal_id: args.dealId,
    kind: "credit_pull.completed",
    payload: { pull_id: pullId, ownership_entity_id: args.ownershipEntityId, abnormality_count: abnormalities.length },
  });

  return { ok: true, pullId, status: "completed", reused: false, abnormalityCount: abnormalities.length };
}
