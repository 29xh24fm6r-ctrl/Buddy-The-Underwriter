/**
 * SPEC-B4 — Deterministic slate hash for audit provenance.
 *
 * Pure function — no side effects.
 */

import { createHash } from "node:crypto";
import type { MethodologySlate } from "./types";

/**
 * Compute a deterministic SHA-256 hash of a methodology slate.
 * Keys are sorted alphabetically to ensure stability across object
 * creation order.
 */
export function computeSlateHash(slate: MethodologySlate): string {
  const sorted = Object.keys(slate)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      acc[key] = slate[key as keyof MethodologySlate];
      return acc;
    }, {});

  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}
