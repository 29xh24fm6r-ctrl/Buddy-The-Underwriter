/**
 * Phase 11D — Comms Outbox Worker
 *
 * Durable outbox processor: enqueue → claim → send → ledger → retry/exhaust.
 * No cron yet — exposes callable functions only.
 */

import { type SendResult } from "@/lib/brokerage/commsAdapters";
import {
  recordCommsSendRequested,
  recordCommsSendSucceeded,
  recordCommsSendFailed,
  recordCommsRetryScheduled,
  recordCommsRetryExhausted,
  maskRecipient,
} from "@/lib/brokerage/commsLedger";
import {
  normalizeSendResultToRetryDecision,
  MAX_ATTEMPTS,
} from "@/lib/brokerage/commsRetryQueue";

// ── Types ───────────────────────────────────────────────────────────────────

export type OutboxStatus = "pending" | "sending" | "sent" | "failed" | "retry_scheduled" | "exhausted";

export type OutboxItem = {
  id: string;
  idempotencyKey: string;
  channel: "email" | "sms" | "slack";
  provider: "resend" | "telnyx" | "slack";
  recipient: string;
  subject: string | null;
  body: string;
  dealId: string | null;
  triggerKey: string | null;
  status: OutboxStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastFailureCode: string | null;
  providerMessageId: string | null;
};

export type EnqueueArgs = {
  idempotencyKey: string;
  channel: "email" | "sms" | "slack";
  provider: "resend" | "telnyx" | "slack";
  recipient: string;
  subject?: string;
  body: string;
  dealId?: string;
  triggerKey?: string;
};

export type ProcessResult = {
  processed: number;
  sent: number;
  retried: number;
  exhausted: number;
  failed: number;
};

type Row = Record<string, any>;
type SB = { from: (t: string) => any };
type Adapter = (msg: { recipient: string; subject: string | null; body: string }) => Promise<SendResult>;

function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function now(): string { return new Date().toISOString(); }

const CLAIM_LEASE_MS = 5 * 60_000;

type QueryError = { message?: string } | null | undefined;

function assertDbOk(error: QueryError, operation: string): void {
  if (error) {
    throw new Error(`[comms-outbox] ${operation}: ${str(error.message) ?? "database_error"}`);
  }
}

function requireRow<T>(data: T | null | undefined, error: QueryError, operation: string): T {
  assertDbOk(error, operation);
  if (!data) throw new Error(`[comms-outbox] ${operation}: row_missing`);
  return data;
}

async function updateSendingItem(
  id: string,
  patch: Row,
  sb: SB,
  operation: string,
): Promise<void> {
  const { data, error } = await sb
    .from("brokerage_comms_outbox")
    .update(patch)
    .eq("id", id)
    .eq("status", "sending")
    .select("id")
    .maybeSingle();

  assertDbOk(error, operation);
  if (!data) throw new Error(`[comms-outbox] ${operation}: item_not_sending`);
}

// ── Enqueue ─────────────────────────────────────────────────────────────────

export async function enqueueCommsMessage(
  args: EnqueueArgs,
  sb: SB,
): Promise<{ id: string; created: boolean }> {
  // Idempotency: check existing non-terminal item with same key
  const { data: existing, error: lookupError } = await sb
    .from("brokerage_comms_outbox")
    .select("id, status")
    .eq("idempotency_key", args.idempotencyKey)
    .in("status", ["pending", "sending", "retry_scheduled"])
    .limit(1)
    .maybeSingle();

  assertDbOk(lookupError, "enqueue_lookup");
  if (existing) {
    return { id: String(existing.id), created: false };
  }

  const { data: inserted, error: insertError } = await sb
    .from("brokerage_comms_outbox")
    .insert({
      idempotency_key: args.idempotencyKey,
      channel: args.channel,
      provider: args.provider,
      recipient: args.recipient,
      subject: args.subject ?? null,
      body: args.body,
      deal_id: args.dealId ?? null,
      trigger_key: args.triggerKey ?? null,
      status: "pending",
      attempt_count: 0,
      max_attempts: MAX_ATTEMPTS,
      next_attempt_at: now(),
      last_failure_code: null,
      provider_message_id: null,
      created_at: now(),
    })
    .select("id")
    .single();

  const insertedRow = requireRow<Row>(inserted, insertError, "enqueue_insert");
  return { id: String(insertedRow.id), created: true };
}

