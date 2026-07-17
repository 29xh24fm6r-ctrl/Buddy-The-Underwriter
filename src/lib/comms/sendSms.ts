import "server-only";

/**
 * CRM SMS sending — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR4 §6.4.
 *
 * Wired to sendSmsWithConsent (src/lib/sms/send.ts) — "the ONLY function
 * that should send SMS in Buddy" per its own docstring, real Twilio call,
 * throws (never simulates) when unconfigured, and independently enforces
 * phone-number-level opt-out via src/lib/sms/consent.ts. A failed attempt
 * (unconfigured provider, opted-out number) is still logged to the
 * timeline with delivery_state='failed' — an honest record of what was
 * tried, not a pretense that something was delivered.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import { sendSmsWithConsent } from "@/lib/sms/send";
import { assertPersonContactAllowed, assertLeadContactAllowed } from "./doNotContact";
import { logActivity, type ActivityRow } from "./activities";
import { getTemplate, renderTemplate, type TemplateTriggerKey } from "./templates";

export type SendCrmSmsInput = {
  bankId: string;
  to: string;
  dealId?: string | null;
  organizationId?: string | null;
  personId?: string | null;
  leadId?: string | null;
  body: string;
  actorClerkUserId?: string | null;
  source?: "manual" | "automated";
};

export type SendCrmSmsResult = {
  activity: ActivityRow;
  sid: string;
  status: string;
};

export async function sendCrmSms(input: SendCrmSmsInput, sb: SB = supabaseAdmin()): Promise<SendCrmSmsResult> {
  if (input.personId) await assertPersonContactAllowed(input.bankId, input.personId, sb);
  if (input.leadId) await assertLeadContactAllowed(input.bankId, input.leadId, sb);

  try {
    const result = await sendSmsWithConsent({ dealId: input.dealId ?? null, to: input.to, body: input.body, label: "CRM SMS" });

    const activity = await logActivity(
      {
        bankId: input.bankId,
        kind: "sms",
        channel: "sms",
        direction: "outbound",
        title: "SMS sent",
        dealId: input.dealId,
        organizationId: input.organizationId,
        personId: input.personId,
        leadId: input.leadId,
        externalMessageId: result.sid,
        provider: "twilio",
        deliveryState: "sent",
        source: input.source ?? "manual",
        actorClerkUserId: input.actorClerkUserId ?? null,
        properties: { to: input.to, body: input.body, twilioStatus: result.status },
      },
      sb,
    );

    return { activity, sid: result.sid, status: result.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logActivity(
      {
        bankId: input.bankId,
        kind: "sms",
        channel: "sms",
        direction: "outbound",
        title: "SMS send failed",
        dealId: input.dealId,
        organizationId: input.organizationId,
        personId: input.personId,
        leadId: input.leadId,
        outcome: msg,
        deliveryState: "failed",
        source: input.source ?? "manual",
        actorClerkUserId: input.actorClerkUserId ?? null,
        properties: { to: input.to, body: input.body, error: msg },
      },
      sb,
    ).catch(() => {});
    throw e;
  }
}

export type SendCrmTemplateSmsInput = Omit<SendCrmSmsInput, "body"> & {
  triggerKey: TemplateTriggerKey;
  mergeFields?: Record<string, string | null | undefined>;
};

export async function sendCrmTemplateSms(input: SendCrmTemplateSmsInput, sb: SB = supabaseAdmin()): Promise<SendCrmSmsResult> {
  const template = await getTemplate(input.bankId, input.triggerKey, "sms", sb);
  if (!template) throw new Error(`No active SMS template found for trigger '${input.triggerKey}'.`);

  const body = renderTemplate(template.body, input.mergeFields ?? {});
  return sendCrmSms({ ...input, body }, sb);
}
