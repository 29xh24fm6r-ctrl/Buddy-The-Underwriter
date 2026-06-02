/**
 * SPEC-GCF-READY-SPREAD-MUST-MATERIALIZE-CANONICAL-FACTS-1
 *
 * Pure extractor (no "server-only") that maps a ready GLOBAL_CASH_FLOW
 * rendered_json into the canonical facts that MUST be materialized so memo
 * readiness, snapshot, and credit memo can read them. Kept pure so the
 * materialization contract is unit-testable.
 *
 * Canonical keys written from a ready GCF spread:
 *   - GCF_GLOBAL_CASH_FLOW   (canonical)
 *   - GLOBAL_CASH_FLOW       (legacy alias — same value as GCF_GLOBAL_CASH_FLOW)
 *   - GCF_DSCR
 *   - GCF_CASH_AVAILABLE
 */

export type RenderedLike = {
  rows?: Array<{ key?: string | null; values?: unknown[] }> | null;
};

export type GcfFactToWrite = { factKey: string; value: number };

/**
 * Read a numeric value from a rendered row's first cell, tolerating BOTH cell
 * shapes the templates/UI use: `{ value: n }` and a bare `n`. (The GCF page's
 * extractGcfKpis is tolerant the same way; persistence must be too, or a
 * bare-number cell silently yields null and no fact is written.)
 */
export function readRenderedRowNumber(
  rendered: RenderedLike,
  rowKey: string,
): number | null {
  const row = rendered.rows?.find((r) => r?.key === rowKey);
  const cell = row?.values?.[0];
  const raw =
    cell !== null && typeof cell === "object"
      ? (cell as { value?: unknown }).value
      : cell;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * Extract the canonical GCF facts (incl. legacy alias) from a ready rendered
 * GCF spread. Only present (non-null) values are returned.
 */
export function extractGcfFactsFromRendered(
  rendered: RenderedLike,
): GcfFactToWrite[] {
  const gcf = readRenderedRowNumber(rendered, "GCF_GLOBAL_CASH_FLOW");
  const dscr = readRenderedRowNumber(rendered, "GCF_DSCR");
  const cash = readRenderedRowNumber(rendered, "GCF_CASH_AVAILABLE");

  const out: GcfFactToWrite[] = [];
  if (gcf !== null) {
    out.push({ factKey: "GCF_GLOBAL_CASH_FLOW", value: gcf });
    // Legacy alias mirrors the canonical value so readers still on the old key
    // (and the cached readiness contract) resolve the same number.
    out.push({ factKey: "GLOBAL_CASH_FLOW", value: gcf });
  }
  if (dscr !== null) out.push({ factKey: "GCF_DSCR", value: dscr });
  if (cash !== null) out.push({ factKey: "GCF_CASH_AVAILABLE", value: cash });
  return out;
}