// ── Claim due items ─────────────────────────────────────────────────────────

export async function claimDueCommsMessages(
  sb: SB,
  limit = 10,
): Promise<OutboxItem[]> {
  const { data, error } = await sb
    .from("brokerage_comms_outbox")
    .select("*")
    .in("status", ["pending", "retry_scheduled", "sending"])
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  assertDbOk(error, "claim_read");

  const items: OutboxItem[] = [];
  const nowMs = Date.now();

  for (const row of (data ?? []) as Row[]) {
    const nextAt = str(row.next_attempt_at);
    if (nextAt && new Date(nextAt).getTime() > nowMs) continue;

    // Compare-and-set the exact row version observed above. For an abandoned
    // "sending" row, next_attempt_at is the lease deadline; comparing it as
    // well as status prevents two reclaimers from both winning.
    const leaseUntil = new Date(nowMs + CLAIM_LEASE_MS).toISOString();
    let claim = sb
      .from("brokerage_comms_outbox")
      .update({ status: "sending", next_attempt_at: leaseUntil })
      .eq("id", row.id)
      .eq("status", row.status);

    claim = nextAt
      ? claim.eq("next_attempt_at", nextAt)
      : claim.is("next_attempt_at", null);

    const { data: claimed, error: claimError } = await claim
      .select("*")
      .maybeSingle();

    assertDbOk(claimError, "claim_update");
    if (!claimed) continue; // another worker changed this row first

    items.push(mapRow(claimed));
  }

  return items;
}

// ── Process single item ─────────────────────────────────────────────────────

export async function processCommsOutboxItem(
  item: OutboxItem,
  adapter: Adapter,
  sb: SB,
): Promise<"sent" | "retry_scheduled" | "exhausted" | "failed" | "skipped"> {
  // Already sent = no-op
  if (item.status === "sent") return "skipped";
  // Only a successfully compare-and-set claimed row may reach a provider.
  if (item.status !== "sending") return "skipped";

  const attempt = item.attemptCount + 1;

  // Ledger: requested
  await recordCommsSendRequested(sb, {
    channel: item.channel,
    recipient: item.recipient,
    dealId: item.dealId ?? undefined,
    triggerKey: item.triggerKey ?? undefined,
  });

  // Send. Adapter exceptions are retryable delivery failures; the row remains
  // durably owned by this claim until the transition below succeeds.
  let result: SendResult;
  try {
    result = await adapter({
      recipient: item.recipient,
      subject: item.subject,
      body: item.body,
    });
  } catch (error: unknown) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : "adapter_threw",
      retryable: true,
    };
  }

  if (result.ok) {
    await markSent(item.id, attempt, result.providerMessageId ?? null, sb);
    await recordCommsSendSucceeded(sb, {
      channel: item.channel,
      recipient: item.recipient,
      dealId: item.dealId ?? undefined,
      triggerKey: item.triggerKey ?? undefined,
      providerMessageId: result.providerMessageId,
    });
    return "sent";
  }

  // Failed — decide retry
  const decision = normalizeSendResultToRetryDecision(result, attempt);

  await recordCommsSendFailed(sb, {
    channel: item.channel,
    recipient: item.recipient,
    dealId: item.dealId ?? undefined,
    triggerKey: item.triggerKey ?? undefined,
    failureCode: decision.failureCode,
    retryable: decision.retryable,
    attemptNumber: attempt,
  });

  if (decision.shouldRetry && decision.nextDelaySec != null) {
    await markRetryScheduled(item.id, attempt, decision.nextDelaySec, decision.failureCode, sb);
    await recordCommsRetryScheduled(sb, {
      channel: item.channel,
      recipient: item.recipient,
      dealId: item.dealId ?? undefined,
      triggerKey: item.triggerKey ?? undefined,
      attemptNumber: attempt,
      nextAttemptDelaySec: decision.nextDelaySec,
    });
    return "retry_scheduled";
  }

  if (decision.exhausted) {
    await markExhausted(item.id, attempt, decision.failureCode, sb);
    await recordCommsRetryExhausted(sb, {
      channel: item.channel,
      recipient: item.recipient,
      dealId: item.dealId ?? undefined,
      triggerKey: item.triggerKey ?? undefined,
      totalAttempts: attempt,
      lastFailureCode: decision.failureCode,
    });

    // Phase 12B: escalate exhausted borrower nudges to banker
    if (isBorrowerNudgeTrigger(item.triggerKey) && item.dealId) {
      void fireNudgeEscalation(item.dealId, "borrower_nudge_exhausted", sb);
    }

    return "exhausted";
  }

  // Non-retryable failure
  await updateSendingItem(
    item.id,
    { status: "failed", attempt_count: attempt, last_failure_code: decision.failureCode },
    sb,
    "mark_failed",
  );

  // Phase 12B: escalate failed borrower nudges to banker
  if (isBorrowerNudgeTrigger(item.triggerKey) && item.dealId) {
    void fireNudgeEscalation(item.dealId, "borrower_nudge_failed", sb);
  }

  return "failed";
}

