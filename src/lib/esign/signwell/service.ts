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

import { hasValidIal2, type KycSupabaseClient } from "@/lib/identity/kyc/service";

export type EsignSupabaseClient = KycSupabaseClient & {
  storage?: { from: (bucket: string) => { upload: (path: string, data: Buffer, opts?: any) => Promise<{ error: any }> } };
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
    recipients: Array<{ id: string | number; signing_url?: string | null; embedded_signing_url?: string | null }>;
  }>;
  fetchSignwellDocument: (documentId: string) => Promise<{
    id: string | number;
    status: string;
    recipients: Array<{ id: string | number; signing_url?: string | null; embedded_signing_url?: string | null }>;
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
  | { ok: true; documentId: string; embedUrl: string }
  | { ok: false; reason: "IAL2_NOT_COMPLETED" | "SUBMISSION_FAILED"; detail?: string };

export async function requestSignature(
  args: RequestSignatureArgs,
  deps: { sb: EsignSupabaseClient; signwell: SignwellClient; renderFilledPdf: RenderFilledPdfFn },
): Promise<RequestSignatureResult> {
  const { sb, signwell, renderFilledPdf } = deps;

  // IAL2 GATE — no exceptions (principle #17).
  const ial2Valid = await hasValidIal2(args.dealId, args.signerOwnershipEntityId, sb);
  if (!ial2Valid) {
    return { ok: false, reason: "IAL2_NOT_COMPLETED" };
  }

  // SignWell must never fill loan data itself — it only ever receives an
  // already-complete PDF and adds a signature. The filled PDF comes from
  // the same tested build/render pipeline the forms UI uses, not a
  // SignWell-hosted template.
  const filled = await renderFilledPdf({
    formCode: args.formCode,
    dealId: args.dealId,
    bankId: args.bankId,
    ownershipEntityId: args.signerOwnershipEntityId,
  });
  if (!filled.ok) {
    return { ok: false, reason: "SUBMISSION_FAILED", detail: `pdf_render_failed:${filled.reason}${filled.detail ? `:${filled.detail}` : ""}` };
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
    return { ok: false, reason: "SUBMISSION_FAILED", detail: err?.message ?? String(err) };
  }

  const { data: verification } = await sb
    .from("borrower_identity_verifications")
    .select("id")
    .eq("deal_id", args.dealId)
    .eq("ownership_entity_id", args.signerOwnershipEntityId)
    .in("status", ["completed", "approved"])
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  await sb.from("deal_events").insert({
    deal_id: args.dealId,
    kind: "esign.requested",
    payload: {
      form_code: args.formCode,
      signer_ownership_entity_id: args.signerOwnershipEntityId,
      identity_verification_id: verification?.id ?? null,
      document_id: String(document.id),
    },
  });

  const recipient = document.recipients.find((r) => String(r.id) === "1");
  const embedUrl = recipient?.embedded_signing_url ?? recipient?.signing_url;
  if (!embedUrl) {
    return { ok: false, reason: "SUBMISSION_FAILED", detail: "signwell_response_missing_signing_url" };
  }

  // Best-effort in-flight tracking row (signing_requests) — a failure here
  // doesn't invalidate the signature request SignWell already accepted, so
  // it's non-fatal, same discipline as the Didit decision-detail fetch in
  // kyc/service.ts. Supabase-js resolves rather than throws on a DB error,
  // so check `.error` explicitly instead of relying on try/catch.
  try {
    const { error: signingRequestError } = await sb.from("signing_requests").insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      form_code: args.formCode,
      signer_ownership_entity_id: args.signerOwnershipEntityId,
      signer_role: args.signerRole,
      recipient_email: args.signerEmail,
      recipient_name: args.signerName,
      signwell_document_id: String(document.id),
      status: document.status,
      embedded_signing: true,
      signing_url: embedUrl,
    });
    if (signingRequestError) {
      console.error("[requestSignature] signing_requests insert failed (non-fatal):", signingRequestError.message);
    }
  } catch (err) {
    console.error("[requestSignature] signing_requests insert threw (non-fatal):", err);
  }

  return { ok: true, documentId: String(document.id), embedUrl };
}

export type HandleSignwellWebhookResult =
  | { ok: true; ignored: true }
  | { ok: true; signedDocumentId: string }
  | { ok: false; reason: "MALFORMED_EXTERNAL_ID" | "IAL2_GATE_FAILED_AT_COMPLETION" | "PDF_UPLOAD_FAILED" | "DEAL_NOT_FOUND"; detail?: string };

