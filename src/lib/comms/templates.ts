import "server-only";

/**
 * CRM message templates — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR4 §6.2.
 *
 * A real merge-field renderer (`{{field}}` interpolation) — discovery
 * confirmed no such engine exists anywhere in this codebase; the existing
 * brokerage_borrower_message_templates system stores static bodies per
 * trigger with no field interpolation. This is deliberately simple
 * (literal `{{key}}` substitution, no conditionals/loops) rather than a
 * full templating language, matching the scope actually needed here.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";

export const TEMPLATE_TRIGGER_KEYS = [
  "initial_lead_response",
  "discovery_scheduling",
  "document_request",
  "engagement_follow_up",
  "incomplete_application",
  "lender_introduction",
  "lender_submission",
  "submission_follow_up",
  "underwriting_condition_request",
  "closing_coordination",
  "referral_acknowledgment",
  "funding_notification",
  "referral_thank_you",
] as const;

export type TemplateTriggerKey = (typeof TEMPLATE_TRIGGER_KEYS)[number];

export type MessageTemplate = {
  id: string;
  bank_id: string;
  trigger_key: string;
  channel: "email" | "sms";
  subject: string | null;
  body: string;
  active: boolean;
  version: number;
};

export async function getTemplate(bankId: string, triggerKey: string, channel: "email" | "sms", sb: SB = supabaseAdmin()): Promise<MessageTemplate | null> {
  const { data, error } = await sb
    .from("crm_message_templates")
    .select("*")
    .eq("bank_id", bankId)
    .eq("trigger_key", triggerKey)
    .eq("channel", channel)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`getTemplate failed: ${error.message}`);
  return (data as MessageTemplate) ?? null;
}

export async function listTemplates(bankId: string, sb: SB = supabaseAdmin()): Promise<MessageTemplate[]> {
  const { data, error } = await sb.from("crm_message_templates").select("*").eq("bank_id", bankId).order("trigger_key", { ascending: true });
  if (error) throw new Error(`listTemplates failed: ${error.message}`);
  return (data ?? []) as MessageTemplate[];
}

export type UpsertTemplateInput = {
  bankId: string;
  triggerKey: string;
  channel: "email" | "sms";
  subject?: string | null;
  body: string;
  active?: boolean;
};

export async function upsertTemplate(input: UpsertTemplateInput, sb: SB = supabaseAdmin()): Promise<MessageTemplate> {
  const existing = await getTemplate(input.bankId, input.triggerKey, input.channel, sb);
  if (existing) {
    const { data, error } = await sb
      .from("crm_message_templates")
      .update({ subject: input.subject ?? null, body: input.body, active: input.active ?? true, version: existing.version + 1, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(`upsertTemplate update failed: ${error.message}`);
    return data as MessageTemplate;
  }
  const { data, error } = await sb
    .from("crm_message_templates")
    .insert({ bank_id: input.bankId, trigger_key: input.triggerKey, channel: input.channel, subject: input.subject ?? null, body: input.body, active: input.active ?? true })
    .select("*")
    .single();
  if (error) throw new Error(`upsertTemplate insert failed: ${error.message}`);
  return data as MessageTemplate;
}

/** Literal {{key}} substitution — unknown keys are left as-is rather than silently blanked, so a typo is visible instead of hidden. */
export function renderTemplate(text: string, fields: Record<string, string | null | undefined>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = fields[key];
    return value != null && value !== "" ? value : match;
  });
}
