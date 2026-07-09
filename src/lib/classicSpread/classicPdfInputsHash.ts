/**
 * SPEC-FINENGINE-TIERS-6-9 (Tier 8) — real content hash for the Classic PDF cache.
 *
 * The Classic PDF cache previously persisted `inputs_hash: null` and relied
 * solely on (a) a hand-bumped CLASSIC_PDF_RENDER_VERSION and (b) the latest
 * fact `updated_at`. That leaves two gaps: a fact-content change that does not
 * move a monitored timestamp, and a resolver/overlay change that alters the
 * rendered numbers without any fact write. This computes a deterministic hash
 * of the ACTUAL render-driving inputs so the cache can invalidate on real
 * content change — with the render version folded in, so a version bump also
 * changes the hash (the constant stays a signal, just not the ONLY one).
 *
 * Volatile, non-content fields (e.g. the human-formatted `preparedDate`
 * timestamp) are excluded so an unchanged spread hashes identically across
 * renders. Object keys are sorted recursively so serialization order can never
 * spuriously change the hash. Pure — no DB, no server imports.
 */

import { createHash } from "node:crypto";
import type { ClassicSpreadInput } from "./types";
import { CLASSIC_PDF_RENDER_VERSION } from "./classicPdfRenderVersion";

/** Recursively key-sorted, undefined-stripped serialization for a stable digest. */
function stableSerialize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableSerialize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue;
    out[key] = stableSerialize(obj[key]);
  }
  return out;
}

/**
 * Deterministic hash of the financial content that drives the Classic PDF.
 * Same numbers + same render version ⇒ same hash. Any change to the rendered
 * figures (or a render-version bump) ⇒ a different hash.
 */
export function computeClassicPdfInputsHash(input: ClassicSpreadInput): string {
  // Only the fields that materially affect what is rendered. `preparedDate`
  // (a wall-clock timestamp) is deliberately omitted.
  const content = {
    renderVersion: CLASSIC_PDF_RENDER_VERSION,
    dealId: input.dealId,
    companyName: input.companyName,
    naicsCode: input.naicsCode,
    naicsDescription: input.naicsDescription,
    bankName: input.bankName,
    periods: input.periods,
    balanceSheet: input.balanceSheet,
    incomeStatement: input.incomeStatement,
    cashFlow: input.cashFlow,
    cashFlowPeriods: input.cashFlowPeriods,
    ratioSections: input.ratioSections,
    globalCashFlow: input.globalCashFlow,
    personalIncome: input.personalIncome ?? null,
    executiveSummary: input.executiveSummary,
    certified: input.certified ?? null,
    certificationAudit: input.certificationAudit ?? null,
    certificationSummary: input.certificationSummary ?? null,
  };
  const json = JSON.stringify(stableSerialize(content));
  return createHash("sha256").update(json).digest("hex");
}
