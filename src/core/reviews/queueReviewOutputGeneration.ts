import "server-only";

/**
 * Phase 65J — Queue Review Output Generation
 *
 * Queues deterministic outputs when case enters under_review or ready.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ReviewCaseType } from "./types";

const ANNUAL_REVIEW_OUTPUTS = [
  "financial_snapshot_refresh",
  "review_summary",
] as const;

const RENEWAL_OUTPUTS = [
  "financial_snapshot_refresh",
  "memo_refresh",
  "renewal_packet",
] as const;

export type QueueOutputsInput = {
  dealId: string;
  bankId: string;
  caseType: ReviewCaseType;
  caseId: string;
};

export type QueueOutputsResult = {
  ok: boolean;
  queuedCount: number;
};

export async function queueReviewOutputGeneration(
  input: QueueOutputsInput,
): Promise<QueueOutputsResult> {
  const sb = supabaseAdmin();
  const outputs = input.caseType === "renewal" ? RENEWAL_OUTPUTS : ANNUAL_REVIEW_OUTPUTS;
  let queued = 0;

  // Get existing outputs for dedup
  const { data: existing } = await sb
    .from("deal_review_case_outputs")
    .select("output_type")
    .eq("case_id", input.caseId)
    .eq("case_type", input.caseType)
    .in("status", ["queued", "generated", "reviewed"]);

  const existingTypes = new Set((existing ?? []).map((o) => o.output_type));

  for (const outputType of outputs) {
    if (existingTypes.has(outputType)) continue;

    const { error } = await sb.from("deal_review_case_outputs").insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      case_type: input.caseType,
      case_id: input.caseId,
      output_type: outputType,
      status: "queued",
    });

    if (!error) queued++;
  }

  if (queued > 0) {
    await sb.from("deal_timeline_events").insert({
      deal_id: input.dealId,
      kind: "review_output.queued",
      title: `${queued} review output${queued > 1 ? "s" : ""} queued`,
      visible_to_borrower: false,
      meta: { case_type: input.caseType, case_id: input.caseId },
    });
  }

  return { ok: true, queuedCount: queued };
}
