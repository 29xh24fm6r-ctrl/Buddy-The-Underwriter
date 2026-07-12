/**
 * SPEC S3 A-3 — KYC orchestration. Kept free of "server-only" (unlike
 * persona.ts) so it stays testable under the plain `node --test` harness —
 * same pattern as src/lib/brokerage/compliancePackage.ts. Callers (API
 * routes) inject a real Supabase client and the real Persona client
 * functions; tests inject lightweight fakes.
 */

export type KycSupabaseClient = { from: (table: string) => any };

export type PersonaClient = {
  createPersonaInquiry: (args: {
    templateId: string;
    referenceId: string;
    fields?: { nameFirst?: string; nameLast?: string };
  }) => Promise<{ data: { id: string } }>;
  fetchPersonaInquiry: (inquiryId: string) => Promise<{
    data: { id: string; attributes: { status: string; "name-first"?: string | null; "name-last"?: string | null } };
  }>;
  generatePersonaOneTimeLink: (inquiryId: string) => Promise<string>;
};

export type InitiateKycArgs = {
  dealId: string;
  bankId: string;
  ownershipEntityId: string;
  initiatorUserId: string;
  initiatorIp?: string | null;
  initiatorUserAgent?: string | null;
};

export type InitiateKycResult =
  | { ok: true; verification: Record<string, any>; oneTimeLink: string | null; reused: boolean }
  | { ok: false; reason: "OWNER_NOT_FOUND" | "DB_INSERT_FAILED"; detail?: string };

const PENDING_STATUSES = ["created", "pending"];
const TERMINAL_SUCCESS_STATUSES = ["completed", "approved"];

function splitName(displayName: string | null | undefined): { nameFirst?: string; nameLast?: string } {
  if (!displayName) return {};
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) return { nameFirst: parts[0] };
  return { nameFirst: parts.slice(0, -1).join(" "), nameLast: parts[parts.length - 1] };
}

export async function initiateKyc(
  args: InitiateKycArgs,
  deps: { sb: KycSupabaseClient; persona: PersonaClient; templateId: string },
): Promise<InitiateKycResult> {
  const { sb, persona, templateId } = deps;

  const { data: existing } = await sb
    .from("borrower_identity_verifications")
    .select("*")
    .eq("deal_id", args.dealId)
    .eq("ownership_entity_id", args.ownershipEntityId)
    .in("status", PENDING_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    let oneTimeLink: string | null = null;
    try {
      oneTimeLink = await persona.generatePersonaOneTimeLink(existing.vendor_inquiry_id);
    } catch {
      // Non-fatal — the caller can retry the link separately; the record still exists.
    }
    return { ok: true, verification: existing, oneTimeLink, reused: true };
  }

  const { data: owner } = await sb
    .from("ownership_entities")
    .select("id, display_name, evidence_json")
    .eq("id", args.ownershipEntityId)
    .maybeSingle();

  if (!owner) {
    return { ok: false, reason: "OWNER_NOT_FOUND" };
  }

  const referenceId = `deal:${args.dealId}:owner:${args.ownershipEntityId}`;
  const nameFields = splitName(owner.display_name);

  const inquiry = await persona.createPersonaInquiry({
    templateId,
    referenceId,
    fields: nameFields,
  });

  const { data: inserted, error } = await sb
    .from("borrower_identity_verifications")
    .insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      ownership_entity_id: args.ownershipEntityId,
      vendor: "persona",
      vendor_inquiry_id: inquiry.data.id,
      vendor_template_id: templateId,
      status: "created",
      initiator_user_id: args.initiatorUserId,
      initiator_ip: args.initiatorIp ?? null,
      initiator_user_agent: args.initiatorUserAgent ?? null,
    })
    .select("*")
    .single();

  if (error || !inserted) {
    return { ok: false, reason: "DB_INSERT_FAILED", detail: error?.message };
  }

  await sb.from("deal_events").insert({
    deal_id: args.dealId,
    kind: "kyc.verification_initiated",
    payload: { ownership_entity_id: args.ownershipEntityId, vendor_inquiry_id: inquiry.data.id },
  });

  let oneTimeLink: string | null = null;
  try {
    oneTimeLink = await persona.generatePersonaOneTimeLink(inquiry.data.id);
  } catch {
    // Non-fatal — record is created; the UI can retry fetching the link.
  }

  return { ok: true, verification: inserted, oneTimeLink, reused: false };
}

export type HandlePersonaWebhookResult =
  | { ok: true; verification_id: string; status: string }
  | { ok: false; reason: "MISSING_INQUIRY_ID" | "VERIFICATION_NOT_FOUND" };

export async function handlePersonaWebhook(
  payload: Record<string, any>,
  deps: { sb: KycSupabaseClient; persona: PersonaClient },
): Promise<HandlePersonaWebhookResult> {
  const { sb, persona } = deps;

  const inquiryId: string | undefined =
    payload?.data?.attributes?.payload?.data?.id ?? payload?.data?.id ?? payload?.inquiry_id;
  if (!inquiryId) {
    return { ok: false, reason: "MISSING_INQUIRY_ID" };
  }

  // Never trust the webhook payload alone — refetch canonical state
  // (replay safety, per spec risk #5).
  const inquiry = await persona.fetchPersonaInquiry(inquiryId);
  const status = inquiry.data.attributes.status;

  const { data: record } = await sb
    .from("borrower_identity_verifications")
    .select("id")
    .eq("vendor_inquiry_id", inquiryId)
    .maybeSingle();

  if (!record) {
    return { ok: false, reason: "VERIFICATION_NOT_FOUND" };
  }

  const update: Record<string, any> = { status };
  if (TERMINAL_SUCCESS_STATUSES.includes(status)) {
    update.completed_at = new Date().toISOString();
    update.id_document_first_name = inquiry.data.attributes["name-first"] ?? null;
    update.id_document_last_name = inquiry.data.attributes["name-last"] ?? null;
  }

  await sb.from("borrower_identity_verifications").update(update).eq("id", record.id);

  const { data: fullRecord } = await sb
    .from("borrower_identity_verifications")
    .select("deal_id")
    .eq("id", record.id)
    .maybeSingle();

  await sb.from("deal_events").insert({
    deal_id: fullRecord?.deal_id ?? null,
    kind: `kyc.verification_${status}`,
    payload: { verification_id: record.id, vendor_inquiry_id: inquiryId },
  });

  return { ok: true, verification_id: record.id, status };
}

export async function hasValidIal2(
  dealId: string,
  ownershipEntityId: string,
  sb: KycSupabaseClient,
): Promise<boolean> {
  const { data } = await sb
    .from("borrower_identity_verifications")
    .select("id, completed_at")
    .eq("deal_id", dealId)
    .eq("ownership_entity_id", ownershipEntityId)
    .in("status", TERMINAL_SUCCESS_STATUSES)
    .not("completed_at", "is", null)
    .limit(1)
    .maybeSingle();

  return Boolean(data);
}
