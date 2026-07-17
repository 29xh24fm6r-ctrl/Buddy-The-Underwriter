import "server-only";

/**
 * Automation triggers — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR4 §6.5.
 *
 * Each trigger is a pure, deterministic finder (same "find" half of the
 * find/act split used by src/lib/jobs/*OverdueChecker.ts) over signals
 * this codebase already tracks — reused, not reinvented. Implemented:
 * lead_stale (PR2's SLA calc), task_overdue, document_missing,
 * lender_response_missing, condition_overdue, referral_relationship_stale
 * (crm_people.last_contacted_at, added PR1). Not implemented: several
 * spec-listed triggers (financial_analysis_ready, document_received,
 * commitment_received, closing_scheduled, deal_funded) have no reliable
 * "just changed" signal in this codebase's current schema — they're
 * point-in-time state changes, not queryable "still true" conditions a
 * poll can detect without an event log this PR doesn't have. Left for a
 * future PR once deal-level lifecycle events are logged; not faked here.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import { computeLeadSlaState } from "@/lib/leads/sla";

export type TriggerFinding = {
  entityType: "lead" | "deal" | "task" | "person";
  entityId: string;
  dedupeKey: string;
  context: Record<string, unknown>;
};

export async function findLeadStale(bankId: string, sb: SB = supabaseAdmin()): Promise<TriggerFinding[]> {
  const { data } = await sb
    .from("brokerage_leads")
    .select("id, status, created_at, last_attempted_contact_at, next_action_due_at, do_not_contact")
    .eq("bank_id", bankId)
    .in("status", ["new", "attempting_contact", "contacted", "nurture"]);

  const findings: TriggerFinding[] = [];
  for (const lead of (data ?? []) as any[]) {
    if (lead.do_not_contact) continue;
    const sla = computeLeadSlaState(lead);
    if (sla.isOverdue) {
      findings.push({
        entityType: "lead",
        entityId: lead.id,
        dedupeKey: new Date().toISOString().slice(0, 10), // one finding per lead per day
        context: { firstContactOverdue: sla.firstContactOverdue, nextActionOverdue: sla.nextActionOverdue },
      });
    }
  }
  return findings;
}

export async function findTaskOverdue(bankId: string, sb: SB = supabaseAdmin()): Promise<TriggerFinding[]> {
  const { data } = await sb
    .from("brokerage_tasks")
    .select("id, title, due_at, deal_id")
    .eq("bank_id", bankId)
    .lt("due_at", new Date().toISOString())
    .in("status", ["open", "in_progress", "blocked"]);

  return ((data ?? []) as any[]).map((t) => ({
    entityType: "task" as const,
    entityId: t.id,
    dedupeKey: t.id, // one finding per overdue task, not re-fired daily
    context: { title: t.title, dealId: t.deal_id },
  }));
}

export async function findConditionOverdue(bankId: string, sb: SB = supabaseAdmin()): Promise<TriggerFinding[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb
    .from("brokerage_closing_conditions")
    .select("id, deal_id, title, due_date")
    .eq("status", "open")
    .lt("due_date", today);

  return ((data ?? []) as any[])
    .filter((c) => c.deal_id) // condition tables aren't bank-scoped directly; caller filters by deal ownership if needed
    .map((c) => ({
      entityType: "deal" as const,
      entityId: c.deal_id,
      dedupeKey: c.id,
      context: { conditionTitle: c.title, dueDate: c.due_date },
    }));
}

export async function findLenderResponseMissing(bankId: string, sb: SB = supabaseAdmin()): Promise<TriggerFinding[]> {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data } = await sb
    .from("deals")
    .select("id, brokerage_stage_entered_at")
    .eq("bank_id", bankId)
    .eq("brokerage_stage", "submitted")
    .lt("brokerage_stage_entered_at", cutoff);

  return ((data ?? []) as any[]).map((d) => ({
    entityType: "deal" as const,
    entityId: d.id,
    dedupeKey: new Date().toISOString().slice(0, 10),
    context: { stageEnteredAt: d.brokerage_stage_entered_at },
  }));
}

export async function findReferralRelationshipStale(bankId: string, staleDays = 60, sb: SB = supabaseAdmin()): Promise<TriggerFinding[]> {
  const cutoff = new Date(Date.now() - staleDays * 24 * 3600 * 1000).toISOString();
  const { data: roles } = await sb
    .from("crm_person_organization_roles")
    .select("person_id")
    .eq("bank_id", bankId)
    .eq("is_active", true);
  const personIds = Array.from(new Set(((roles ?? []) as any[]).map((r) => r.person_id)));
  if (personIds.length === 0) return [];

  const { data: people } = await sb
    .from("crm_people")
    .select("id, last_contacted_at, do_not_contact")
    .eq("bank_id", bankId)
    .in("id", personIds);

  const findings: TriggerFinding[] = [];
  for (const p of (people ?? []) as any[]) {
    if (p.do_not_contact) continue;
    if (!p.last_contacted_at || p.last_contacted_at < cutoff) {
      findings.push({
        entityType: "person",
        entityId: p.id,
        dedupeKey: new Date().toISOString().slice(0, 10),
        context: { lastContactedAt: p.last_contacted_at },
      });
    }
  }
  return findings;
}

export async function findDocumentMissing(bankId: string, sb: SB = supabaseAdmin()): Promise<TriggerFinding[]> {
  const { data: deals } = await sb.from("deals").select("id").eq("bank_id", bankId);
  const dealIds = new Set(((deals ?? []) as any[]).map((d) => d.id));

  const { data } = await sb
    .from("deal_checklist_items")
    .select("id, deal_id, title")
    .eq("required", true)
    .eq("status", "missing");

  return ((data ?? []) as any[])
    .filter((c) => dealIds.has(c.deal_id))
    .map((c) => ({
      entityType: "deal" as const,
      entityId: c.deal_id,
      dedupeKey: c.id,
      context: { documentTitle: c.title },
    }));
}
