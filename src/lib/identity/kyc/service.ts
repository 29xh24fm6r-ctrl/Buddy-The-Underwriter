/**
 * KYC orchestration. Kept free of "server-only" (unlike didit.ts) so it
 * stays testable under the plain `node --test` harness — same pattern as
 * src/lib/brokerage/compliancePackage.ts. Callers (API routes) inject a
 * real Supabase client and the real Didit client functions; tests inject
 * lightweight fakes.
 *
 * Vendor: Didit (replaces Persona — see
 * docs/build-logs/ARC00_VENDOR_PROVISIONING_CHECKLIST.md item 2). Didit's
 * hosted session already returns a usable verification URL at creation
 * time, so unlike Persona there's no separate one-time-link call: the
 * session `url` is persisted on the row and reused as-is on retry.
 */

export type KycSupabaseClient = { from: (table: string) => any };

export type DiditClient = {
  createDiditSession: (args: { workflowId: string; vendorData: string; callbackUrl?: string }) => Promise<{
    session_id: string;
    status: string;
    workflow_id: string;
    url: string;
  }>;
  fetchDiditSession: (sessionId: string) => Promise<{ session_id: string; status: string; workflow_id: string; url: string }>;
  getDiditSessionDecision: (sessionId: string) => Promise<{ session_id: string; status: string; [key: string]: unknown }>;
};

export type InitiateKycArgs = {
  dealId: string;
  bankId: string;
  ownershipEntityId: string;
  initiatorUserId: string;
  initiatorIp?: string | null;
  initiatorUserAgent?: string | null;
  /**
   * Test-mode only — lets a mock-vendor caller record `vendor: "mock_didit"`
   * instead of "didit" so a fake verification is never indistinguishable
   * from a real one when someone queries this table. Real callers must
   * never pass this; it defaults to "didit".
   */
  vendorOverride?: string;
};

export type InitiateKycResult =
  | { ok: true; verification: Record<string, any>; sessionUrl: string | null; reused: boolean }
  | { ok: false; reason: "OWNER_NOT_FOUND" | "DB_INSERT_FAILED"; detail?: string };

const PENDING_STATUSES = ["created", "pending"];
const TERMINAL_SUCCESS_STATUSES = ["completed", "approved"];

/**
 * Didit session statuses (`Not Started`, `In Progress`, `Approved`,
 * `Declined`, `In Review`, `Expired`, `Abandoned`, `KYC Expired`) don't
 * share vocabulary with Buddy's internal `borrower_identity_verifications.status`
 * enum (`created|pending|completed|approved|failed|expired|declined|needs_review`)
 * — this is the only place the two vocabularies meet.
 */
export function mapDiditStatus(diditStatus: string): string {
  switch (diditStatus) {
    case "Not Started":
      return "created";
    case "In Progress":
      return "pending";
    case "Approved":
      return "approved";
    case "Declined":
      return "declined";
    case "In Review":
      return "needs_review";
    case "Expired":
    case "KYC Expired":
      return "expired";
    case "Abandoned":
      return "failed";
    default:
      return "pending";
  }
}

export async function initiateKyc(
  args: InitiateKycArgs,
  deps: { sb: KycSupabaseClient; didit: DiditClient; workflowId: string },
): Promise<InitiateKycResult> {
  const { sb, didit, workflowId } = deps;

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
    return { ok: true, verification: existing, sessionUrl: existing.vendor_artifacts_url ?? null, reused: true };
  }

  const { data: owner } = await sb
    .from("ownership_entities")
    .select("id, display_name")
    .eq("id", args.ownershipEntityId)
    .maybeSingle();

  if (!owner) {
    return { ok: false, reason: "OWNER_NOT_FOUND" };
  }

  const vendorData = `deal:${args.dealId}:owner:${args.ownershipEntityId}`;

  const session = await didit.createDiditSession({
    workflowId,
    vendorData,
    callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/kyc/complete`,
  });

  const { data: inserted, error } = await sb
    .from("borrower_identity_verifications")
    .insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      ownership_entity_id: args.ownershipEntityId,
      vendor: args.vendorOverride ?? "didit",
      vendor_inquiry_id: session.session_id,
      vendor_template_id: workflowId,
      vendor_artifacts_url: session.url,
      status: mapDiditStatus(session.status),
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
    payload: { ownership_entity_id: args.ownershipEntityId, vendor_inquiry_id: session.session_id },
  });

  return { ok: true, verification: inserted, sessionUrl: session.url, reused: false };
}

export type HandleDiditWebhookResult =
  | { ok: true; verification_id: string; status: string }
  | { ok: false; reason: "MISSING_SESSION_ID" | "VERIFICATION_NOT_FOUND" };

export async function handleDiditWebhook(
  payload: Record<string, any>,
  deps: { sb: KycSupabaseClient; didit: DiditClient },
): Promise<HandleDiditWebhookResult> {
  const { sb, didit } = deps;

  const sessionId: string | undefined = payload?.session_id;
  if (!sessionId) {
    return { ok: false, reason: "MISSING_SESSION_ID" };
  }

  // Never trust the webhook payload alone — refetch canonical state from
  // Didit (replay safety, same discipline as the former Persona handler).
  const session = await didit.fetchDiditSession(sessionId);
  const status = mapDiditStatus(session.status);

  const { data: record } = await sb
    .from("borrower_identity_verifications")
    .select("id")
    .eq("vendor_inquiry_id", sessionId)
    .maybeSingle();

  if (!record) {
    return { ok: false, reason: "VERIFICATION_NOT_FOUND" };
  }

  const update: Record<string, any> = { status };
  if (TERMINAL_SUCCESS_STATUSES.includes(status)) {
    update.completed_at = new Date().toISOString();
    // Didit's decision payload field paths (document type/name/DOB, selfie
    // match score, liveness) haven't been confirmed against a live account
    // yet — fetched here for the audit record but not mapped into the
    // Persona-shaped id_document_* / selfie_match_score columns until that
    // shape is verified. See docs/build-logs/ARC00_VENDOR_PROVISIONING_CHECKLIST.md.
    try {
      await didit.getDiditSessionDecision(sessionId);
    } catch {
      // Non-fatal — status is already updated; decision detail is best-effort.
    }
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
    payload: { verification_id: record.id, vendor_inquiry_id: sessionId },
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
