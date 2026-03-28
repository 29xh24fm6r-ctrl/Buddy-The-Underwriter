import "server-only";

/**
 * Phase 65I — Open Monitoring Exception
 *
 * Stable upsert — no duplicate exception spam.
 * Exception can coexist with cycle until resolved.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MonitoringExceptionCode, MonitoringExceptionSeverity } from "./types";

export type OpenExceptionInput = {
  dealId: string;
  bankId: string;
  cycleId?: string | null;
  obligationId?: string | null;
  exceptionCode: MonitoringExceptionCode;
  severity: MonitoringExceptionSeverity;
  openedBy: string;
};

export type OpenExceptionResult = {
  ok: boolean;
  exceptionId: string | null;
  created: boolean;
};

export async function openMonitoringException(
  input: OpenExceptionInput,
): Promise<OpenExceptionResult> {
  const sb = supabaseAdmin();

  // Dedup: check for existing open exception with same code + cycle/obligation
  const query = sb
    .from("deal_monitoring_exceptions")
    .select("id")
    .eq("deal_id", input.dealId)
    .eq("exception_code", input.exceptionCode)
    .eq("status", "open");

  if (input.cycleId) query.eq("cycle_id", input.cycleId);
  if (input.obligationId) query.eq("obligation_id", input.obligationId);

  const { data: existing } = await query.maybeSingle();

  if (existing) {
    return { ok: true, exceptionId: existing.id, created: false };
  }

  const { data: ex, error } = await sb
    .from("deal_monitoring_exceptions")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      cycle_id: input.cycleId ?? null,
      obligation_id: input.obligationId ?? null,
      exception_code: input.exceptionCode,
      severity: input.severity,
      status: "open",
      opened_by: input.openedBy,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, exceptionId: null, created: false };
  }

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "monitoring_exception.opened",
    title: `Monitoring exception: ${input.exceptionCode.replace(/_/g, " ")}`,
    detail: `Severity: ${input.severity}`,
    visible_to_borrower: false,
    meta: { exception_id: ex.id, exception_code: input.exceptionCode },
  });

  return { ok: true, exceptionId: ex.id, created: true };
}
