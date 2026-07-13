import * as crypto from "node:crypto";

/**
 * SPEC S5 B-4 — real E-Tran submission orchestration. Free of "server-only"
 * and DI'd (real https/crypto/generateETranXML/getEtranCredentials/
 * supabaseAdmin wired in by the API route; tests inject fakes) — same
 * testability pattern every other service module in this arc uses, unlike
 * the spec's own code sample which calls supabaseAdmin()/generateETranXML
 * directly and couldn't be unit tested.
 *
 * **PERMANENT HUMAN-APPROVAL GATE (principle #25, non-negotiable):** there
 * is no code path in this file — or anywhere in this arc — that calls
 * `submitToSba` without an `approvedByUserId` supplied by the caller. The
 * API route that wires this up (etran/submit) requires an authenticated
 * Clerk session and passes that session's user id through explicitly.
 * There is no "auto-submit when ready" flag, env var, or cron job. Do not
 * add one. SR 11-7 wall.
 */

export type GenerateEtranXmlFn = (args: { dealId: string; bankId: string }) => Promise<{ xml: string; validation_errors: string[]; ready_for_review: boolean }>;

export type GetEtranCredentialsFn = (bankId: string) => Promise<{
  sba_lender_id: string;
  sba_service_center: string;
  client_cert_pem: string;
  client_key_pem: string;
  endpoint_environment: "sandbox" | "production";
} | null>;

export type PostToSbaFn = (args: { endpoint: string; xml: string; clientCertPem: string; clientKeyPem: string }) => Promise<{
  accepted: boolean;
  body: string;
  rejectionReason?: string;
}>;

export type EtranSupabaseClient = {
  from: (table: string) => any;
  storage?: { from: (bucket: string) => { upload: (path: string, data: Buffer | string, opts?: any) => Promise<{ error: any }> } };
};

const REQUIRED_SIGNED_FORM_CODES = ["FORM_1919", "FORM_413", "FORM_4506C"];

export type SubmitToSbaResult =
  | { ok: true; sba_application_number: string; submission_id: string }
  | {
      ok: false;
      reason: "VALIDATION_FAILED" | "REQUIRED_SIGNED_FORMS_MISSING" | "ETRAN_CREDENTIALS_MISSING" | "SBA_REJECTED" | "NETWORK_ERROR" | "DB_INSERT_FAILED";
      details?: string;
    };

export async function submitToSba(
  args: { dealId: string; bankId: string; approvedByUserId: string },
  deps: {
    sb: EtranSupabaseClient;
    generateXml: GenerateEtranXmlFn;
    getCredentials: GetEtranCredentialsFn;
    postToSba: PostToSbaFn;
    sandboxEndpoint: string;
    productionEndpoint: string;
  },
): Promise<SubmitToSbaResult> {
  const { sb, generateXml, getCredentials, postToSba, sandboxEndpoint, productionEndpoint } = deps;

  if (!args.approvedByUserId) {
    // Defense-in-depth — the API route already requires an authenticated
    // session, but this function must never proceed without it either.
    return { ok: false, reason: "VALIDATION_FAILED", details: "approvedByUserId is required" };
  }

  // 1. Build XML
  const xmlResult = await generateXml({ dealId: args.dealId, bankId: args.bankId });
  if (!xmlResult.ready_for_review) {
    return { ok: false, reason: "VALIDATION_FAILED", details: xmlResult.validation_errors.join(";") };
  }

  // 2. Pre-flight: required signed forms present + non-stale
  const { data: signed } = await sb
    .from("signed_documents")
    .select("form_code")
    .eq("deal_id", args.dealId)
    .gt("expires_at", new Date().toISOString());
  const present = new Set(((signed ?? []) as Array<{ form_code: string }>).map((r) => r.form_code));
  const missing = REQUIRED_SIGNED_FORM_CODES.filter((c) => !present.has(c));
  if (missing.length > 0) {
    return { ok: false, reason: "REQUIRED_SIGNED_FORMS_MISSING", details: missing.join(",") };
  }

  // 3. Fetch credentials
  const creds = await getCredentials(args.bankId);
  if (!creds) return { ok: false, reason: "ETRAN_CREDENTIALS_MISSING" };

  // 4. Persist XML
  const xmlPath = `etran/${args.dealId}/${Date.now()}.xml`;
  if (sb.storage) {
    await sb.storage.from("etran-submissions").upload(xmlPath, xmlResult.xml, { contentType: "application/xml" });
  }

  // 5. Idempotency
  const idempotencyKey = crypto.createHash("sha256").update(`${args.dealId}:etran_submit:${xmlResult.xml}`).digest("hex");

  // 6. Insert pre-call submission record
  const { data: submission, error: insertErr } = await sb
    .from("sba_etran_submissions")
    .insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      status: "prepared",
      xml_storage_path: xmlPath,
      endpoint_environment: creds.endpoint_environment,
      approved_by_user_id: args.approvedByUserId,
      approved_at: new Date().toISOString(),
      validation_passed: true,
      validation_errors: [],
      idempotency_key: idempotencyKey,
    })
    .select("*")
    .single();

  if (insertErr) {
    // Idempotency replay — return existing
    if (insertErr.code === "23505") {
      const { data: existing } = await sb.from("sba_etran_submissions").select("*").eq("idempotency_key", idempotencyKey).single();
      if (existing?.sba_application_number) {
        return { ok: true, sba_application_number: existing.sba_application_number, submission_id: existing.id };
      }
    }
    return { ok: false, reason: "DB_INSERT_FAILED", details: insertErr.message };
  }

  // 7. POST to SBA E-Tran
  const endpoint = creds.endpoint_environment === "production" ? productionEndpoint : sandboxEndpoint;

  try {
    const response = await postToSba({ endpoint, xml: xmlResult.xml, clientCertPem: creds.client_cert_pem, clientKeyPem: creds.client_key_pem });

    const respPath = `etran/${args.dealId}/${submission.id}-response.xml`;
    if (sb.storage) {
      await sb.storage.from("etran-submissions").upload(respPath, response.body, { contentType: "application/xml" });
    }

    const sbaAppNumber = parseSbaApplicationNumber(response.body);

    await sb
      .from("sba_etran_submissions")
      .update({
        status: response.accepted ? "accepted" : "rejected",
        sba_application_number: sbaAppNumber,
        response_storage_path: respPath,
        submitted_at: new Date().toISOString(),
        responded_at: new Date().toISOString(),
        status_reason: response.accepted ? null : response.rejectionReason,
      })
      .eq("id", submission.id);

    await sb.from("deal_events").insert({
      deal_id: args.dealId,
      kind: response.accepted ? "sba_application_submitted" : "sba_application_rejected",
      payload: { sba_application_number: sbaAppNumber, submission_id: submission.id, environment: creds.endpoint_environment },
    });

    return response.accepted
      ? { ok: true, sba_application_number: sbaAppNumber!, submission_id: submission.id }
      : { ok: false, reason: "SBA_REJECTED", details: response.rejectionReason };
  } catch (err: any) {
    await sb.from("sba_etran_submissions").update({ status: "error", status_reason: err?.message ?? String(err) }).eq("id", submission.id);
    return { ok: false, reason: "NETWORK_ERROR", details: err?.message ?? String(err) };
  }
}

function parseSbaApplicationNumber(xml: string): string | null {
  const match = xml.match(/<ApplicationNumber>([^<]+)<\/ApplicationNumber>/);
  return match ? match[1] : null;
}