export async function handleSignwellWebhook(
  payload: {
    event: { type: string };
    data: { object: { id?: string | number; metadata?: { external_id?: string }; recipients?: Array<{ id: string | number }> } };
  },
  deps: { sb: EsignSupabaseClient; signwell: SignwellClient },
): Promise<HandleSignwellWebhookResult> {
  const { sb, signwell } = deps;

  if (payload.event.type !== "document_completed") {
    return { ok: true, ignored: true };
  }

  const externalId = payload.data.object.metadata?.external_id ?? "";
  const match = EXTERNAL_ID_PATTERN.exec(externalId);
  if (!match) {
    return { ok: false, reason: "MALFORMED_EXTERNAL_ID" };
  }
  const [, dealId, formCode, signerOwnershipEntityId] = match;

  // Defense in depth — re-confirm IAL2 still holds at completion time.
  const ial2Valid = await hasValidIal2(dealId, signerOwnershipEntityId, sb);
  if (!ial2Valid) {
    await sb.from("deal_events").insert({
      deal_id: dealId,
      kind: "esign.completed_without_ial2_anomaly",
      payload: { form_code: formCode, signer_ownership_entity_id: signerOwnershipEntityId, raw_payload: payload },
    });
    return { ok: false, reason: "IAL2_GATE_FAILED_AT_COMPLETION" };
  }

  const documentId = String(payload.data.object.id ?? "");
  const document = await signwell.fetchSignwellDocument(documentId);

  const { data: deal } = await sb.from("deals").select("bank_id").eq("id", dealId).maybeSingle();
  if (!deal) {
    return { ok: false, reason: "DEAL_NOT_FOUND" };
  }

  const { data: verification } = await sb
    .from("borrower_identity_verifications")
    .select("id")
    .eq("deal_id", dealId)
    .eq("ownership_entity_id", signerOwnershipEntityId)
    .in("status", ["completed", "approved"])
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let pdfBytes: Buffer;
  try {
    pdfBytes = await signwell.downloadSignwellCompletedPdf(documentId);
  } catch (err: any) {
    return { ok: false, reason: "PDF_UPLOAD_FAILED", detail: err?.message ?? String(err) };
  }

  // SignWell's Audit & Lock trail is appended inside this same PDF — no
  // separate audit-trail file to fetch (see client.ts).
  const pdfPath = `signed-documents/${dealId}/${formCode}/${signerOwnershipEntityId}/${documentId}.pdf`;

  if (!sb.storage) {
    return { ok: false, reason: "PDF_UPLOAD_FAILED", detail: "no_storage_capable_client" };
  }

  const pdfUpload = await sb.storage.from("signed-documents").upload(pdfPath, pdfBytes, { contentType: "application/pdf" });
  if (pdfUpload.error) {
    return { ok: false, reason: "PDF_UPLOAD_FAILED", detail: pdfUpload.error.message };
  }

  const completedAt = new Date();
  const stalenessDays = formStalenessDays(formCode);
  const expiresAt = new Date(completedAt.getTime() + stalenessDays * 86_400_000);

  const { data: signedDoc, error } = await sb
    .from("signed_documents")
    .insert({
      deal_id: dealId,
      bank_id: deal.bank_id,
      esign_provider: "signwell",
      form_code: formCode,
      template_version: "v1",
      signer_ownership_entity_id: signerOwnershipEntityId,
      signer_role: "applicant",
      identity_verification_id: verification?.id ?? null,
      esign_document_id: documentId,
      esign_signer_id: String(document.recipients[0]?.id ?? ""),
      signed_pdf_storage_path: pdfPath,
      audit_trail_storage_path: null,
      signature_request_sent_at: completedAt.toISOString(),
      signature_completed_at: completedAt.toISOString(),
      staleness_window_days: stalenessDays,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (error || !signedDoc) {
    return { ok: false, reason: "PDF_UPLOAD_FAILED", detail: error?.message ?? "insert_failed" };
  }

  await sb.from("deal_events").insert({
    deal_id: dealId,
    kind: "esign.completed",
    payload: { form_code: formCode, signer_ownership_entity_id: signerOwnershipEntityId, signed_document_id: signedDoc.id },
  });

  // Mirror completion onto the in-flight tracking row — best-effort, same
  // discipline as the insert in requestSignature: signed_documents is
  // already the durable compliance record at this point, so a failure here
  // only affects the "in-flight" view, not the signature itself.
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
