import "server-only";

/**
 * Do-not-contact enforcement — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR4.
 *
 * Discovery found crm_people.do_not_contact (added PR1) was a stored flag
 * nobody ever checked before this. This is the single gate every send
 * path in this PR goes through — independent of and in addition to
 * src/lib/sms/consent.ts's phone-number-level opt-out (that's Twilio-layer
 * STOP/START compliance; this is the CRM's own relationship-level flag).
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";

export class DoNotContactError extends Error {
  constructor(entityType: string) {
    super(`Contact is not allowed: ${entityType} is flagged do-not-contact.`);
    this.name = "DoNotContactError";
  }
}

export async function assertPersonContactAllowed(bankId: string, personId: string, sb: SB = supabaseAdmin()): Promise<void> {
  const { data, error } = await sb
    .from("crm_people")
    .select("do_not_contact, contact_status")
    .eq("id", personId)
    .eq("bank_id", bankId)
    .maybeSingle();
  if (error) throw new Error(`assertPersonContactAllowed lookup failed: ${error.message}`);
  if (!data) return; // Unknown person — nothing to block against; caller's FK will fail downstream if truly missing.
  if (data.do_not_contact || data.contact_status === "do_not_contact") {
    throw new DoNotContactError("person");
  }
}

export async function assertLeadContactAllowed(bankId: string, leadId: string, sb: SB = supabaseAdmin()): Promise<void> {
  const { data, error } = await sb
    .from("brokerage_leads")
    .select("do_not_contact")
    .eq("id", leadId)
    .eq("bank_id", bankId)
    .maybeSingle();
  if (error) throw new Error(`assertLeadContactAllowed lookup failed: ${error.message}`);
  if (!data) return;
  if (data.do_not_contact) {
    throw new DoNotContactError("lead");
  }
}
