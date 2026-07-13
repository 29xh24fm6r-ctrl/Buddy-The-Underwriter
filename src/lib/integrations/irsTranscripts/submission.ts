import * as crypto from "node:crypto";

/**
 * SPEC S4 D-2 — IRS transcript submission orchestration. Free of
 * "server-only" for testability (same pattern used throughout this arc).
 * Principle #22 — this is deliberately async: the borrower's e-signature on
 * 4506-C (S3/S4 D-1) is immediate; the actual IRS/vendor round-trip is not.
 */

export type IrsTranscriptSupabaseClient = { from: (table: string) => any };

export type IrsTranscriptVendorClient = {
  submitVendorTranscriptRequest: (args: { signed4506cPdfBase64: string; taxYears: number[]; transcriptTypes: string[] }) => Promise<{
    vendor_request_id: string;
    status: string;
  }>;
  currentIrsVendor: () => string;
};

export type SubmitTranscriptRequestArgs = {
  dealId: string;
  bankId: string;
  ownershipEntityId?: string | null;
  borrowerId?: string | null;
  signed4506cId: string;
  taxYears: number[];
  transcriptTypes: string[];
};

export type SubmitTranscriptRequestResult =
  | { ok: true; requestId: string; status: "submitted"; reused: boolean }
  | { ok: false; reason: "MISSING_SUBJECT" | "SIGNED_4506C_NOT_FOUND" | "PDF_DOWNLOAD_FAILED" | "VENDOR_REQUEST_FAILED" | "DB_INSERT_FAILED"; detail?: string };

const FIRST_POLL_DELAY_MS = 4 * 60 * 60 * 1000; // 4h — SPEC S4 D-2 first-48h cadence

export function buildIrsIdempotencyKey(signed4506cId: string, taxYears: number[]): string {
  return crypto.createHash("sha256").update(`irs:${signed4506cId}:${[...taxYears].sort().join(",")}`).digest("hex");
}

export async function submitTranscriptRequest(
  args: SubmitTranscriptRequestArgs,
  deps: { sb: IrsTranscriptSupabaseClient; vendor: IrsTranscriptVendorClient; downloadSigned4506cPdf: (storagePath: string) => Promise<Buffer> },
): Promise<SubmitTranscriptRequestResult> {
  const { sb, vendor, downloadSigned4506cPdf } = deps;

  const subjectId = args.ownershipEntityId ?? args.borrowerId;
  if (!subjectId) {
    return { ok: false, reason: "MISSING_SUBJECT" };
  }

  const idempotencyKey = buildIrsIdempotencyKey(args.signed4506cId, args.taxYears);
  const { data: existing } = await sb.from("borrower_irs_transcript_requests").select("id, status").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing) {
    return { ok: true, requestId: existing.id, status: "submitted", reused: true };
  }

  const { data: signedDoc } = await sb
    .from("signed_documents")
    .select("id, form_code, signed_pdf_storage_path")
    .eq("id", args.signed4506cId)
    .eq("form_code", "FORM_4506C")
    .maybeSingle();

  if (!signedDoc) {
    return { ok: false, reason: "SIGNED_4506C_NOT_FOUND" };
  }

  let pdfBytes: Buffer;
  try {
    pdfBytes = await downloadSigned4506cPdf(signedDoc.signed_pdf_storage_path);
  } catch (err: any) {
    return { ok: false, reason: "PDF_DOWNLOAD_FAILED", detail: err?.message ?? String(err) };
  }

  let vendorResponse;
  try {
    vendorResponse = await vendor.submitVendorTranscriptRequest({
      signed4506cPdfBase64: pdfBytes.toString("base64"),
      taxYears: args.taxYears,
      transcriptTypes: args.transcriptTypes,
    });
  } catch (err: any) {
    return { ok: false, reason: "VENDOR_REQUEST_FAILED", detail: err?.message ?? String(err) };
  }

  const submittedAt = new Date();
  const { data: inserted, error } = await sb
    .from("borrower_irs_transcript_requests")
    .insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      ownership_entity_id: args.ownershipEntityId ?? null,
      borrower_id: args.borrowerId ?? null,
      vendor: vendor.currentIrsVendor(),
      vendor_request_id: vendorResponse.vendor_request_id,
      signed_4506c_id: args.signed4506cId,
      tax_years: args.taxYears,
      transcript_types: args.transcriptTypes,
      status: "submitted",
      submitted_at: submittedAt.toISOString(),
      next_poll_at: new Date(submittedAt.getTime() + FIRST_POLL_DELAY_MS).toISOString(),
      poll_attempt_count: 0,
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { ok: false, reason: "DB_INSERT_FAILED", detail: error?.message };
  }

  await sb.from("deal_events").insert({
    deal_id: args.dealId,
    kind: "irs.transcript_submitted",
    payload: { request_id: inserted.id, subject_id: subjectId, tax_years: args.taxYears },
  });

  return { ok: true, requestId: inserted.id, status: "submitted", reused: false };
}
