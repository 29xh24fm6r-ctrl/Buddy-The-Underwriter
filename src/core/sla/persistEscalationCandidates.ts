import "server-only";

/**
 * Phase 65G — Escalation Persistence
 *
 * Stable persistence: upserts active escalations, resolves cleared ones.
 * No duplicates on every processor run.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type { EscalationCandidate } from "./types";

export async function persistEscalationCandidates(
  dealId: string,
  bankId: string,
  candidates: EscalationCandidate[],
): Promise<{ created: number; updated: number; resolved: number }> {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  let resolved = 0;

  const activeCodes = new Set(candidates.map((c) => c.escalationCode));

  // Upsert active candidates
  for (const candidate of candidates) {
    const { data: existing } = await sb
      .from("deal_escalation_events")
      .select("id")
      .eq("deal_id", dealId)
      .eq("escalation_code", candidate.escalationCode)
      .eq("is_active", true)
      .maybeSingle();

    if (existing) {
      await sb
        .from("deal_escalation_events")
        .update({
          last_triggered_at: now,
          severity: candidate.severity,
          message: candidate.message,
        })
        .eq("id", existing.id);
      updated++;
    } else {
      await sb.from("deal_escalation_events").insert({
        deal_id: dealId,
        bank_id: bankId,
        escalation_code: candidate.escalationCode,
        severity: candidate.severity,
        source: candidate.source,
        related_object_type: candidate.relatedObjectType ?? null,
        related_object_id: candidate.relatedObjectId ?? null,
        message: candidate.message,
        is_active: true,
        first_triggered_at: now,
        last_triggered_at: now,
      });
      created++;

      // Ledger event on first trigger only
      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "escalation.triggered",
        uiState: "error",
        uiMessage: `Escalation: ${candidate.message}`,
        meta: {
          escalation_code: candidate.escalationCode,
          severity: candidate.severity,
        },
      }).catch(() => {});
    }
  }

  // Resolve active escalations that are no longer candidates
  const { data: activeEscalations } = await sb
    .from("deal_escalation_events")
    .select("id, escalation_code")
    .eq("deal_id", dealId)
    .eq("is_active", true);

  for (const esc of activeEscalations ?? []) {
    if (!activeCodes.has(esc.escalation_code)) {
      await sb
        .from("deal_escalation_events")
        .update({ is_active: false, resolved_at: now })
        .eq("id", esc.id);
      resolved++;

      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "escalation.resolved",
        uiState: "done",
        uiMessage: `Escalation resolved: ${esc.escalation_code}`,
        meta: { escalation_code: esc.escalation_code },
      }).catch(() => {});
    }
  }

  return { created, updated, resolved };
}
