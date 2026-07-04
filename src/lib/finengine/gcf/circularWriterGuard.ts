/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 19: GCF Circular Writer Kill Switch.
 *
 * Quarantine control for the circular `facts → rendered GCF spread → facts` path
 * (`renderSpread.ts::persistGcfComputedFacts`). That path re-derives canonical
 * GCF facts from RENDERED output, which is the circularity the finengine arc must
 * eventually eliminate.
 *
 * SAFETY: the kill switch DEFAULTS TO ENABLED so this PR changes NO live behavior
 * (safety rule 2 — no flag flipped by default). An operator quarantines the
 * writer by setting the env flag to a falsey value; when quarantined,
 * `planGcfFactWrites` returns ZERO writes — the contract the test locks in so no
 * canonical fact can be written from the rendered spread while quarantined.
 *
 * Pure — reads an injectable env map; no IO of its own.
 */

import {
  extractGcfFactsFromRendered,
  type RenderedLike,
  type GcfFactToWrite,
} from "@/lib/financialSpreads/gcfFactsFromRendered";

export const GCF_CIRCULAR_WRITER_KILL_SWITCH_ENV = "GCF_CIRCULAR_WRITER_DISABLED";

/**
 * Is the circular writer enabled? DEFAULT TRUE (current behavior). Disabled only
 * when the env flag is explicitly set to a falsey/quarantine value.
 */
export function isGcfCircularWriterEnabled(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const raw = (env[GCF_CIRCULAR_WRITER_KILL_SWITCH_ENV] ?? "").trim().toLowerCase();
  // The env var NAMES the disable intent; presence of a truthy disable value
  // quarantines the writer. Absent/empty ⇒ enabled (no live change).
  return !(raw === "1" || raw === "true" || raw === "yes" || raw === "on");
}

export type GcfWritePlan = {
  writes: GcfFactToWrite[];
  quarantined: boolean;
};

/**
 * Plan the canonical GCF fact writes from a rendered spread. When the circular
 * writer is quarantined, returns NO writes (the anti-circularity guarantee).
 * When enabled (default), returns exactly what the legacy extractor produced —
 * identical to current behavior.
 */
export function planGcfFactWrites(
  rendered: RenderedLike,
  opts?: { enabled?: boolean; env?: Record<string, string | undefined> },
): GcfWritePlan {
  const enabled = opts?.enabled ?? isGcfCircularWriterEnabled(opts?.env);
  if (!enabled) return { writes: [], quarantined: true };
  return { writes: extractGcfFactsFromRendered(rendered), quarantined: false };
}

// ── Shadow comparison to finengine GCF ────────────────────────────────────────

export type GcfShadowComparison = {
  renderedGcf: number | null;
  finengineGcf: number | null;
  status: "match" | "divergent" | "missing";
  relDiff: number | null;
};

/**
 * Shadow-only: compare the rendered-spread GCF value against the finengine's
 * computed GCF. Produces a diff for the reconciliation matrix; it NEVER writes.
 */
export function compareRenderedGcfToFinengine(
  renderedGcf: number | null,
  finengineGcf: number | null,
  tol = { atol: 0.5, rtol: 1e-4 },
): GcfShadowComparison {
  if (renderedGcf == null || finengineGcf == null) {
    return { renderedGcf, finengineGcf, status: "missing", relDiff: null };
  }
  const diff = Math.abs(renderedGcf - finengineGcf);
  const denom = Math.max(Math.abs(renderedGcf), Math.abs(finengineGcf)) || 1;
  const agree = diff <= Math.max(tol.atol, tol.rtol * denom);
  return {
    renderedGcf,
    finengineGcf,
    status: agree ? "match" : "divergent",
    relDiff: diff / denom,
  };
}
