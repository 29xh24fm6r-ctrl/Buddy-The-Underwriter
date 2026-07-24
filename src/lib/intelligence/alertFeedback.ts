import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AlertEntityType, SB } from "./types";

/**
 * Dismiss / snooze / acknowledge state for command-center alerts —
 * spec section 7.7. Mirrors the state machine already proven by
 * buddy_advisor_feedback (deal-scoped, per-signal) but keyed by a
 * generic (entity_type, entity_id) pair since command-center alerts span
 * leads, organizations, people, and tasks in addition to deals. userId
 * null means a team-wide dismissal (the command center is a shared
 * operational view); a set clerk user id means personal.
 */

export type AlertFeedbackState = "acknowledged" | "dismissed" | "snoozed";

export type AlertFeedbackRow = {
  id: string;
  bank_id: string;
  entity_type: AlertEntityType;
  entity_id: string;
  user_id: string | null;
  alert_key: string;
  state: AlertFeedbackState;
  snoozed_until: string | null;
  reason: string | null;
  dismiss_count: number;
  last_dismissed_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listAlertFeedback(
  bankId: string,
  sb: SB = supabaseAdmin(),
): Promise<AlertFeedbackRow[]> {
  const { data } = await sb.from("crm_alert_feedback").select("*").eq("bank_id", bankId);
  return (data ?? []) as AlertFeedbackRow[];
}

function effectiveState(row: AlertFeedbackRow, now: Date): AlertFeedbackState | null {
  if (row.state === "snoozed" && row.snoozed_until && new Date(row.snoozed_until) <= now) return null;
  return row.state;
}

/** Builds a lookup keyed by `${entityType}:${entityId}:${alertKey}` (team-wide) and `${...}:${userId}` (personal), with expired snoozes already filtered out. */
export function buildFeedbackLookup(rows: AlertFeedbackRow[], now: Date = new Date()): Map<string, AlertFeedbackRow> {
  const map = new Map<string, AlertFeedbackRow>();
  for (const row of rows) {
    const state = effectiveState(row, now);
    if (!state) continue;
    const key = `${row.entity_type}:${row.entity_id}:${row.alert_key}:${row.user_id ?? ""}`;
    map.set(key, row);
  }
  return map;
}

export async function setAlertFeedback(
  input: {
    bankId: string;
    entityType: AlertEntityType;
    entityId: string;
    alertKey: string;
    state: AlertFeedbackState;
    userId?: string | null;
    reason?: string | null;
    snoozeUntilIso?: string | null;
  },
  sb: SB = supabaseAdmin(),
): Promise<AlertFeedbackRow> {
  const userId = input.userId ?? null;
  let existingQuery = sb
    .from("crm_alert_feedback")
    .select("*")
    .eq("bank_id", input.bankId)
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .eq("alert_key", input.alertKey);
  existingQuery = userId == null ? existingQuery.is("user_id", null) : existingQuery.eq("user_id", userId);
  const { data: existing } = await existingQuery.maybeSingle();

  const isDismissal = input.state === "dismissed";
  const patch: Record<string, unknown> = {
    state: input.state,
    reason: input.reason ?? null,
    snoozed_until: input.state === "snoozed" ? input.snoozeUntilIso ?? null : null,
  };
  if (isDismissal) {
    patch.dismiss_count = ((existing as AlertFeedbackRow | null)?.dismiss_count ?? 0) + 1;
    patch.last_dismissed_at = new Date().toISOString();
  }

  if (existing) {
    const { data } = await sb.from("crm_alert_feedback").update(patch).eq("id", (existing as AlertFeedbackRow).id).select("*").single();
    return data as AlertFeedbackRow;
  }

  const { data } = await sb
    .from("crm_alert_feedback")
    .insert({
      bank_id: input.bankId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      alert_key: input.alertKey,
      user_id: userId,
      dismiss_count: isDismissal ? 1 : 0,
      last_dismissed_at: isDismissal ? new Date().toISOString() : null,
      ...patch,
    })
    .select("*")
    .single();
  return data as AlertFeedbackRow;
}

export async function clearAlertFeedback(
  bankId: string,
  entityType: AlertEntityType,
  entityId: string,
  alertKey: string,
  userId: string | null,
  sb: SB = supabaseAdmin(),
): Promise<void> {
  let q = sb
    .from("crm_alert_feedback")
    .delete()
    .eq("bank_id", bankId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("alert_key", alertKey);
  q = userId == null ? q.is("user_id", null) : q.eq("user_id", userId);
  await q;
}
