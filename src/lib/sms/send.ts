import "server-only";
// NOTE: Twilio depends on Node core modules (net/tls/crypto). This module must never execute in Edge runtime.
import { assertSmsAllowed } from "@/lib/sms/consent";
import { resolveCommsMode } from "@/lib/brokerage/commsMode";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export class SmsDeliveryAuditError extends Error {
  readonly code = "SMS_AUDIT_PERSISTENCE_FAILED";
  readonly dispatched = true;

  constructor(readonly failedStores: string[]) {
    super("SMS dispatched but delivery audit persistence failed");
    this.name = "SmsDeliveryAuditError";
  }
}

/**
 * Send SMS with opt-out enforcement and automatic ledger logging
 *
 * This is the ONLY function that should send SMS in Buddy.
 * All banker sends + reminders should use this.
 *
 * Features:
 * - Honours BROKERAGE_COMMS_MODE (stub / dry_run / live)
 * - Checks opt-out status before sending
 * - Logs to outbound_messages table
 * - Logs to deal_events (if deal_id provided)
 * - Throws if opted out
 *
 * SPEC-SEC-SMS-KILLSWITCH-1: this Twilio path used to ignore
 * BROKERAGE_COMMS_MODE entirely, so setting the mode to "stub" silenced the
 * Telnyx/Resend brokerage comms while this path kept sending real messages
 * from the platform's Twilio number. One switch must stop all outbound, or
 * the switch is not a kill switch. In stub/dry_run the send is recorded and
 * skipped rather than dispatched.
 */
export async function sendSmsWithConsent(args: {
  dealId?: string | null;
  to: string;
  body: string;
  label?: string;
  metadata?: Record<string, any>;
}): Promise<{ sid: string; status: string }> {
  const { dealId, to, body, label = "SMS", metadata = {} } = args;

  // 1. Enforce opt-out
  await assertSmsAllowed(to);

  // 1b. Global outbound kill switch. Unset resolves to "stub" (safe default);
  // an unrecognised value throws from resolveCommsMode rather than silently
  // picking a mode nobody chose.
  const commsMode = resolveCommsMode();
  if (commsMode !== "live") {
    console.log("[sendSmsWithConsent] suppressed by BROKERAGE_COMMS_MODE", {
      mode: commsMode,
      label,
      dealId: dealId ?? null,
      bodyChars: body.length,
    });
    await logSmsSuppressed({ dealId, label, to, mode: commsMode });
    return { sid: `suppressed_${commsMode}`, status: "suppressed" };
  }

  // 2. Send via Twilio
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) {
    await logSmsFailure({
      dealId,
      label,
      error: "Twilio not configured (missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_FROM_NUMBER)",
      reason: "missing_env",
    });
    throw new Error("Twilio not configured (missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_FROM_NUMBER)");
  }

  const { default: Twilio } = await import("twilio");

  const twilio = Twilio(accountSid, authToken);
  let message: { sid: string; status: string };
  try {
    message = await twilio.messages.create({
      to,
      from,
      body,
    });
  } catch (error: any) {
    await logSmsFailure({
      dealId,
      label,
      error: error?.message ?? String(error),
      reason: "send_failed",
    });
    throw error;
  }

  const sb = supabaseAdmin();
  const persistenceFailures: string[] = [];

  // 3. Persist delivery tracking and require returned-row proof. This runs
  // after Twilio dispatch, so failure is an explicit uncertain outcome rather
  // than a false success.
  const { data: outboundRow, error: outboundErr } = await sb
    .from("outbound_messages")
    .insert({
      deal_id: dealId ?? null,
      channel: "sms",
      to_value: to,
      body,
      status: "sent",
      provider: "twilio",
      provider_message_id: message.sid,
      sent_at: new Date().toISOString(),
    })
    .select("id, provider_message_id, status")
    .single();

  if (
    outboundErr ||
    !outboundRow ||
    outboundRow.provider_message_id !== message.sid ||
    outboundRow.status !== "sent"
  ) {
    console.error("outbound_messages persistence proof failed:", outboundErr ?? {
      returned: Boolean(outboundRow),
      sidMatches: outboundRow?.provider_message_id === message.sid,
      statusMatches: outboundRow?.status === "sent",
    });
    persistenceFailures.push("outbound_messages");
  }

  // 4. Persist the deal timeline event and require returned-row proof.
  // Attempt this even if outbound_messages failed so the reconciled reminder
  // ledger retains the provider SID whenever either canonical store is live.
  if (dealId) {
    const eventPayload = {
      to,
      body,
      label,
      sid: message.sid,
      status: message.status,
      ...metadata,
    };

    const { data: eventRow, error: eventErr } = await sb
      .from("deal_events")
      .insert({
        deal_id: dealId,
        kind: "sms_outbound",
        payload: eventPayload,
      })
      .select("id, deal_id, kind, payload")
      .single();

    const returnedPayload =
      eventRow?.payload && typeof eventRow.payload === "object"
        ? (eventRow.payload as Record<string, unknown>)
        : null;

    if (
      eventErr ||
      !eventRow ||
      eventRow.deal_id !== dealId ||
      eventRow.kind !== "sms_outbound" ||
      returnedPayload?.sid !== message.sid ||
      returnedPayload?.label !== label
    ) {
      console.error("deal_events persistence proof failed:", eventErr ?? {
        returned: Boolean(eventRow),
        dealMatches: eventRow?.deal_id === dealId,
        kindMatches: eventRow?.kind === "sms_outbound",
        sidMatches: returnedPayload?.sid === message.sid,
        labelMatches: returnedPayload?.label === label,
      });
      persistenceFailures.push("deal_events");
    }
  }

  if (persistenceFailures.length > 0) {
    throw new SmsDeliveryAuditError(persistenceFailures);
  }

  return {
    sid: message.sid,
    status: message.status,
  };
}

