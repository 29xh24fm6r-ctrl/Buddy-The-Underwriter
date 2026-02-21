/**
 * E1.2 — Per-Document Blocker Computation
 *
 * Pure module — no server-only, no DB.
 * Safe for CI guard imports and direct unit testing.
 *
 * Every blocker has a concrete resolution path for the banker.
 */

// ── Types ──────────────────────────────────────────────────────────────

/** Minimal document shape needed for blocker computation. */
export type ActiveDoc = {
  id: string;
  original_filename: string | null;
  intake_status: string | null;
  quality_status: string | null;
  segmented: boolean | null;
  canonical_type: string | null;
  doc_year: number | null;
  logical_key: string | null;
};

/** Blocker reason codes — each maps to a concrete banker action. */
export type BlockerCode =
  | "needs_confirmation"    // Action: Confirm button
  | "quality_not_passed"    // Action: Re-upload
  | "segmented_parent"      // Action: Wait for children / re-upload
  | "entity_ambiguous"      // Action: Assign entity
  | "missing_required_year" // Action: Edit year
  | "unclassified";         // Action: Edit type

/** Per-document blocker result. */
export type DocBlocker = {
  document_id: string;
  filename: string;
  blockers: BlockerCode[];
};

/** Summary counts across all documents. */
export type BlockerSummary = Record<BlockerCode, number>;

// ── Constants (CI-locked) ──────────────────────────────────────────────

/** Document types that require a year to be valid. */
export const YEAR_REQUIRED_TYPES = new Set([
  "PERSONAL_TAX_RETURN",
  "BUSINESS_TAX_RETURN",
]);

/** Entity-scoped document types used for ambiguity detection. */
const ENTITY_SCOPED_TYPES = new Set([
  "PERSONAL_TAX_RETURN",
  "PERSONAL_FINANCIAL_STATEMENT",
  "BUSINESS_TAX_RETURN",
]);

// ── Pure Functions ─────────────────────────────────────────────────────

/**
 * Compute blockers for a single document.
 *
 * @param doc - Active document record
 * @param ambiguousKeys - Set of "canonical_type|doc_year" keys with duplicate
 *   unresolved entity-scoped docs. Pre-computed by `buildAmbiguousKeySet()`.
 * @returns Array of blocker reason codes (empty = clean)
 */
export function computeDocBlockers(
  doc: ActiveDoc,
  ambiguousKeys: Set<string>,
): BlockerCode[] {
  const blockers: BlockerCode[] = [];

  // Not yet confirmed
  if (
    doc.intake_status === "UPLOADED" ||
    doc.intake_status === "CLASSIFIED_PENDING_REVIEW"
  ) {
    blockers.push("needs_confirmation");
  }

  // Quality gate: null or non-PASSED = blocked (fail-closed)
  if (doc.quality_status == null || doc.quality_status !== "PASSED") {
    blockers.push("quality_not_passed");
  }

  // Segmented parent still active = structural leak
  if (doc.segmented === true) {
    blockers.push("segmented_parent");
  }

  // No classification = unclassified
  if (doc.canonical_type == null) {
    blockers.push("unclassified");
  }

  // Year-required types without a year
  if (
    doc.canonical_type != null &&
    YEAR_REQUIRED_TYPES.has(doc.canonical_type) &&
    doc.doc_year == null
  ) {
    blockers.push("missing_required_year");
  }

  // Entity ambiguity: unresolved entity-scoped doc with duplicates
  if (doc.logical_key == null && doc.canonical_type != null) {
    const key = `${doc.canonical_type}|${doc.doc_year ?? "NA"}`;
    if (ambiguousKeys.has(key)) {
      blockers.push("entity_ambiguous");
    }
  }

  return blockers;
}

/**
 * Build the set of ambiguous keys from active documents.
 *
 * A key is ambiguous when multiple entity-scoped documents share
 * the same canonical_type + doc_year AND have no logical_key (unresolved).
 */
export function buildAmbiguousKeySet(docs: ActiveDoc[]): Set<string> {
  const groups = new Map<string, number>();

  for (const doc of docs) {
    if (
      doc.logical_key == null &&
      doc.canonical_type != null &&
      ENTITY_SCOPED_TYPES.has(doc.canonical_type)
    ) {
      const key = `${doc.canonical_type}|${doc.doc_year ?? "NA"}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
  }

  const ambiguous = new Set<string>();
  for (const [key, count] of groups) {
    if (count > 1) ambiguous.add(key);
  }
  return ambiguous;
}

/**
 * Compute blockers for all documents and produce the full response.
 *
 * @returns blocked documents (only those with ≥1 blocker) and summary counts.
 */
export function computeAllBlockers(docs: ActiveDoc[]): {
  blocked_documents: DocBlocker[];
  summary: BlockerSummary;
} {
  const ambiguousKeys = buildAmbiguousKeySet(docs);

  const allBlockerCodes: BlockerCode[] = [
    "needs_confirmation",
    "quality_not_passed",
    "segmented_parent",
    "entity_ambiguous",
    "missing_required_year",
    "unclassified",
  ];

  const summary: BlockerSummary = Object.fromEntries(
    allBlockerCodes.map((code) => [code, 0]),
  ) as BlockerSummary;

  const blocked_documents: DocBlocker[] = [];

  for (const doc of docs) {
    const blockers = computeDocBlockers(doc, ambiguousKeys);
    if (blockers.length > 0) {
      blocked_documents.push({
        document_id: doc.id,
        filename: doc.original_filename ?? "unknown",
        blockers,
      });
      for (const code of blockers) {
        summary[code]++;
      }
    }
  }

  return { blocked_documents, summary };
}
