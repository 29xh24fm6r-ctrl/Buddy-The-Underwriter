/**
 * e-sign orchestration. **This is where the IAL2 gate lives** (principle
 * #17 — non-negotiable, enforced at both request time and webhook
 * completion time). Kept free of "server-only" so it stays testable — same
 * pattern as kyc/service.ts and compliancePackage.ts.
 *
 * Replaces src/lib/esign/docuseal/service.ts. The gate, the deal_events
 * audit trail, and the staleness math are unchanged from the DocuSeal
 * version — only the vendor client calls and a few field names differ.
 */

import { createHash } from "node:crypto";
import { readIal2AdmissionState, type KycSupabaseClient } from "@/lib/identity/kyc/service";
import { readLegalReviewAdmissionState } from "@/lib/sba/legalReview/service";

export type EsignSupabaseClient = KycSupabaseClient & {
  storage?: {
    from: (bucket: string) => {
      upload: (path: string, data: Buffer, opts?: any) => Promise<{ error: any }>;
      download: (path: string) => Promise<{ data: { arrayBuffer: () => Promise<ArrayBuffer> } | null; error: any }>;
    };
  };
};

export type SignwellClient = {
  createSignwellDocumentFromFile: (args: {
    fileBase64: string;
    fileName: string;
    documentName: string;
    recipients: Array<{ id: string; email: string; name: string }>;
    externalId: string;
    embeddedSigning?: boolean;
    redirectUrl?: string;
    fields?: unknown[][];
  }) => Promise<{
    id: string | number;
    status: string;
    metadata?: { external_id?: string; [key: string]: unknown };
    recipients: Array<{ id: string | number; email?: string | null; signing_url?: string | null; embedded_signing_url?: string | null }>;
  }>;
  deleteSignwellDocument: (documentId: string) => Promise<void>;
  fetchSignwellDocument: (documentId: string) => Promise<{
    id: string | number;
    status: string;
    metadata?: { external_id?: string; [key: string]: unknown };
    recipients: Array<{ id: string | number; email?: string | null; signing_url?: string | null; embedded_signing_url?: string | null }>;
  }>;
  downloadSignwellCompletedPdf: (documentId: string) => Promise<Buffer>;
};

/** Renders the already-filled SBA PDF for a given form/deal/signer — see
 * resolveFilledPdfForSigning.ts for the real implementation. Injected
 * (like `signwell`) so requestSignature stays testable without a real
 * Supabase client, filesystem template, or filled-PDF pipeline. */
export type RenderFilledPdfFn = (args: {
  formCode: string;
  dealId: string;
  bankId: string;
  ownershipEntityId: string;
}) => Promise<{ ok: true; pdfBytes: Buffer } | { ok: false; reason: string; detail?: string }>;

const FORM_STALENESS_DAYS: Record<string, number> = {
  FORM_1919: 90,
  FORM_413: 90,
  FORM_4506C: 120,
};

export function formStalenessDays(formCode: string): number {
  return FORM_STALENESS_DAYS[formCode] ?? 365;
}

const EXTERNAL_ID_PATTERN = /^deal:([^:]+):form:([^:]+):signer:([^:]+)$/;

const SIGNWELL_TERMINAL_EVENT_STATUSES: Record<string, string> = {
  document_expired: "Expired",
  document_canceled: "Canceled",
  document_declined: "Declined",
  document_bounced: "Bounced",
  document_error: "Error",
};

const TERMINAL_SIGNING_REQUEST_STATUSES = new Set([
  "completed",
  "manually completed",
  "signed",
  "expired",
  "canceled",
  "cancelled",
  "declined",
  "bounced",
  "blocked",
  "error",
]);

function normalizeSignwellStatus(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[_-]+/g, " ") : "";
}

export function isTerminalSigningRequestStatus(value: unknown): boolean {
  return TERMINAL_SIGNING_REQUEST_STATUSES.has(normalizeSignwellStatus(value));
}

export function isCompletedSigningRequestStatus(value: unknown): boolean {
  return ["completed", "manually completed"].includes(normalizeSignwellStatus(value));
}

export function isFailedTerminalSigningRequestStatus(value: unknown): boolean {
  return ["expired", "canceled", "cancelled", "declined", "bounced", "blocked", "error"].includes(
    normalizeSignwellStatus(value),
  );
}

export type RequestSignatureArgs = {
  dealId: string;
  bankId: string;
  formCode: string;
  templateVersion: string;
  signerOwnershipEntityId: string;
  signerRole: "applicant" | "guarantor" | "spouse" | "agent" | "witness";
  signerEmail: string;
  signerName: string;
};

