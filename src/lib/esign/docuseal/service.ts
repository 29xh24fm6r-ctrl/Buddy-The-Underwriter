/**
 * SPEC S3 B-6 — e-sign orchestration. **This is where the IAL2 gate
 * lives** (principle #17 — non-negotiable, enforced at both request time
 * and webhook completion time). Kept free of "server-only" so it stays
 * testable — same pattern as kyc/service.ts and compliancePackage.ts.
 */

import { hasValidIal2, type KycSupabaseClient } from "@/lib/identity/kyc/service";

export type EsignSupabaseClient = KycSupabaseClient & {
  storage?: { from: (bucket: string) => { upload: (path: string, data: Buffer, opts?: any) => Promise<{ error: any }> } };
};

export type DocusealClient = {
  createDocusealSubmission: (args: {
    templateId: string;
    submitters: Array<{ email: string; name: string; role?: string; fields?: Record<string, unknown> }>;
    externalId: string;
    sendEmail?: boolean;
    signOrdered?: boolean;
  }) => Promise<{ id: number; status: string; submitters: Array<{ id: number; slug: string }> }>;
  fetchDocusealSubmission: (submissionId: string) => Promise<{
    id: number;
    status: string;
    submitters: Array<{ id: number; slug: string }>;
  }>;
  downloadDocusealSignedPdf: (submissionId: string) => Promise<Buffer>;
  downloadDocusealAuditTrail: (submissionId: string) => Promise<Buffer | null>;
};

const FORM_STALENESS_DAYS: Record<string, number> = {
  FORM_1919: 90,
  FORM_413: 90,
  FORM_4506C: 120,
};

export function formStalenessDays(formCode: string): number {
  return FORM_STALENESS_DAYS[formCode] ?? 365;
}

export function resolveTemplateId(formCode: string, _templateVersion: string): string {
  const envKey = `DOCUSEAL_TEMPLATE_${formCode.replace(/^FORM_/, "")}`;
  const value = process.env[envKey];
  if (!value) {
    throw new Error(`docuseal_template_not_configured: ${envKey}`);
  }
  return value;
}

export function buildEmbedUrl(submissionSlug: string): string {
  const base = process.env.DOCUSEAL_BASE_URL_PUBLIC;
  if (!base) throw new Error("Missing DOCUSEAL_BASE_URL_PUBLIC");
  return `${base}/s/${submissionSlug}`;
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
  prefillFields?: Record<string, unknown>;
};

export type RequestSignatureResult =
  | { ok: true; submissionId: string; embedUrl: string }
  | { ok: false; reason: "IAL2_NOT_COMPLETED" | "SUBMISSION_FAILED"; detail?: string };

export async function requestSignature(
  args: RequestSignatureArgs,
  deps: { sb: EsignSupabaseClient; docuseal: DocusealClient },
): Promise<RequestSignatureResult> {
  const { sb, docuseal } = deps;

  // IAL2 GATE — no exceptions (principle #17).
  const ial2Valid = await hasValidIal2(args.dealId, args.signerOwnershipEntityId, sb);
  if (!ial2Valid) {
    return { ok: false, reason: "IAL2_NOT_COMPLETED" };
  }

  const templateId = resolveTemplateId(args.formCode, args.templateVersion);
  const externalId = `deal:${args.dealId}:form:${args.formCode}:signer:${args.signerOwnershipEntityId}`;

  let submission;
  try {
    submission = await docuseal.createDocusealSubmission({
      templateId,
      submitters: [{ email: args.signerEmail, name: args.signerName, fields: args.prefillFields }],
      externalId,
      sendEmail: false,
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
      submission_id: String(submission.id),
    },
  });

  const slug = submission.submitters[0]?.slug ?? String(submission.id);
  return { ok: true, submissionId: String(submission.id), embedUrl: buildEmbedUrl(slug) };
}

export type HandleDocusealWebhookResult =
  | { ok: true; ignored: true }
  | { ok: true; signedDocumentId: string }
  | { ok: false; reason: "MALFORMED_EXTERNAL_ID" | "IAL2_GATE_FAILED_AT_COMPLETION" | "PDF_UPLOAD_FAILED" | "DEAL_NOT_FOUND"; detail?: string };

export async function handleDocusealWebhook(
  payload: { event_type: string; data: { external_id?: string; id?: number | string; submission_id?: number | string } },
  deps: { sb: EsignSupabaseClient; docuseal: DocusealClient },
): Promise<HandleDocusealWebhookResult> {
  const { sb, docuseal } = deps;

  if (payload.event_type !== "form.completed") {
    return { ok: true, ignored: true };
  }

  const externalId = payload.data.external_id ?? "";
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

  const submissionId = String(payload.data.submission_id ?? payload.data.id ?? "");
  const submission = await docuseal.fetchDocusealSubmission(submissionId);

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
  let auditBytes: Buffer | null;
  try {
    pdfBytes = await docuseal.downloadDocusealSignedPdf(submissionId);
    auditBytes = await docuseal.downloadDocusealAuditTrail(submissionId);
  } catch (err: any) {
    return { ok: false, reason: "PDF_UPLOAD_FAILED", detail: err?.message ?? String(err) };
  }

  const pdfPath = `signed-documents/${dealId}/${formCode}/${signerOwnershipEntityId}/${submissionId}.pdf`;
  const auditPath = `signed-documents/${dealId}/${formCode}/${signerOwnershipEntityId}/${submissionId}-audit.json`;

  if (!sb.storage) {
    return { ok: false, reason: "PDF_UPLOAD_FAILED", detail: "no_storage_capable_client" };
  }

  const pdfUpload = await sb.storage.from("signed-documents").upload(pdfPath, pdfBytes, { contentType: "application/pdf" });
  if (pdfUpload.error) {
    return { ok: false, reason: "PDF_UPLOAD_FAILED", detail: pdfUpload.error.message };
  }
  if (auditBytes) {
    await sb.storage.from("signed-documents").upload(auditPath, auditBytes, { contentType: "application/json" });
  }

  const completedAt = new Date();
  const stalenessDays = formStalenessDays(formCode);
  const expiresAt = new Date(completedAt.getTime() + stalenessDays * 86_400_000);

  const { data: signedDoc, error } = await sb
    .from("signed_documents")
    .insert({
      deal_id: dealId,
      bank_id: deal.bank_id,
      form_code: formCode,
      template_version: "v1",
      signer_ownership_entity_id: signerOwnershipEntityId,
      signer_role: "applicant",
      identity_verification_id: verification?.id ?? null,
      docuseal_submission_id: submissionId,
      docuseal_submitter_id: String(submission.submitters[0]?.id ?? ""),
      signed_pdf_storage_path: pdfPath,
      audit_trail_storage_path: auditPath,
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

  return { ok: true, signedDocumentId: String(signedDoc.id) };
}
