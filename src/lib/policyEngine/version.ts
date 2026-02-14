/**
 * Policy Engine — Deterministic Version Hash
 *
 * Computes a content hash of all static policy definitions at module load.
 * Auto-tracks changes — no manual bumping required.
 * Used in snapshot envelopes for institutional audit trail.
 */

import { createHash } from "node:crypto";
import { getPolicyDefinition } from "./policies";

const PRODUCTS = ["SBA", "LOC", "EQUIPMENT", "ACQUISITION", "CRE"] as const;

function computePolicyVersion(): string {
  const all = PRODUCTS.map((p) => ({
    product: p,
    thresholds: getPolicyDefinition(p).thresholds,
  }));
  return createHash("sha256")
    .update(JSON.stringify(all), "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** Deterministic hash of all static policy definitions. */
export const POLICY_DEFINITIONS_VERSION: string = computePolicyVersion();
