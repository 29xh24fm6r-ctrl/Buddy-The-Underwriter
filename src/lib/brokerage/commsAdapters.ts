/**
 * Phase 11B — Real Communications Adapters
 *
 * Email: Resend
 * SMS: Telnyx
 * Slack: Webhook (optional, ops only)
 *
 * BROKERAGE_COMMS_MODE: stub | dry_run | live
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type CommsMode = "stub" | "dry_run" | "live";

export type SendResult = {
  ok: boolean;
  error?: string;
  providerMessageId?: string;
  retryable?: boolean;
};

export type CommsAdapters = {
  email: (msg: { recipient: string; subject: string | null; body: string }) => Promise<SendResult>;
  sms: (msg: { recipient: string; body: string }) => Promise<SendResult>;
  slack: (msg: { body: string }) => Promise<SendResult>;
};

export type CommsEnvStatus = {
  mode: CommsMode;
  resendReady: boolean;
  telnyxReady: boolean;
  slackReady: boolean;
  issues: string[];
};

// ── Secrets redaction ───────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /re_[A-Za-z0-9_-]{10,}/g,           // Resend keys
  /KEY[A-Za-z0-9_-]{20,}/g,           // Telnyx keys
  /xoxb-[A-Za-z0-9-]+/g,             // Slack tokens
  /Bearer\s+[A-Za-z0-9_.-]+/gi,      // Bearer tokens
];

export function redactCommsSecrets(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  // Also redact known env var values if present
  for (const key of ["RESEND_API_KEY", "TELNYX_API_KEY", "SLACK_WEBHOOK_URL"]) {
    const val = process.env[key];
    if (val && val.length > 8 && result.includes(val)) {
      result = result.replace(new RegExp(val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[REDACTED]");
    }
  }
  return result;
}

// ── E.164 validation ────────────────────────────────────────────────────────

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export function isValidE164(phone: string): boolean {
  return E164_REGEX.test(phone);
}

// ── Env check ───────────────────────────────────────────────────────────────

export function getCommsMode(): CommsMode {
  const mode = process.env.BROKERAGE_COMMS_MODE;
  if (mode === "live" || mode === "dry_run" || mode === "stub") return mode;
  return "stub";
}

export function assertCommsEnvReady(): CommsEnvStatus {
  const mode = getCommsMode();
  const issues: string[] = [];
  const resendReady = Boolean(process.env.RESEND_API_KEY && process.env.BROKERAGE_FROM_EMAIL);
  const telnyxReady = Boolean(process.env.TELNYX_API_KEY && process.env.TELNYX_FROM_NUMBER);
  const slackReady = Boolean(process.env.SLACK_WEBHOOK_URL);

  if (mode === "live") {
    if (!resendReady) issues.push("RESEND_API_KEY or BROKERAGE_FROM_EMAIL missing (critical in live mode)");
    if (!telnyxReady) issues.push("TELNYX_API_KEY or TELNYX_FROM_NUMBER missing (critical in live mode)");
  } else {
    if (!resendReady) issues.push("RESEND_API_KEY not set (warning in stub/dry_run)");
    if (!telnyxReady) issues.push("TELNYX_API_KEY not set (warning in stub/dry_run)");
  }

  return { mode, resendReady, telnyxReady, slackReady, issues };
}

// ── Resend email adapter ────────────────────────────────────────────────────

export function createEmailAdapter(): CommsAdapters["email"] {
  const mode = getCommsMode();
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BROKERAGE_FROM_EMAIL ?? "noreply@buddysba.com";

  return async (msg) => {
    if (mode === "stub") return { ok: true, providerMessageId: `stub-email-${Date.now()}` };
    if (mode === "dry_run") return { ok: true, providerMessageId: `dry-email-${Date.now()}` };

    if (!apiKey) return { ok: false, error: "RESEND_API_KEY not configured", retryable: false };

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [msg.recipient], subject: msg.subject ?? "Buddy SBA Notification", text: msg.body }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: true, providerMessageId: data.id ?? undefined };
      }

      const status = res.status;
      const retryable = status === 429 || status >= 500;
      return { ok: false, error: redactCommsSecrets(`Resend ${status}`), retryable };
    } catch (err: any) {
      return { ok: false, error: redactCommsSecrets(err?.message ?? "email_send_failed"), retryable: true };
    }
  };
}

// ── Telnyx SMS adapter ──────────────────────────────────────────────────────

export function createTelnyxSmsAdapter(): CommsAdapters["sms"] {
  const mode = getCommsMode();
  const apiKey = process.env.TELNYX_API_KEY;
  const fromNumber = process.env.TELNYX_FROM_NUMBER;
  const profileId = process.env.TELNYX_MESSAGING_PROFILE_ID;

  return async (msg) => {
    if (mode === "stub") return { ok: true, providerMessageId: `stub-sms-${Date.now()}` };
    if (mode === "dry_run") return { ok: true, providerMessageId: `dry-sms-${Date.now()}` };

    if (!apiKey || !fromNumber) return { ok: false, error: "TELNYX_API_KEY or TELNYX_FROM_NUMBER not configured", retryable: false };
    if (!isValidE164(msg.recipient)) return { ok: false, error: `Invalid E.164 phone: ${msg.recipient}`, retryable: false };

    try {
      const payload: Record<string, any> = { from: fromNumber, to: msg.recipient, text: msg.body };
      if (profileId) payload.messaging_profile_id = profileId;

      const res = await fetch("https://api.telnyx.com/v2/messages", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok || res.status === 202) {
        const data = await res.json().catch(() => ({}));
        const msgId = data?.data?.id ?? data?.id ?? undefined;
        return { ok: true, providerMessageId: msgId };
      }

      const status = res.status;
      const retryable = status === 429 || status >= 500;
      return { ok: false, error: redactCommsSecrets(`Telnyx ${status}`), retryable };
    } catch (err: any) {
      return { ok: false, error: redactCommsSecrets(err?.message ?? "sms_send_failed"), retryable: true };
    }
  };
}

// ── Slack adapter ───────────────────────────────────────────────────────────

export function createSlackAdapter(): CommsAdapters["slack"] {
  const mode = getCommsMode();
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  return async (msg) => {
    if (mode === "stub") return { ok: true, providerMessageId: `stub-slack-${Date.now()}` };
    if (mode === "dry_run") return { ok: true, providerMessageId: `dry-slack-${Date.now()}` };
    if (!webhookUrl) return { ok: true }; // Slack is optional — silently succeed if not configured

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg.body }),
      });
      return { ok: res.ok, error: res.ok ? undefined : `Slack ${res.status}` };
    } catch (err: any) {
      return { ok: false, error: redactCommsSecrets(err?.message ?? "slack_send_failed"), retryable: true };
    }
  };
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createBrokerageCommsAdaptersFromEnv(): CommsAdapters {
  return {
    email: createEmailAdapter(),
    sms: createTelnyxSmsAdapter(),
    slack: createSlackAdapter(),
  };
}

/**
 * Channel-aware adapter factory for processDueCommsOutbox / lender comms.
 * Single source of the (channel) → adapter mapping so the outbox-process route,
 * the comms orchestrator, and the lender comms cycle all send through the same
 * env-mode-resolved adapters (audit M3 — no more divergent stub vs real senders).
 * Honors BROKERAGE_COMMS_MODE (stub | dry_run | live) — it is NOT a hardcoded stub.
 */
export function buildOutboxAdapterFactory(
  adapters: CommsAdapters = createBrokerageCommsAdaptersFromEnv(),
): (channel: "email" | "sms" | "slack") => (msg: any) => Promise<SendResult> {
  return (channel) => {
    if (channel === "sms") return (msg: any) => adapters.sms(msg);
    if (channel === "slack") return (msg: any) => adapters.slack(msg);
    return (msg: any) => adapters.email(msg);
  };
}
