/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 7: Product Intelligence Framework.
 *
 * Missing-data blocker system. Given a product, the metrics that actually
 * computed, and the documents actually present, it returns the blockers that
 * stand between the file and a complete underwrite. Pure — it reads state and
 * reports; it never resolves, never writes, never fabricates.
 */

import { getProductDefinition, type ProductKey } from "@/lib/finengine/products/productContract";

export type BlockerKind = "missing_metric" | "missing_document";
export type BlockerSeverity = "block" | "flag";

export type ProductBlocker = {
  kind: BlockerKind;
  key: string;
  severity: BlockerSeverity;
  message: string;
};

export type ProductReadinessInput = {
  product: ProductKey;
  /** metricId → computed value (null/absent ⇒ not computed). */
  computedMetrics: Record<string, number | null>;
  /** Document type keys present on the deal (matched case-insensitively). */
  availableDocuments: string[];
};

export type ProductReadiness = {
  product: ProductKey;
  blockers: ProductBlocker[];
  /** True when there are no `block`-severity blockers. */
  ready: boolean;
  missingMetrics: string[];
  missingDocuments: string[];
};

function hasMetric(computed: Record<string, number | null>, metricId: string): boolean {
  const v = computed[metricId];
  return v != null && Number.isFinite(v);
}

/** Case-insensitive document presence, allowing substring family matches. */
function hasDocument(available: string[], required: string): boolean {
  const req = required.toUpperCase();
  return available.some((d) => {
    const u = d.toUpperCase();
    return u === req || u.includes(req) || req.includes(u);
  });
}

export function evaluateProductReadiness(input: ProductReadinessInput): ProductReadiness {
  const def = getProductDefinition(input.product);
  const blockers: ProductBlocker[] = [];
  const missingMetrics: string[] = [];
  const missingDocuments: string[] = [];

  for (const metricId of def.requiredMetrics) {
    if (!hasMetric(input.computedMetrics, metricId)) {
      missingMetrics.push(metricId);
      blockers.push({
        kind: "missing_metric",
        key: metricId,
        severity: "block", // a required metric that will not compute blocks the underwrite
        message: `Required metric ${metricId} did not compute for ${input.product}`,
      });
    }
  }

  for (const doc of def.requiredDocuments) {
    if (!hasDocument(input.availableDocuments, doc)) {
      missingDocuments.push(doc);
      blockers.push({
        kind: "missing_document",
        key: doc,
        severity: "block",
        message: `Required document ${doc} is not present for ${input.product}`,
      });
    }
  }

  const ready = !blockers.some((b) => b.severity === "block");
  return { product: input.product, blockers, ready, missingMetrics, missingDocuments };
}