// ── Status transitions ──────────────────────────────────────────────────────

export async function markSent(id: string, attempt: number, providerMessageId: string | null, sb: SB): Promise<void> {
  await updateSendingItem(
    id,
    { status: "sent", provider_message_id: providerMessageId, attempt_count: attempt, next_attempt_at: null },
    sb,
    "mark_sent",
  );
}

export async function markRetryScheduled(id: string, attempt: number, delaySec: number, failureCode: string, sb: SB): Promise<void> {
  const nextAt = new Date(Date.now() + delaySec * 1000).toISOString();
  await updateSendingItem(
    id,
    { status: "retry_scheduled", attempt_count: attempt, next_attempt_at: nextAt, last_failure_code: failureCode },
    sb,
    "mark_retry_scheduled",
  );
}

export async function markExhausted(id: string, attempt: number, failureCode: string, sb: SB): Promise<void> {
  await updateSendingItem(
    id,
    { status: "exhausted", attempt_count: attempt, next_attempt_at: null, last_failure_code: failureCode },
    sb,
    "mark_exhausted",
  );
}

// ── Batch processor ─────────────────────────────────────────────────────────

export async function processDueCommsOutbox(
  sb: SB,
  adapterFactory: (channel: "email" | "sms" | "slack") => Adapter,
  limit = 10,
): Promise<ProcessResult> {
  const items = await claimDueCommsMessages(sb, limit);
  let sent = 0, retried = 0, exhausted = 0, failed = 0;

  for (const item of items) {
    const adapter = adapterFactory(item.channel);
    const outcome = await processCommsOutboxItem(item, adapter, sb);
    if (outcome === "sent") sent++;
    else if (outcome === "retry_scheduled") retried++;
    else if (outcome === "exhausted") exhausted++;
    else if (outcome === "failed") failed++;
  }

  return { processed: items.length, sent, retried, exhausted, failed };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// ── Phase 12B: nudge escalation helpers ────────────────────────────────────

const BORROWER_NUDGE_TRIGGERS = new Set(["missing_documents"]);

function isBorrowerNudgeTrigger(triggerKey: string | null): boolean {
  return triggerKey != null && BORROWER_NUDGE_TRIGGERS.has(triggerKey);
}

async function fireNudgeEscalation(
  dealId: string,
  event: "borrower_nudge_failed" | "borrower_nudge_exhausted",
  sb: SB,
): Promise<void> {
  try {
    const { handleLifecycleHook } = await import("@/lib/brokerage/commsLifecycleHooks");
    await handleLifecycleHook({ dealId, event }, sb);
  } catch {
    // Fire-and-forget — must never break outbox processing
  }
}

function mapRow(row: Row): OutboxItem {
  return {
    id: String(row.id),
    idempotencyKey: str(row.idempotency_key) ?? "",
    channel: (str(row.channel) ?? "email") as OutboxItem["channel"],
    provider: (str(row.provider) ?? "resend") as OutboxItem["provider"],
    recipient: str(row.recipient) ?? "",
    subject: str(row.subject),
    body: str(row.body) ?? "",
    dealId: str(row.deal_id),
    triggerKey: str(row.trigger_key),
    status: (str(row.status) ?? "pending") as OutboxStatus,
    attemptCount: row.attempt_count ?? 0,
    maxAttempts: row.max_attempts ?? MAX_ATTEMPTS,
    nextAttemptAt: str(row.next_attempt_at),
    lastFailureCode: str(row.last_failure_code),
    providerMessageId: str(row.provider_message_id),
  };
}
