import type { BIEThreadName } from "./buddyIntelligenceEngine";

/**
 * Dependency-aware plan for which BIE threads can be reused from a previous
 * attempt instead of re-run.
 *
 * Regression for specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md (round 4,
 * resumable missions): a mission retry previously re-ran all 8 Gemini
 * threads from scratch even when most of them had already succeeded. A
 * thread is only safe to reuse if it succeeded AND every thread whose
 * output feeds its prompt is also being reused (not retried) this round —
 * reusing a thread whose upstream input just changed would silently persist
 * stale, no-longer-consistent research.
 *
 * Dependency graph (mirrors the actual prompt construction in
 * buddyIntelligenceEngine.ts):
 *   entity_lock                        — no deps
 *   borrower, management, competitive  — depend on entity_lock
 *   market, industry                   — no deps
 *   transaction                        — depends on borrower, management,
 *                                         competitive, market, industry
 *   synthesis                          — depends on entity_lock + every
 *                                         other thread including transaction
 */

export type BIEThreadSucceeded = { ok: boolean };

export function planBIEThreadReuse(
  previous: Partial<Record<BIEThreadName, BIEThreadSucceeded>>,
): Record<BIEThreadName, boolean> {
  const succeeded = (name: BIEThreadName): boolean => previous[name]?.ok === true;

  const entity_lock = succeeded("entity_lock");
  const borrower = succeeded("borrower") && entity_lock;
  const management = succeeded("management") && entity_lock;
  const competitive = succeeded("competitive") && entity_lock;
  const market = succeeded("market");
  const industry = succeeded("industry");
  const transaction =
    succeeded("transaction") && borrower && management && competitive && market && industry;
  const synthesis = succeeded("synthesis") && entity_lock && transaction;

  return { entity_lock, borrower, management, competitive, market, industry, transaction, synthesis };
}
