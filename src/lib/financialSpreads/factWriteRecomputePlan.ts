/**
 * SPEC-SPREAD-SYSTEM-PERFECTION-HARDENING-1 (Phase 2) — internal fact-write recompute plan.
 *
 * Pure decision (no DB, no server imports) for which spreads an INTERNAL
 * fact-write recompute may enqueue. This is a DEFAULT, non-banker-explicit
 * trigger, so it must honor the same guardrails as a default recompute:
 *
 *   • BALANCE_SHEET — the primary document-derived business spread; always a
 *     candidate (enqueueSpreadRecompute still gates it on its own template
 *     prerequisites, so passing it never forces an empty render).
 *   • T12 — OPTIONAL / never primary (#556). Must NOT be enqueued from annual
 *     statement / tax-return fact writes unless the deal actually supplied a
 *     real T12 / monthly operating-statement source. Passing T12 explicitly here
 *     would bypass the default T12 filter and manufacture orphan T12 rows from
 *     annual facts — exactly the contamination this phase removes.
 *   • GLOBAL_CASH_FLOW — a DOWNSTREAM aggregate (#554). Only a candidate once its
 *     upstream prerequisites are ready; otherwise enqueuing it from a fact write
 *     creates an orphan/placeholder GCF row that can never compute.
 *
 * Resolving `hasT12Source` and `gcfPrerequisitesReady` is the caller's job
 * (server-side); this function only decides the list from those booleans.
 */

import type { SpreadType } from "./types";

export function planFactWriteRecomputeSpreadTypes(opts: {
  hasT12Source: boolean;
  gcfPrerequisitesReady: boolean;
}): SpreadType[] {
  const types: SpreadType[] = ["BALANCE_SHEET"];

  // T12 is the only optional spread today (#556); gate it on a real source.
  if (opts.hasT12Source) types.push("T12");

  // GCF is downstream (#554); only enqueue once upstream prerequisites are ready.
  if (opts.gcfPrerequisitesReady) types.push("GLOBAL_CASH_FLOW");

  return types;
}
