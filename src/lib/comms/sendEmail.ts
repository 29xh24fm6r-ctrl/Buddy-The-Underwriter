import "server-only";

/**
 * CRM email sending — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR4 §6.2.
 *
 * Wired to the existing, already-honest Resend provider
 * (src/lib/email/getProvider.ts) rather than the separate, more dormant
 * commsAdapters.ts stack — that provider already does exactly what the
 * spec asks for: a real send when RESEND_API_KEY is configured, an
 * explicit stub (never a fake "sent") when it isn't. This module adds
 * nothing to that honesty contract; it only adds the CRM-side logging.
 *
 * "Do not claim open tracking unless a provider event confirms it" (§6.2):
 * no Resend webhook exists in this codebase, so delivery_state here is
 * only ever "sent" (provider accepted it) or "stub" (never left this
 * server) — never "delivered"/"opened", which would be fabricated.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import { getEmailProvider } from "@/lib/email/getProvider";
import { resolveEnvFallbackEmailRouting } from "@/lib/email/env";
import { assertPersonContactAllowed, assertLeadContactAllowed } from "./doNotContact";
import { logActivity, type ActivityRow } from "./activities";
import { getTemplate, renderTemplate, type TemplateTriggerKey } from "./templates";

const DEFAULT_FROM = "Buddy Brokerage <no-reply@usebuddy.com>";

export type SendCrmEmailInput = {
  bankId: string;
  to: string;
  dealId?: string | null;
  organizationId?: string | null;
  personId?: string | null;
  leadId?: string | null;
  participantPersonIds?: string[];
  subject: string;
  body: string;
  followUpRequired?: boolean;
  followUpDueAt?: string | null;
  actorClerkUserId?: string | null;
  source?: "manual" | "automated";
};

export type SendCrmEmailResult = {
  activity: ActivityRow;
  provider: string;
  providerMessageId: string | null;
};

export async function sendCrmEmail(input: SendCrmEmailInput, sb: SB = supabaseAdmin()): Promise<SendCrmEmailResult> {
  if (input.personId) await assertPersonContactAllowed(input.bankId, input.personId, sb);
  if (input.leadId) await assertLeadContactAllowed(input.bankId, input.leadId, sb);

  const routing = resolveEnvFallbackEmailRouting();
  const from = routing.from?.value ?? DEFAULT_FROM;

  const provider = getEmailProvider();
  const result = await provider.send({ to: input.to, from, subject: input.subject, text: input.body });

  const activity = await logActivity(
    {
      bankId: input.bankId,
      kind: "email",
      channel: "email",
      direction: "outbound",
      title: input.subject,
      dealId: input.dealId,
      organizationId: input.organizationId,
      personId: input.personId,
      leadId: input.leadId,
      participantPersonIds: input.participantPersonIds,
      followUpRequired: input.followUpRequired ?? false,
      followUpDueAt: input.followUpDueAt ?? null,
      externalMessageId: result.provider_message_id,
      provider: result.provider,
      deliveryState: result.provider === "stub" ? "stub" : "sent",
      source: input.source ?? "manual",
      actorClerkUserId: input.actorClerkUserId ?? null,
      properties: { to: input.to, body: input.body },
    },
    sb,
  );

  return { activity, provider: result.provider, providerMessageId: result.provider_message_id };
}

export type SendCrmTemplateEmailInput = Omit<SendCrmEmailInput, "subject" | "body"> & {
  triggerKey: TemplateTriggerKey;
  mergeFields?: Record<string, string | null | undefined>;
};

export async function sendCrmTemplateEmail(input: SendCrmTemplateEmailInput, sb: SB = supabaseAdmin()): Promise<SendCrmEmailResult> {
  const template = await getTemplate(input.bankId, input.triggerKey, "email", sb);
  if (!template) throw new Error(`No active email template found for trigger '${input.triggerKey}'.`);

  const fields = input.mergeFields ?? {};
  const subject = renderTemplate(template.subject ?? "", fields);
  const body = renderTemplate(template.body, fields);

  return sendCrmEmail({ ...input, subject, body }, sb);
}
