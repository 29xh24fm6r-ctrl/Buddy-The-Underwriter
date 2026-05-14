/**
 * Phase 11C — Comms Event Ledger
 *
 * Auditable record of every communication send attempt.
 * Never stores API keys or webhook URLs.
 * Recipients masked for PII safety.
 */

export type CommsEventType =
  | "brokerage_comms_send_requested"
  | "brokerage_comms_send_succeeded"
  | "brokerage_comms_send_failed"
  | "brokerage_comms_retry_scheduled"
  | "brokerage_comms_retry_exhausted";

export type CommsLedgerEntry = {
  eventType: CommsEventType;
  channel: "email" | "sms" | "slack";
  dealId?: string;
  recipient: string; // masked
  triggerKey?: string;
  providerMessageId?: string;
  retryable?: boolean;
  failureCode?: string;
  attemptNumber?: number;
  metadata?: Record<string, any>;
};

type SB = { from: (t: string) => any };

// ── Masking ─────────────────────────────────────────────────────────────────

export function maskEmail(email: string): string {
  const parts = email.split("@");
  if (parts.length !== 2) return "***@***";
  const local = parts[0];
  const domain = parts[1];
  const masked = local.length <= 2
    ? "*".repeat(local.length)
    : local[0] + "*".repeat(local.length - 2) + local[local.length - 1];
  return `${masked}@${domain}`;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 4) return "****";
  return "*".repeat(phone.length - 4) + phone.slice(-4);
}

export function maskRecipient(recipient: string, channel: "email" | "sms" | "slack"): string {
  if (channel === "email") return maskEmail(recipient);
  if (channel === "sms") return maskPhone(recipient);
  return recipient; // slack = webhook, no PII
}

// ── Secret scrubbing ────────────────────────────────────────────────────────

const SECRET_PATTERNS = /RESEND_API_KEY|TELNYX_API_KEY|SLACK_WEBHOOK_URL|Bearer\s+\S+|re_[A-Za-z0-9_-]{10,}|KEY[A-Za-z0-9_-]{20,}/gi;

export function scrubSecrets(text: string): string {
  return text.replace(SECRET_PATTERNS, "[REDACTED]");
}

// ── Ledger writers ──────────────────────────────────────────────────────────

async function writeEvent(sb: SB, entry: CommsLedgerEntry): Promise<void> {
  await sb.from("brokerage_comms_ledger").insert({
    event_type: entry.eventType,
    channel: entry.channel,
    deal_id: entry.dealId ?? null,
    recipient_masked: entry.recipient,
    trigger_key: entry.triggerKey ?? null,
    provider_message_id: entry.providerMessageId ?? null,
    retryable: entry.retryable ?? null,
    failure_code: entry.failureCode ? scrubSecrets(entry.failureCode) : null,
    attempt_number: entry.attemptNumber ?? null,
    metadata: entry.metadata ?? {},
    created_at: new Date().toISOString(),
  });
}

export async function recordCommsSendRequested(
  sb: SB,
  args: { channel: "email" | "sms" | "slack"; recipient: string; dealId?: string; triggerKey?: string },
): Promise<void> {
  await writeEvent(sb, {
    eventType: "brokerage_comms_send_requested",
    channel: args.channel,
    dealId: args.dealId,
    recipient: maskRecipient(args.recipient, args.channel),
    triggerKey: args.triggerKey,
  });
}

export async function recordCommsSendSucceeded(
  sb: SB,
  args: { channel: "email" | "sms" | "slack"; recipient: string; dealId?: string; triggerKey?: string; providerMessageId?: string },
): Promise<void> {
  await writeEvent(sb, {
    eventType: "brokerage_comms_send_succeeded",
    channel: args.channel,
    dealId: args.dealId,
    recipient: maskRecipient(args.recipient, args.channel),
    triggerKey: args.triggerKey,
    providerMessageId: args.providerMessageId,
  });
}

export async function recordCommsSendFailed(
  sb: SB,
  args: { channel: "email" | "sms" | "slack"; recipient: string; dealId?: string; triggerKey?: string; failureCode: string; retryable: boolean; attemptNumber?: number },
): Promise<void> {
  await writeEvent(sb, {
    eventType: "brokerage_comms_send_failed",
    channel: args.channel,
    dealId: args.dealId,
    recipient: maskRecipient(args.recipient, args.channel),
    triggerKey: args.triggerKey,
    failureCode: args.failureCode,
    retryable: args.retryable,
    attemptNumber: args.attemptNumber,
  });
}

export async function recordCommsRetryScheduled(
  sb: SB,
  args: { channel: "email" | "sms" | "slack"; recipient: string; dealId?: string; triggerKey?: string; attemptNumber: number; nextAttemptDelaySec: number },
): Promise<void> {
  await writeEvent(sb, {
    eventType: "brokerage_comms_retry_scheduled",
    channel: args.channel,
    dealId: args.dealId,
    recipient: maskRecipient(args.recipient, args.channel),
    triggerKey: args.triggerKey,
    attemptNumber: args.attemptNumber,
    retryable: true,
    metadata: { nextAttemptDelaySec: args.nextAttemptDelaySec },
  });
}

export async function recordCommsRetryExhausted(
  sb: SB,
  args: { channel: "email" | "sms" | "slack"; recipient: string; dealId?: string; triggerKey?: string; totalAttempts: number; lastFailureCode: string },
): Promise<void> {
  await writeEvent(sb, {
    eventType: "brokerage_comms_retry_exhausted",
    channel: args.channel,
    dealId: args.dealId,
    recipient: maskRecipient(args.recipient, args.channel),
    triggerKey: args.triggerKey,
    retryable: false,
    attemptNumber: args.totalAttempts,
    failureCode: args.lastFailureCode,
  });
}
