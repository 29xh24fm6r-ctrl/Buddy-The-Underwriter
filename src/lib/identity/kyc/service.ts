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
  fetchDiditSession: (sessionId: string) => Promise<{ session_id: string; status: string; [key: string]: unknown }>;
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
  /**
   * Where Didit sends the borrower after they finish. Callers that know
   * the borrower's portal token should pass a token-bearing URL so the
   * borrower lands back inside their own application rather than on a
   * generic page. Defaults to `<app>/kyc/complete`.
   */
  returnUrl?: string;
};

export type InitiateKycResult =
  | { ok: true; verification: Record<string, any>; sessionUrl: string | null; reused: boolean }
  | { ok: false; reason: "OWNER_NOT_FOUND" | "DB_INSERT_FAILED"; detail?: string };

const PENDING_STATUSES = ["created", "pending"];
const TERMINAL_SUCCESS_STATUSES = ["completed", "approved"];

/**
 * Base URL for borrower-facing return links, normalized to https.
 *
 * Production had NEXT_PUBLIC_APP_URL set to `http://buddytheunderwriter.com`,
 * so every Didit session was created with a plaintext callback on the
 * apex domain — which then 307-redirected the returning borrower away
 * from the app. Forcing https here means a stale/incorrect scheme in the
 * env var can no longer bounce a borrower out of their own flow. The host
 * itself still comes from configuration; see the deployment note in the
 * 2026-08-25 incident write-up.
 */
export function kycReturnBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (!raw) return "";
  return raw.replace(/^http:\/\//i, "https://").replace(/\/+$/, "");
}

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
    callbackUrl: args.returnUrl ?? `${kycReturnBaseUrl()}/kyc/complete`,
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
    // fetchDiditSession already returned Didit's canonical decision payload.
    // Decision details remain intentionally unmapped until their production
    // shape is verified; status persistence must not issue a second vendor GET.
    update.completed_at = new Date().toISOString();
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

/**
 * Statuses that are still waiting on the borrower or on Didit, i.e. rows
 * that are candidates for reconciliation. `created` is included because
 * that is exactly the state a row is stranded in when the completion
 * webhook never lands.
 */
export const RECONCILABLE_STATUSES = ["created", "pending", "needs_review"];

export type ReconcileResult =
  | { ok: true; verificationId: string; previousStatus: string; status: string; changed: boolean }
  | { ok: false; reason: "VERIFICATION_NOT_FOUND" | "NO_VENDOR_SESSION" | "VENDOR_FETCH_FAILED"; detail?: string };

/**
 * Pull canonical state for ONE verification straight from Didit and write
 * it back to `borrower_identity_verifications`.
 *
 * This is the fallback the system did not have. Webhook delivery is
 * best-effort by nature — a filtered subscription, a rotated secret, a
 * deploy during the delivery window, or a vendor-side outage all end the
 * same way: the borrower finishes on Didit, the row stays "created", and
 * the seal gate blocks forever with nothing the borrower can do. That is
 * precisely what happened on 2026-08-25 (session 252f29e1 was `Approved`
 * at Didit while the row sat at `created`, and Didit's own destination
 * metrics showed zero delivery attempts had ever been made).
 *
 * Deliberately idempotent: safe to call on every borrower page load, from
 * the return-from-Didit landing page, from a manual "Refresh status"
 * button, and from cron. Only writes when the mapped status actually
 * differs, so repeat calls are cheap and never churn `deal_events`.
 *
 * Mock-vendor rows (`vendor: "mock_didit"`) are skipped — reconciling them
 * against the real API would fail, and a fake verification must never be
 * promoted by a real vendor lookup.
 */
export async function reconcileVerification(
  verificationId: string,
  deps: { sb: KycSupabaseClient; didit: Pick<DiditClient, "fetchDiditSession"> },
): Promise<ReconcileResult> {
  const { sb, didit } = deps;

  const { data: record } = await sb
    .from("borrower_identity_verifications")
    .select("id, deal_id, ownership_entity_id, vendor, vendor_inquiry_id, status, completed_at")
    .eq("id", verificationId)
    .maybeSingle();

  if (!record) return { ok: false, reason: "VERIFICATION_NOT_FOUND" };
  if (!record.vendor_inquiry_id || record.vendor === "mock_didit") {
    return { ok: false, reason: "NO_VENDOR_SESSION" };
  }

  let session: { status: string };
  try {
    session = await didit.fetchDiditSession(record.vendor_inquiry_id);
  } catch (e) {
    return {
      ok: false,
      reason: "VENDOR_FETCH_FAILED",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  const previousStatus = String(record.status);
  const status = mapDiditStatus(session.status);
  const reachedSuccess = TERMINAL_SUCCESS_STATUSES.includes(status);

  // No status change AND nothing to backfill — nothing to write.
  if (status === previousStatus && !(reachedSuccess && !record.completed_at)) {
    return { ok: true, verificationId, previousStatus, status, changed: false };
  }

  const update: Record<string, any> = { status };
  if (reachedSuccess && !record.completed_at) {
    // The canonical fetch above already returned the decision payload; avoid
    // a redundant vendor round-trip while stamping the successful result.
    update.completed_at = new Date().toISOString();
  }

  await sb.from("borrower_identity_verifications").update(update).eq("id", record.id);

  await sb.from("deal_events").insert({
    deal_id: record.deal_id ?? null,
    kind: `kyc.verification_${status}`,
    payload: {
      verification_id: record.id,
      ownership_entity_id: record.ownership_entity_id ?? null,
      vendor_inquiry_id: record.vendor_inquiry_id,
      previous_status: previousStatus,
      source: "reconcile",
    },
  });

  return { ok: true, verificationId, previousStatus, status, changed: true };
}

export type ReconcileBatchResult = {
  examined: number;
  changed: number;
  failed: number;
  results: Array<{ verificationId: string; previousStatus: string; status: string; changed: boolean }>;
};

/**
 * Reconcile every non-terminal verification, optionally scoped to one
 * deal. Used by the borrower portal (scoped, so a borrower's own page
 * load self-heals their deal) and by cron (unscoped, so a borrower who
 * never comes back is still un-stranded before their banker notices).
 *
 * Failures are counted, never thrown: one dead vendor session must not
 * stop the rest of the batch.
 */
export async function reconcilePendingVerifications(
  args: { dealId?: string; limit?: number },
  deps: { sb: KycSupabaseClient; didit: Pick<DiditClient, "fetchDiditSession"> },
): Promise<ReconcileBatchResult> {
  const { sb } = deps;
  const limit = args.limit ?? 50;

  let query = sb
    .from("borrower_identity_verifications")
    .select("id")
    .eq("vendor", "didit")
    .in("status", RECONCILABLE_STATUSES)
    .not("vendor_inquiry_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (args.dealId) query = query.eq("deal_id", args.dealId);

  const { data: rows } = await query;
  const candidates = (rows ?? []) as Array<{ id: string }>;

  const out: ReconcileBatchResult = { examined: candidates.length, changed: 0, failed: 0, results: [] };

  for (const row of candidates) {
    const result = await reconcileVerification(row.id, deps);
    if (!result.ok) {
      out.failed += 1;
      console.error("[kyc/reconcile] failed", { verificationId: row.id, reason: result.reason, detail: result.detail });
      continue;
    }
    if (result.changed) out.changed += 1;
    out.results.push({
      verificationId: result.verificationId,
      previousStatus: result.previousStatus,
      status: result.status,
      changed: result.changed,
    });
  }

  return out;
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