export type RequestSignatureResult =
  | { ok: true; documentId: string; embedUrl: string; reused?: true }
  | {
      ok: false;
      reason:
        | "IAL2_NOT_COMPLETED"
        | "LEGAL_REVIEW_NOT_COMPLETED"
        | "SIGNING_STATE_UNAVAILABLE"
        | "SUBMISSION_FAILED";
      detail?: string;
    };

type SigningRequestRow = {
  id: string;
  signwell_document_id: string;
  status: string;
  signing_url?: string | null;
  idempotency_key?: string | null;
  recipient_email?: string | null;
  metadata?: Record<string, unknown> | null;
};

function signingRequestIdempotencyKey(args: RequestSignatureArgs): string {
  const canonical = [
    args.dealId,
    args.formCode,
    args.signerOwnershipEntityId,
    args.templateVersion,
    normalizeEmail(args.signerEmail),
  ].join("\u001f");
  return `signwell-request:${createHash("sha256").update(canonical).digest("hex")}`;
}

function reservationDocumentId(idempotencyKey: string): string {
  return `reservation:${idempotencyKey.slice("signwell-request:".length)}`;
}

function evaluateExistingSigningRequest(
  row: SigningRequestRow | null,
  args: RequestSignatureArgs,
  idempotencyKey: string,
): RequestSignatureResult | null {
  if (!row) return null;

  const metadataVersion =
    row.metadata && typeof row.metadata.template_version === "string"
      ? row.metadata.template_version
      : null;
  const matches =
    row.idempotency_key === idempotencyKey ||
    (row.idempotency_key == null &&
      metadataVersion === args.templateVersion &&
      normalizeEmail(row.recipient_email) === normalizeEmail(args.signerEmail));
  if (!matches) return null;

  if (isCompletedSigningRequestStatus(row.status)) {
    return {
      ok: false,
      reason: "SIGNING_STATE_UNAVAILABLE",
      detail: "signing_request_already_completed",
    };
  }
  if (isFailedTerminalSigningRequestStatus(row.status)) return null;

  const documentId = String(row.signwell_document_id ?? "");
  const embedUrl = typeof row.signing_url === "string" ? row.signing_url.trim() : "";
  if (
    documentId &&
    !documentId.startsWith("reservation:") &&
    embedUrl &&
    normalizeSignwellStatus(row.status) !== "creating"
  ) {
    return { ok: true, documentId, embedUrl, reused: true };
  }

  return {
    ok: false,
    reason: "SIGNING_STATE_UNAVAILABLE",
    detail: "signing_request_in_progress",
  };
}

