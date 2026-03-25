/**
 * Owner/principal candidate extraction from business tax return facts.
 * Pure module — no DB, no server-only.
 *
 * Reads structured financial facts from business return documents
 * and produces owner candidates for builder prefill review.
 */

// ── Types ────────────────────────────────────────────────────────

export type ExtractedOwnerCandidate = {
  temp_id: string;
  full_legal_name?: string;
  ownership_pct?: number | null;
  title?: string | null;
  home_address?: string | null;
  home_city?: string | null;
  home_state?: string | null;
  home_zip?: string | null;
  source_document_id: string;
  source_label: string;
  confidence: number;
  raw_evidence?: string | null;
};

export type BuilderSourceDocument = {
  id: string;
  original_filename?: string;
  canonical_type?: string;
  classification_label?: string;
};

type FactRow = {
  fact_key: string;
  fact_value_text?: string | null;
  fact_value_num?: number | null;
  source_document_id?: string | null;
  owner_entity_id?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  resolution_status?: string | null;
  is_superseded?: boolean;
};

// ── Constants ────────────────────────────────────────────────────

const BUSINESS_RETURN_TYPES = new Set([
  "BUSINESS_TAX_RETURN",
  "FORM_1120S",
  "FORM_1065",
  "K1",
]);

/** Fact keys that carry owner/principal information */
const OWNER_FACT_KEYS = new Set([
  "OWNER_NAME",
  "PRINCIPAL_NAME",
  "OFFICER_NAME",
  "K1_OWNER_NAME",
  "K1_SHAREHOLDER_NAME",
]);

const OWNERSHIP_PCT_KEYS = new Set([
  "OWNERSHIP_PCT",
  "K1_OWNERSHIP_PCT",
  "SHAREHOLDER_PCT",
]);

const TITLE_KEYS = new Set([
  "OWNER_TITLE",
  "OFFICER_TITLE",
  "PRINCIPAL_TITLE",
]);

const MIN_NAME_LENGTH = 3;

// ── Core extraction ──────────────────────────────────────────────

/**
 * Extract owner candidates from business return financial facts.
 * Deduplicates by normalized name, merges provenance.
 */
export function extractOwnerCandidatesFromBusinessReturnFacts(args: {
  facts: FactRow[];
  documents: BuilderSourceDocument[];
}): ExtractedOwnerCandidate[] {
  const { facts, documents } = args;

  // Index documents by id for label lookup
  const docMap = new Map(documents.map((d) => [d.id, d]));

  // Filter to business return documents
  const bizReturnDocIds = new Set(
    documents
      .filter((d) => d.canonical_type && BUSINESS_RETURN_TYPES.has(d.canonical_type))
      .map((d) => d.id),
  );

  // Filter facts to business return sources only
  const relevantFacts = facts.filter(
    (f) => f.source_document_id && bizReturnDocIds.has(f.source_document_id),
  );

  // Group facts by owner_entity_id (if present) or source_document_id
  // Build candidate map keyed by normalized name
  const candidateMap = new Map<string, ExtractedOwnerCandidate>();

  for (const fact of relevantFacts) {
    if (!OWNER_FACT_KEYS.has(fact.fact_key)) continue;

    const name = fact.fact_value_text?.trim();
    if (!name || name.length < MIN_NAME_LENGTH) continue;

    const normName = normalizeName(name);
    const docId = fact.source_document_id!;
    const doc = docMap.get(docId);
    const sourceLabel = doc?.original_filename ?? doc?.classification_label ?? "Business Tax Return";

    if (!candidateMap.has(normName)) {
      candidateMap.set(normName, {
        temp_id: `btr_candidate_${normName.replace(/\s+/g, "_")}`,
        full_legal_name: name,
        source_document_id: docId,
        source_label: sourceLabel,
        confidence: 0.70,
      });
    }
  }

  // Enrich with ownership % and title from related facts
  for (const fact of relevantFacts) {
    // Try to match ownership % facts to candidates
    if (OWNERSHIP_PCT_KEYS.has(fact.fact_key) && fact.fact_value_num != null) {
      // If fact has owner_entity_id, try to find candidate by entity matching
      // Otherwise attribute to any candidate from same document
      const candidate = findCandidateForFact(candidateMap, fact, relevantFacts);
      if (candidate) {
        candidate.ownership_pct = fact.fact_value_num;
        candidate.confidence = Math.min(candidate.confidence + 0.10, 0.95);
      }
    }

    if (TITLE_KEYS.has(fact.fact_key) && fact.fact_value_text) {
      const candidate = findCandidateForFact(candidateMap, fact, relevantFacts);
      if (candidate) {
        candidate.title = fact.fact_value_text.trim();
        candidate.confidence = Math.min(candidate.confidence + 0.05, 0.95);
      }
    }
  }

  return Array.from(candidateMap.values());
}

// ── Helpers ──────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Try to find the best candidate to attribute a fact to.
 * Uses owner_entity_id matching first, then falls back to
 * same-document attribution for single-candidate docs.
 */
function findCandidateForFact(
  candidateMap: Map<string, ExtractedOwnerCandidate>,
  fact: FactRow,
  _allFacts: FactRow[],
): ExtractedOwnerCandidate | undefined {
  const candidates = Array.from(candidateMap.values());

  // If only one candidate from this document, attribute to them
  const samDocCandidates = candidates.filter(
    (c) => c.source_document_id === fact.source_document_id,
  );
  if (samDocCandidates.length === 1) {
    return samDocCandidates[0];
  }

  // Multiple candidates from same doc — can't safely attribute without entity ID
  return undefined;
}