/**
 * Records an SMS that was intentionally not dispatched because
 * BROKERAGE_COMMS_MODE is not "live". Distinct event key from
 * sms.send.failed — this is a policy decision, not a failure, and it must not
 * pollute failure alerting.
 */
async function logSmsSuppressed(args: {
  dealId?: string | null;
  label: string;
  to: string;
  mode: string;
}) {
  const { dealId, label, to, mode } = args;
  if (!dealId) return;

  try {
    const sb = supabaseAdmin();
    const { data: deal } = await sb
      .from("deals")
      .select("bank_id")
      .eq("id", dealId)
      .maybeSingle();

    const bankId = (deal as any)?.bank_id || null;
    if (!bankId) return;

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "sms.send.suppressed",
      uiState: "done",
      uiMessage: `SMS suppressed (comms mode: ${mode})`,
      // Last 4 digits only — the full number is PII and this ledger is
      // read by ops surfaces.
      meta: { label, mode, to_last4: to.slice(-4) },
    });
  } catch (e: any) {
    console.warn("[sms] failed to log suppression event", {
      dealId,
      error: e?.message ?? String(e),
    });
  }
}

async function logSmsFailure(args: {
  dealId?: string | null;
  label: string;
  error: string;
  reason: string;
}) {
  const { dealId, label, error, reason } = args;
  if (!dealId) return;

  try {
    const sb = supabaseAdmin();
    const { data: deal } = await sb
      .from("deals")
      .select("bank_id")
      .eq("id", dealId)
      .maybeSingle();

    const bankId = (deal as any)?.bank_id || null;
    if (!bankId) return;

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "sms.send.failed",
      uiState: "done",
      uiMessage: "SMS send failed",
      meta: {
        label,
        reason,
        error,
      },
    });
  } catch (e: any) {
    console.warn("[sms] failed to log pipeline event", {
      dealId,
      error: e?.message ?? String(e),
    });
  }
}