async function readExistingSigningRequest(
  args: RequestSignatureArgs,
  sb: EsignSupabaseClient,
  idempotencyKey: string,
): Promise<{ ok: true; result: RequestSignatureResult | null } | { ok: false; detail: string }> {
  try {
    const keyed = await sb
      .from("signing_requests")
      .select("id, signwell_document_id, status, signing_url, idempotency_key, recipient_email, metadata")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (keyed.error) {
      return { ok: false, detail: `idempotency_lookup_failed:${keyed.error.message}` };
    }
    const keyedResult = evaluateExistingSigningRequest(keyed.data as SigningRequestRow | null, args, idempotencyKey);
    if (keyedResult) return { ok: true, result: keyedResult };

    // Rows created before the idempotency migration have a null key. Reuse
    // the exact active request rather than creating a second provider
    // document during the migration boundary.
    const legacy = await sb
      .from("signing_requests")
      .select("id, signwell_document_id, status, signing_url, idempotency_key, recipient_email, metadata")
      .eq("deal_id", args.dealId)
      .eq("form_code", args.formCode)
      .eq("signer_ownership_entity_id", args.signerOwnershipEntityId)
      .eq("recipient_email", args.signerEmail)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (legacy.error) {
      return { ok: false, detail: `legacy_request_lookup_failed:${legacy.error.message}` };
    }
    return {
      ok: true,
      result: evaluateExistingSigningRequest(legacy.data as SigningRequestRow | null, args, idempotencyKey),
    };
  } catch (err) {
    return {
      ok: false,
      detail: `signing_request_lookup_failed:${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function markSigningReservationFailed(
  sb: EsignSupabaseClient,
  reservationId: string,
  idempotencyKey: string,
  releaseLock: boolean,
): Promise<boolean> {
  try {
    const { data, error } = await sb
      .from("signing_requests")
      .update({
        status: "Error",
        ...(releaseLock ? { idempotency_key: null } : {}),
      })
      .eq("id", reservationId)
      .eq("idempotency_key", idempotencyKey)
      .select("id, status, idempotency_key")
      .maybeSingle();
    return !error &&
      data?.id === reservationId &&
      normalizeSignwellStatus(data?.status) === "error" &&
      (releaseLock ? data?.idempotency_key == null : data?.idempotency_key === idempotencyKey);
  } catch {
    return false;
  }
}

async function failReservedRequest(
  sb: EsignSupabaseClient,
  reservationId: string,
  idempotencyKey: string,
  detail: string,
): Promise<RequestSignatureResult> {
  const released = await markSigningReservationFailed(sb, reservationId, idempotencyKey, true);
  return {
    ok: false,
    reason: "SUBMISSION_FAILED",
    detail: released ? detail : `${detail}:reservation_release_failed`,
  };
}

async function cancelAndFailReservedRequest(
  deps: { sb: EsignSupabaseClient; signwell: SignwellClient },
  reservationId: string,
  idempotencyKey: string,
  documentId: string,
  detail: string,
): Promise<RequestSignatureResult> {
  try {
    await deps.signwell.deleteSignwellDocument(documentId);
  } catch (err) {
    console.error("[requestSignature] failed to cancel untracked SignWell document", {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    const held = await markSigningReservationFailed(deps.sb, reservationId, idempotencyKey, false);
    return {
      ok: false,
      reason: "SUBMISSION_FAILED",
      detail: `${detail}:provider_cleanup_failed${held ? "" : ":reservation_hold_failed"}`,
    };
  }
  return failReservedRequest(deps.sb, reservationId, idempotencyKey, detail);
}

export async function requestSignature(
  args: RequestSignatureArgs,
  deps: { sb: EsignSupabaseClient; signwell: SignwellClient; renderFilledPdf: RenderFilledPdfFn },
): Promise<RequestSignatureResult> {
  const { sb, signwell, renderFilledPdf } = deps;

  // IAL2 GATE — no exceptions (principle #17).
  const ial2State = await readIal2AdmissionState(args.dealId, args.signerOwnershipEntityId, sb);
  if (!ial2State.ok) {
    return {
      ok: false,
      reason: "SIGNING_STATE_UNAVAILABLE",
      detail: `ial2_gate_read_failed:${ial2State.detail}`,
    };
  }
  if (!ial2State.valid) {
    return { ok: false, reason: "IAL2_NOT_COMPLETED" };
  }

  const legalReviewState = await readLegalReviewAdmissionState(args.dealId, args.formCode, sb);
  if (!legalReviewState.ok) {
    return {
      ok: false,
      reason: "SIGNING_STATE_UNAVAILABLE",
      detail: `legal_review_gate_read_failed:${legalReviewState.detail}`,
    };
  }
  if (!legalReviewState.complete) {
    return { ok: false, reason: "LEGAL_REVIEW_NOT_COMPLETED" };
  }

  // Resolve trusted identity provenance before reserving or handing bytes
  // to the provider. No external side effect is allowed on an unavailable
  // identity read.
  const { data: verification, error: verificationError } = await sb
    .from("borrower_identity_verifications")
    .select("id")
    .eq("deal_id", args.dealId)
    .eq("ownership_entity_id", args.signerOwnershipEntityId)
    .in("status", ["completed", "approved"])
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (verificationError || !verification) {
    return {
      ok: false,
      reason: "SIGNING_STATE_UNAVAILABLE",
      detail: `identity_provenance_lookup_failed:${verificationError?.message ?? "verification_not_found"}`,
    };
  }

  const idempotencyKey = signingRequestIdempotencyKey(args);
  const existing = await readExistingSigningRequest(args, sb, idempotencyKey);
  if (!existing.ok) {
    return { ok: false, reason: "SIGNING_STATE_UNAVAILABLE", detail: existing.detail };
  }
  if (existing.result) return existing.result;

  const placeholderDocumentId = reservationDocumentId(idempotencyKey);
  let reservation: SigningRequestRow | null = null;
  try {
    const { data, error } = await sb
      .from("signing_requests")
      .insert({
        deal_id: args.dealId,
        bank_id: args.bankId,
        form_code: args.formCode,
        signer_ownership_entity_id: args.signerOwnershipEntityId,
        signer_role: args.signerRole,
        recipient_email: args.signerEmail,
        recipient_name: args.signerName,
        signwell_document_id: placeholderDocumentId,
        idempotency_key: idempotencyKey,
        status: "Creating",
        embedded_signing: true,
        signing_url: null,
        metadata: {
          template_version: args.templateVersion,
          identity_verification_id: verification.id,
        },
      })
      .select("id, signwell_document_id, status, signing_url, idempotency_key, recipient_email, metadata")
      .maybeSingle();
    if (!error && data) reservation = data as SigningRequestRow;
  } catch {
    reservation = null;
  }

  if (
    !reservation ||
    reservation.idempotency_key !== idempotencyKey ||
    reservation.signwell_document_id !== placeholderDocumentId ||
    normalizeSignwellStatus(reservation.status) !== "creating"
  ) {
    const raced = await readExistingSigningRequest(args, sb, idempotencyKey);
    if (raced.ok && raced.result) return raced.result;
    return {
      ok: false,
      reason: "SIGNING_STATE_UNAVAILABLE",
      detail: raced.ok ? "signing_request_reservation_failed" : raced.detail,
    };
  }

  const filled = await renderFilledPdf({
    formCode: args.formCode,
    dealId: args.dealId,
    bankId: args.bankId,
    ownershipEntityId: args.signerOwnershipEntityId,
  });
  if (!filled.ok) {
    return failReservedRequest(
      sb,
      reservation.id,
      idempotencyKey,
      `pdf_render_failed:${filled.reason}${filled.detail ? `:${filled.detail}` : ""}`,
    );
  }

  const externalId = `deal:${args.dealId}:form:${args.formCode}:signer:${args.signerOwnershipEntityId}`;
  let document;
  try {
    document = await signwell.createSignwellDocumentFromFile({
      fileBase64: filled.pdfBytes.toString("base64"),
      fileName: `${args.formCode}.pdf`,
      documentName: `${args.formCode} — ${args.signerName}`,
      recipients: [{ id: "1", email: args.signerEmail, name: args.signerName }],
      externalId,
      embeddedSigning: true,
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/signing/complete`,
    });
  } catch (err: any) {
    return failReservedRequest(
      sb,
      reservation.id,
      idempotencyKey,
      `provider_submission_failed:${err?.message ?? String(err)}`,
    );
  }

  const recipient = document.recipients.find((candidate) => String(candidate.id) === "1");
  const embedUrl = recipient?.embedded_signing_url ?? recipient?.signing_url;
  if (!embedUrl) {
    return cancelAndFailReservedRequest(
      { sb, signwell },
      reservation.id,
      idempotencyKey,
      String(document.id),
      "signwell_response_missing_signing_url",
    );
  }

  let trackedRequest: SigningRequestRow | null = null;
  let trackingDetail = "row_not_returned";
  try {
    const { data, error } = await sb
      .from("signing_requests")
      .update({
        signwell_document_id: String(document.id),
        status: document.status,
        signing_url: embedUrl,
      })
      .eq("id", reservation.id)
      .eq("idempotency_key", idempotencyKey)
      .eq("signwell_document_id", placeholderDocumentId)
      .eq("status", "Creating")
      .select("id, signwell_document_id, status, signing_url, idempotency_key")
      .maybeSingle();
    trackingDetail = error?.message ?? "row_not_returned";
    if (!error && data) trackedRequest = data as SigningRequestRow;
  } catch (err) {
    trackingDetail = err instanceof Error ? err.message : String(err);
  }

  if (
    !trackedRequest ||
    trackedRequest.id !== reservation.id ||
    trackedRequest.idempotency_key !== idempotencyKey ||
    trackedRequest.signwell_document_id !== String(document.id) ||
    trackedRequest.signing_url !== embedUrl ||
    normalizeSignwellStatus(trackedRequest.status) !== normalizeSignwellStatus(document.status)
  ) {
    return cancelAndFailReservedRequest(
      { sb, signwell },
      reservation.id,
      idempotencyKey,
      String(document.id),
      `signing_request_tracking_failed:${trackingDetail}`,
    );
  }

  await sb.from("deal_events").insert({
    deal_id: args.dealId,
    kind: "esign.requested",
    payload: {
      form_code: args.formCode,
      signer_ownership_entity_id: args.signerOwnershipEntityId,
      identity_verification_id: verification.id,
      document_id: String(document.id),
      idempotency_key: idempotencyKey,
    },
  });

  return { ok: true, documentId: String(document.id), embedUrl };
}

