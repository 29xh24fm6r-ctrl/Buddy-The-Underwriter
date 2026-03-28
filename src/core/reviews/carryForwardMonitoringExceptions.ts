import "server-only";

/**
 * Phase 65J — Carry Forward Monitoring Exceptions
 *
 * Carries unresolved 65I exceptions into review/renewal cases.
 * Stable upsert — no duplicates.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ReviewCaseType } from "./types";

export type CarryForwardInput = {
  dealId: string;
  bankId: string;
  caseType: ReviewCaseType;
  caseId: string;
};

export type CarryForwardResult = {
  ok: boolean;
  carriedCount: number;
  skippedCount: number;
};

export async function carryForwardMonitoringExceptions(
  input: CarryForwardInput,
): Promise<CarryForwardResult> {
  const sb = supabaseAdmin();
  let carried = 0;
  let skipped = 0;

  // Get unresolved monitoring exceptions
  const { data: openExceptions } = await sb
    .from("deal_monitoring_exceptions")
    .select("id, exception_code, severity")
    .eq("deal_id", input.dealId)
    .eq("status", "open");

  if (!openExceptions || openExceptions.length === 0) {
    return { ok: true, carriedCount: 0, skippedCount: 0 };
  }

  // Get existing carried exceptions for dedup
  const { data: existingCarried } = await sb
    .from("deal_review_case_exceptions")
    .select("source_exception_id")
    .eq("case_id", input.caseId)
    .eq("case_type", input.caseType);

  const carriedIds = new Set(
    (existingCarried ?? []).map((e) => e.source_exception_id).filter(Boolean),
  );

  for (const ex of openExceptions) {
    if (carriedIds.has(ex.id)) {
      skipped++;
      continue;
    }

    const { error } = await sb.from("deal_review_case_exceptions").insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      case_type: input.caseType,
      case_id: input.caseId,
      source_exception_id: ex.id,
      exception_code: ex.exception_code,
      severity: ex.severity,
      status: "open",
    });

    if (!error) carried++;
  }

  if (carried > 0) {
    await sb.from("deal_timeline_events").insert({
      deal_id: input.dealId,
      kind: "review_exception.carried_forward",
      title: `${carried} monitoring exception${carried > 1 ? "s" : ""} carried forward`,
      visible_to_borrower: false,
      meta: { case_type: input.caseType, case_id: input.caseId },
    });
  }

  return { ok: true, carriedCount: carried, skippedCount: skipped };
}