export type HandleSignwellWebhookResult =
  | { ok: true; ignored: true }
  | { ok: true; signedDocumentId: string; reused?: true }
  | { ok: true; terminalStatus: string }
  | {
      ok: false;
      reason:
        | "MALFORMED_EXTERNAL_ID"
        | "MISSING_DOCUMENT_ID"
        | "SIGNING_REQUEST_NOT_FOUND"
        | "SIGNING_REQUEST_MISMATCH"
        | "SIGNING_REQUEST_STATUS_UPDATE_FAILED"
        | "SIGNING_STATE_READ_FAILED"
        | "PROVIDER_DOCUMENT_MISMATCH"
        | "SIGNER_MISMATCH"
        | "IAL2_GATE_FAILED_AT_COMPLETION"
        | "PDF_UPLOAD_FAILED"
        | "DEAL_NOT_FOUND";
      detail?: string;
    };

function parseSignwellEventTime(value: string | number | undefined): Date {
  if (typeof value === "number") {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const parsed = new Date(milliseconds);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
      const parsed = new Date(milliseconds);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isStorageObjectAlreadyPresent(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; statusCode?: unknown; message?: unknown; error?: unknown };
  const status = String(candidate.statusCode ?? candidate.status ?? "");
  const description = `${String(candidate.error ?? "")} ${String(candidate.message ?? "")}`.toLowerCase();
  return status === "409" || description.includes("already exists") || description.includes("duplicate");
}

export async function persistImmutableSignedPdf(
  sb: EsignSupabaseClient,
  path: string,
  pdfBytes: Buffer,
): Promise<{ ok: true; sha256: string; size: number; reused: boolean } | { ok: false; detail: string }> {
  if (!sb.storage) {
    return { ok: false, detail: "no_storage_capable_client" };
  }

  const storage = sb.storage.from("signed-documents");
  let reused = false;
  try {
    const { error: uploadError } = await storage.upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (uploadError) {
      if (!isStorageObjectAlreadyPresent(uploadError)) {
        return { ok: false, detail: `signed_pdf_create_failed:${uploadError.message ?? String(uploadError)}` };
      }
      reused = true;
    }
  } catch (err) {
    return {
      ok: false,
      detail: `signed_pdf_create_failed:${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let storedBytes: Buffer;
  try {
    const { data, error: downloadError } = await storage.download(path);
    if (downloadError || !data) {
      return {
        ok: false,
        detail: `signed_pdf_verification_download_failed:${downloadError?.message ?? "object_not_returned"}`,
      };
    }
    storedBytes = Buffer.from(await data.arrayBuffer());
  } catch (err) {
    return {
      ok: false,
      detail: `signed_pdf_verification_download_failed:${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const expectedSha256 = sha256Hex(pdfBytes);
  const storedSha256 = sha256Hex(storedBytes);
  if (storedBytes.byteLength !== pdfBytes.byteLength || storedSha256 !== expectedSha256) {
    return {
      ok: false,
      detail: `signed_pdf_integrity_mismatch:expected_size=${pdfBytes.byteLength}:stored_size=${storedBytes.byteLength}:expected_sha256=${expectedSha256}:stored_sha256=${storedSha256}`,
    };
  }

  return {
    ok: true,
    sha256: expectedSha256,
    size: pdfBytes.byteLength,
    reused,
  };
}

export async function persistSignwellRequestStatus(
  args: { dealId: string; documentId: string; status: string; rawEvent?: unknown },
  sb: EsignSupabaseClient,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const update: Record<string, unknown> = { status: args.status };
  if (isFailedTerminalSigningRequestStatus(args.status)) update.idempotency_key = null;
  if (args.rawEvent !== undefined) update.raw_last_event = args.rawEvent;

  try {
    const { data, error } = await sb
      .from("signing_requests")
      .update(update)
      .eq("deal_id", args.dealId)
      .eq("signwell_document_id", args.documentId)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      return { ok: false, detail: error?.message ?? "signing_request_not_found" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

type CanonicalSignwellDocument = Awaited<ReturnType<SignwellClient["fetchSignwellDocument"]>>;

export type ReconcileSignwellCompletionResult =
  | { ok: true; completed: false }
  | { ok: true; completed: true; signedDocument: Record<string, unknown> }
  | { ok: false; detail: string };

/**
 * Recovers a completed SignWell ceremony when the webhook was missed or
 * delayed. Provider completion is only a trigger: the caller may report
 * "completed" after this function confirms Buddy's durable signed_documents
 * row, which itself is written only after the compliance PDF is stored.
 */
export async function reconcileSignwellCompletion(
  args: { dealId: string; document: CanonicalSignwellDocument },
  deps: { sb: EsignSupabaseClient; signwell: SignwellClient },
): Promise<ReconcileSignwellCompletionResult> {
  if (!isCompletedSigningRequestStatus(args.document.status)) {
    return { ok: true, completed: false };
  }

  const documentId = String(args.document.id);
  const applied = await handleSignwellWebhook(
    {
      event: { type: "document_completed" },
      data: {
        object: {
          id: documentId,
          metadata: args.document.metadata,
          recipients: args.document.recipients.map((recipient) => ({ id: recipient.id })),
        },
      },
    },
    deps,
  );
  if (!applied.ok) {
    return {
      ok: false,
      detail: `${applied.reason}${applied.detail ? `:${applied.detail}` : ""}`,
    };
  }

  const { data: signedDocument, error } = await deps.sb
    .from("signed_documents")
    .select("*")
    .eq("deal_id", args.dealId)
    .eq("esign_document_id", documentId)
    .maybeSingle();
  if (error || !signedDocument) {
    return {
      ok: false,
      detail: error?.message ?? "signed_document_not_durable_after_reconciliation",
    };
  }

  return {
    ok: true,
    completed: true,
    signedDocument: signedDocument as Record<string, unknown>,
  };
}

export async function handleSignwellWebhook(
  payload: {
    event: { type: string; time?: string | number };
    data: { object: { id?: string | number; metadata?: { external_id?: string }; recipients?: Array<{ id: string | number }> } };
  },
  deps: { sb: EsignSupabaseClient; signwell: SignwellClient },
): Promise<HandleSignwellWebhookResult> {
  const { sb, signwell } = deps;
  const terminalStatus = SIGNWELL_TERMINAL_EVENT_STATUSES[payload.event.type];

  if (payload.event.type !== "document_completed" && !terminalStatus) {
    return { ok: true, ignored: true };
  }

  const externalId = payload.data.object.metadata?.external_id ?? "";
  const match = EXTERNAL_ID_PATTERN.exec(externalId);
  if (!match) {
    return { ok: false, reason: "MALFORMED_EXTERNAL_ID" };
  }
  const [, dealId, formCode, signerOwnershipEntityId] = match;
  const documentId = String(payload.data.object.id ?? "");
  if (!documentId) {
    return { ok: false, reason: "MISSING_DOCUMENT_ID" };
  }

  if (terminalStatus) {
    const { data: terminalRequest, error: terminalRequestError } = await sb
      .from("signing_requests")
      .select("deal_id, form_code, signer_ownership_entity_id")
      .eq("signwell_document_id", documentId)
      .maybeSingle();
    if (terminalRequestError) {
      return { ok: false, reason: "SIGNING_STATE_READ_FAILED", detail: `signing_request_lookup_failed:${terminalRequestError.message}` };
    }
    if (!terminalRequest) {
      return { ok: false, reason: "SIGNING_REQUEST_NOT_FOUND" };
    }
    if (
      String(terminalRequest.deal_id) !== dealId ||
      String(terminalRequest.form_code) !== formCode ||
      String(terminalRequest.signer_ownership_entity_id) !== signerOwnershipEntityId
    ) {
      return { ok: false, reason: "SIGNING_REQUEST_MISMATCH" };
    }

    // The event hash authenticates event.type and event.time, but not the
    // object payload. Bind terminal state to SignWell's canonical document
    // before allowing the webhook to retire an active signing request.
    const document = await signwell.fetchSignwellDocument(documentId);
    if (String(document.id) !== documentId) {
      return { ok: false, reason: "PROVIDER_DOCUMENT_MISMATCH", detail: "document_id_mismatch" };
    }
    const expectedExternalId =
      `deal:${terminalRequest.deal_id}:form:${terminalRequest.form_code}:signer:${terminalRequest.signer_ownership_entity_id}`;
    if (document.metadata?.external_id !== expectedExternalId || externalId !== expectedExternalId) {
      return { ok: false, reason: "PROVIDER_DOCUMENT_MISMATCH", detail: "external_id_mismatch" };
    }
    const canonicalStatus = normalizeSignwellStatus(document.status);
    if (canonicalStatus !== normalizeSignwellStatus(terminalStatus)) {
      return {
        ok: false,
        reason: "PROVIDER_DOCUMENT_MISMATCH",
        detail: `status_not_${normalizeSignwellStatus(terminalStatus)}:${canonicalStatus || "missing"}`,
      };
    }

    const persisted = await persistSignwellRequestStatus(
      { dealId, documentId, status: terminalStatus, rawEvent: payload },
      sb,
    );
    if (!persisted.ok) {
      return { ok: false, reason: "SIGNING_REQUEST_STATUS_UPDATE_FAILED", detail: persisted.detail };
    }

    // raw_last_event on signing_requests is the durable audit record. This
    // secondary timeline event is best effort so an event-table outage
    // cannot keep a terminal request active forever.
    try {
      const { error: eventError } = await sb.from("deal_events").insert({
        deal_id: dealId,
        kind: `esign.${normalizeSignwellStatus(terminalStatus).replace(/ /g, "_")}`,
        payload: { form_code: formCode, signer_ownership_entity_id: signerOwnershipEntityId, document_id: documentId },
      });
      if (eventError) {
        console.error("[handleSignwellWebhook] terminal deal event insert failed (non-fatal):", eventError.message);
      }
    } catch (err) {
      console.error("[handleSignwellWebhook] terminal deal event insert threw (non-fatal):", err);
    }

    return { ok: true, terminalStatus };
  }

  // SignWell redelivers webhooks. Treat an already-persisted provider
  // document as success before any download, storage, or event side effect.
  const { data: existingSignedDocument, error: existingSignedDocumentError } = await sb
    .from("signed_documents")
    .select("id")
    .eq("esign_document_id", documentId)
    .limit(1)
    .maybeSingle();
  if (existingSignedDocumentError) {
    return { ok: false, reason: "SIGNING_STATE_READ_FAILED", detail: `signed_document_lookup_failed:${existingSignedDocumentError.message}` };
  }
  if (existingSignedDocument?.id) {
    return { ok: true, signedDocumentId: String(existingSignedDocument.id), reused: true };
  }

  const { data: signingRequest, error: signingRequestError } = await sb
    .from("signing_requests")
    .select("deal_id, bank_id, form_code, signer_ownership_entity_id, signer_role, recipient_email, metadata, created_at")
    .eq("signwell_document_id", documentId)
    .maybeSingle();
  if (signingRequestError) {
    return { ok: false, reason: "SIGNING_STATE_READ_FAILED", detail: `signing_request_lookup_failed:${signingRequestError.message}` };
  }
  if (!signingRequest) {
    return { ok: false, reason: "SIGNING_REQUEST_NOT_FOUND" };
  }
  if (
    String(signingRequest.deal_id) !== dealId ||
    String(signingRequest.form_code) !== formCode ||
    String(signingRequest.signer_ownership_entity_id) !== signerOwnershipEntityId
  ) {
    return { ok: false, reason: "SIGNING_REQUEST_MISMATCH" };
  }

  // Defense in depth — re-confirm IAL2 still holds at completion time.
  const ial2State = await readIal2AdmissionState(dealId, signerOwnershipEntityId, sb);
  if (!ial2State.ok) {
    return {
      ok: false,
      reason: "SIGNING_STATE_READ_FAILED",
      detail: `ial2_gate_read_failed:${ial2State.detail}`,
    };
  }
  if (!ial2State.valid) {
    await sb.from("deal_events").insert({
      deal_id: dealId,
      kind: "esign.completed_without_ial2_anomaly",
      payload: { form_code: formCode, signer_ownership_entity_id: signerOwnershipEntityId, raw_payload: payload },
    });
    return { ok: false, reason: "IAL2_GATE_FAILED_AT_COMPLETION" };
  }

  // SignWell's documented event hash covers event.type and event.time, not
  // data.object. Treat the webhook object only as a lookup hint, then bind
  // completion to the provider's canonical document before downloading or
  // persisting signed bytes.
  const document = await signwell.fetchSignwellDocument(documentId);
  if (String(document.id) !== documentId) {
    return { ok: false, reason: "PROVIDER_DOCUMENT_MISMATCH", detail: "document_id_mismatch" };
  }
  const canonicalStatus = normalizeSignwellStatus(document.status);
  if (canonicalStatus !== "completed" && canonicalStatus !== "manually completed") {
    return { ok: false, reason: "PROVIDER_DOCUMENT_MISMATCH", detail: `status_not_completed:${canonicalStatus || "missing"}` };
  }
  if (document.metadata?.external_id !== externalId) {
    return { ok: false, reason: "PROVIDER_DOCUMENT_MISMATCH", detail: "external_id_mismatch" };
  }

  const signer = document.recipients.find((recipient) => String(recipient.id) === "1") ?? document.recipients[0];
  const requestedEmail = normalizeEmail(signingRequest.recipient_email);
  const completedEmail = normalizeEmail(signer?.email);
  if (!requestedEmail || !completedEmail || requestedEmail !== completedEmail) {
    return {
      ok: false,
      reason: "SIGNER_MISMATCH",
      detail: !requestedEmail ? "request_email_missing" : !completedEmail ? "provider_email_missing" : "recipient_email_mismatch",
    };
  }

  const { data: deal, error: dealError } = await sb.from("deals").select("bank_id").eq("id", dealId).maybeSingle();
  if (dealError) {
    return { ok: false, reason: "SIGNING_STATE_READ_FAILED", detail: `deal_lookup_failed:${dealError.message}` };
  }
  if (!deal) {
    return { ok: false, reason: "DEAL_NOT_FOUND" };
  }
  if (String(signingRequest.bank_id) !== String(deal.bank_id)) {
    return { ok: false, reason: "SIGNING_REQUEST_MISMATCH", detail: "bank_id_mismatch" };
  }

  const { data: verification, error: verificationError } = await sb
    .from("borrower_identity_verifications")
    .select("id")
    .eq("deal_id", dealId)
    .eq("ownership_entity_id", signerOwnershipEntityId)
    .in("status", ["completed", "approved"])
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (verificationError || !verification) {
    return {
      ok: false,
      reason: "SIGNING_STATE_READ_FAILED",
      detail: `identity_provenance_lookup_failed:${verificationError?.message ?? "verification_not_found"}`,
    };
  }

  let pdfBytes: Buffer;
  try {
    pdfBytes = await signwell.downloadSignwellCompletedPdf(documentId);
  } catch (err: any) {
    return { ok: false, reason: "PDF_UPLOAD_FAILED", detail: err?.message ?? String(err) };
  }

  // SignWell's Audit & Lock trail is appended inside this same PDF — no
  // separate audit-trail file to fetch (see client.ts).
  const pdfPath = `signed-documents/${dealId}/${formCode}/${signerOwnershipEntityId}/${documentId}.pdf`;

  // A completed signature is a compliance artifact, not mutable application
  // state. Create the canonical object once, then prove the stored bytes are
  // exactly the provider bytes before creating the signed_documents record.
  // Retries may reuse an existing object only after the same proof succeeds.
  const persistedPdf = await persistImmutableSignedPdf(sb, pdfPath, pdfBytes);
  if (!persistedPdf.ok) {
    return { ok: false, reason: "PDF_UPLOAD_FAILED", detail: persistedPdf.detail };
  }

  const completedAt = parseSignwellEventTime(payload.event.time);
  const stalenessDays = formStalenessDays(formCode);
  const expiresAt = new Date(completedAt.getTime() + stalenessDays * 86_400_000);
  const requestMetadata =
    signingRequest.metadata && typeof signingRequest.metadata === "object" ? signingRequest.metadata : {};
  const templateVersion =
    typeof requestMetadata.template_version === "string" && requestMetadata.template_version.trim()
      ? requestMetadata.template_version
      : "legacy-unrecorded";

  const { data: signedDoc, error } = await sb
    .from("signed_documents")
    .insert({
      deal_id: dealId,
      bank_id: deal.bank_id,
      esign_provider: "signwell",
      form_code: formCode,
      template_version: templateVersion,
      signer_ownership_entity_id: signerOwnershipEntityId,
      signer_role: signingRequest.signer_role,
      identity_verification_id: verification?.id ?? null,
      esign_document_id: documentId,
      esign_signer_id: String(signer?.id ?? ""),
      signed_pdf_storage_path: pdfPath,
      audit_trail_storage_path: null,
      signature_request_sent_at: signingRequest.created_at ?? completedAt.toISOString(),
      signature_completed_at: completedAt.toISOString(),
      staleness_window_days: stalenessDays,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (error || !signedDoc) {
    // A concurrent delivery may have won the unique provider-document race.
    const { data: racedSignedDocument, error: racedSignedDocumentError } = await sb
      .from("signed_documents")
      .select("id")
      .eq("esign_document_id", documentId)
      .limit(1)
      .maybeSingle();
    if (racedSignedDocumentError) {
      return {
        ok: false,
        reason: "PDF_UPLOAD_FAILED",
        detail: `${error?.message ?? "insert_failed"}:race_lookup_failed:${racedSignedDocumentError.message}`,
      };
    }
    if (racedSignedDocument?.id) {
      return { ok: true, signedDocumentId: String(racedSignedDocument.id), reused: true };
    }
    return { ok: false, reason: "PDF_UPLOAD_FAILED", detail: error?.message ?? "insert_failed" };
  }

  await sb.from("deal_events").insert({
    deal_id: dealId,
    kind: "esign.completed",
    payload: { form_code: formCode, signer_ownership_entity_id: signerOwnershipEntityId, signed_document_id: signedDoc.id },
  });

  // signed_documents is the durable compliance record. The in-flight row is
  // a view aid, so a failure here does not invalidate the completed record.
  try {
    const { error: signingRequestError } = await sb
      .from("signing_requests")
      .update({ status: "Completed", completed_at: completedAt.toISOString() })
      .eq("signwell_document_id", documentId);
    if (signingRequestError) {
      console.error("[handleSignwellWebhook] signing_requests update failed (non-fatal):", signingRequestError.message);
    }
  } catch (err) {
    console.error("[handleSignwellWebhook] signing_requests update threw (non-fatal):", err);
  }

  return { ok: true, signedDocumentId: String(signedDoc.id) };
}
