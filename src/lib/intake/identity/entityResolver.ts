/**
 * entityResolver — deterministic entity resolution from document signals.
 *
 * PURE module: no DB, no IO, no side effects, no imports from other Buddy
 * modules, no "server-only".
 *
 * Resolves which deal entity a document belongs to using a priority-ordered
 * set of deterministic tiers. Ambiguity (multiple candidates at same tier)
 * always routes to review — never guesses between entities.
 *
 * Privacy: Only last 4 digits of EIN/SSN are ever compared or stored.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityCandidate = {
  entityId: string;
  entityRole: "borrower" | "guarantor" | "operating" | "holding";
  legalName: string;
  einLast4: string | null; // never full EIN
  ssnLast4: string | null; // never full SSN
  normalizedNameTokens: string[];
};

export type EntityEvidence = {
  signal: string;
  matchedText: string;
  candidateId: string;
  confidence: number;
};

export type EntityResolutionTier =
  | "ein_match"
  | "ssn_match"
  | "name_exact"
  | "name_fuzzy"
  | "filename_hint"
  | "role_inference"
  | "none";

export type EntityResolution = {
  entityId: string | null;
  entityRole: string | null;
  confidence: number;
  ambiguous: boolean;
  tier: EntityResolutionTier;
  evidence: EntityEvidence[];
};

export type EntityTextSignals = {
  text: string;
  filename: string;
  hasEin: boolean;
  hasSsn: boolean;
};

// ---------------------------------------------------------------------------
// Helpers — normalization
// ---------------------------------------------------------------------------

/** Normalize a legal name to lowercase tokens, stripping punctuation + suffixes. */
function normalizeNameTokens(name: string): string[] {
  if (!name) return [];
  const suffixes = /\b(inc|llc|llp|lp|corp|corporation|company|co|ltd|limited|partnership|pllc|pc|pa)\b/gi;
  const cleaned = name
    .toLowerCase()
    .replace(suffixes, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.split(" ").filter(Boolean);
}

/** Extract last 4 digits of all EIN-like patterns (XX-XXXXXXX). */
function extractEinLast4s(text: string): string[] {
  const re = /\b\d{2}-?\d{7}\b/g;
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const digits = m[0].replace(/-/g, "");
    results.push(digits.slice(-4));
  }
  return [...new Set(results)];
}

/** Extract last 4 digits of all SSN-like patterns (XXX-XX-XXXX or ***-**-XXXX). */
function extractSsnLast4s(text: string): string[] {
  // Full SSN: 3-2-4 digit pattern
  const reFull = /\b\d{3}-\d{2}-(\d{4})\b/g;
  // Masked SSN: ***-**-XXXX
  const reMasked = /\*{2,3}-\*{2}-(\d{4})\b/g;
  const results: string[] = [];

  let m: RegExpExecArray | null;
  while ((m = reFull.exec(text)) !== null) {
    results.push(m[1]);
  }
  while ((m = reMasked.exec(text)) !== null) {
    results.push(m[1]);
  }
  return [...new Set(results)];
}

/** Token overlap ratio: |intersection| / |smaller set|. */
function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const intersection = a.filter((t) => setB.has(t));
  const smaller = Math.min(a.length, b.length);
  return intersection.length / smaller;
}

// ---------------------------------------------------------------------------
// Tier evaluators
// ---------------------------------------------------------------------------

type TierMatch = {
  tier: EntityResolutionTier;
  candidateIds: string[];
  evidence: EntityEvidence[];
};

/** Tier 1: EIN last4 exact match (confidence 0.95). */
function matchByEin(
  text: string,
  candidates: EntityCandidate[],
): TierMatch | null {
  const docEins = extractEinLast4s(text);
  if (docEins.length === 0) return null;

  const matched: string[] = [];
  const evidence: EntityEvidence[] = [];

  for (const ein4 of docEins) {
    for (const c of candidates) {
      if (c.einLast4 && c.einLast4 === ein4) {
        if (!matched.includes(c.entityId)) {
          matched.push(c.entityId);
        }
        evidence.push({
          signal: "ein_last4_match",
          matchedText: `****${ein4}`,
          candidateId: c.entityId,
          confidence: 0.95,
        });
      }
    }
  }

  if (matched.length === 0) return null;
  return { tier: "ein_match", candidateIds: matched, evidence };
}

/** Tier 2: SSN last4 exact match for personal docs (confidence 0.85). */
function matchBySsn(
  text: string,
  candidates: EntityCandidate[],
): TierMatch | null {
  const docSsns = extractSsnLast4s(text);
  if (docSsns.length === 0) return null;

  const matched: string[] = [];
  const evidence: EntityEvidence[] = [];

  for (const ssn4 of docSsns) {
    for (const c of candidates) {
      if (c.ssnLast4 && c.ssnLast4 === ssn4) {
        if (!matched.includes(c.entityId)) {
          matched.push(c.entityId);
        }
        evidence.push({
          signal: "ssn_last4_match",
          matchedText: `***-**-${ssn4}`,
          candidateId: c.entityId,
          confidence: 0.85,
        });
      }
    }
  }

  if (matched.length === 0) return null;
  return { tier: "ssn_match", candidateIds: matched, evidence };
}

/** Tier 3: Normalized name exact match (confidence 0.85). */
function matchByNameExact(
  text: string,
  candidates: EntityCandidate[],
): TierMatch | null {
  const textLower = text.toLowerCase();
  const matched: string[] = [];
  const evidence: EntityEvidence[] = [];

  for (const c of candidates) {
    if (!c.legalName) continue;
    const nameLower = c.legalName.toLowerCase().trim();
    if (nameLower.length < 3) continue; // Too short to be meaningful

    if (textLower.includes(nameLower)) {
      if (!matched.includes(c.entityId)) {
        matched.push(c.entityId);
      }
      evidence.push({
        signal: "name_exact_match",
        matchedText: c.legalName,
        candidateId: c.entityId,
        confidence: 0.85,
      });
    }
  }

  if (matched.length === 0) return null;
  return { tier: "name_exact", candidateIds: matched, evidence };
}

/** Tier 4: Normalized name fuzzy match (≥80% token overlap, confidence 0.70). */
function matchByNameFuzzy(
  text: string,
  candidates: EntityCandidate[],
): TierMatch | null {
  const textTokens = normalizeNameTokens(text);
  if (textTokens.length === 0) return null;

  const matched: string[] = [];
  const evidence: EntityEvidence[] = [];

  for (const c of candidates) {
    if (c.normalizedNameTokens.length === 0) continue;
    const overlap = tokenOverlap(c.normalizedNameTokens, textTokens);
    if (overlap >= 0.80) {
      if (!matched.includes(c.entityId)) {
        matched.push(c.entityId);
      }
      evidence.push({
        signal: "name_fuzzy_match",
        matchedText: c.legalName,
        candidateId: c.entityId,
        confidence: 0.70,
      });
    }
  }

  if (matched.length === 0) return null;
  return { tier: "name_fuzzy", candidateIds: matched, evidence };
}

/** Tier 5: Filename hint — entity name in filename (confidence 0.50). */
function matchByFilename(
  filename: string,
  candidates: EntityCandidate[],
): TierMatch | null {
  if (!filename) return null;
  const fnameLower = filename.toLowerCase();
  const matched: string[] = [];
  const evidence: EntityEvidence[] = [];

  for (const c of candidates) {
    if (!c.legalName) continue;
    // Check if meaningful portion of entity name appears in filename
    const nameTokens = c.normalizedNameTokens;
    if (nameTokens.length === 0) continue;
    // Require at least 2 tokens or the full single-token name
    const minTokens = nameTokens.length === 1 ? 1 : 2;
    const matchCount = nameTokens.filter((t) => fnameLower.includes(t)).length;
    if (matchCount >= minTokens) {
      if (!matched.includes(c.entityId)) {
        matched.push(c.entityId);
      }
      evidence.push({
        signal: "filename_hint",
        matchedText: filename,
        candidateId: c.entityId,
        confidence: 0.50,
      });
    }
  }

  if (matched.length === 0) return null;
  return { tier: "filename_hint", candidateIds: matched, evidence };
}

/** Tier 6: Role inference — single candidate of matching role (confidence 0.40). */
function matchByRoleInference(
  entityType: "business" | "personal" | null,
  candidates: EntityCandidate[],
): TierMatch | null {
  if (!entityType) return null;

  // Map entity type to expected roles
  const expectedRoles: string[] =
    entityType === "personal"
      ? ["guarantor", "borrower"]
      : ["operating", "holding", "borrower"];

  const roleMatches = candidates.filter((c) =>
    expectedRoles.includes(c.entityRole),
  );

  if (roleMatches.length !== 1) return null; // Only match if unambiguous

  const c = roleMatches[0];
  return {
    tier: "role_inference",
    candidateIds: [c.entityId],
    evidence: [
      {
        signal: "role_inference",
        matchedText: `${entityType} → ${c.entityRole}`,
        candidateId: c.entityId,
        confidence: 0.40,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve which deal entity a document belongs to.
 *
 * Evaluation is strict priority order — first tier with any match wins.
 * If multiple candidates match at the same tier → ambiguous = true.
 *
 * @param textSignals - Document text, filename, and EIN/SSN detection flags
 * @param dealEntities - Candidate entities from the deal
 * @param entityType - Optional document entity type from classification
 * @returns EntityResolution with the resolved entity (or null if no match)
 */
export function resolveEntity(
  textSignals: EntityTextSignals,
  dealEntities: EntityCandidate[],
  entityType?: "business" | "personal" | null,
): EntityResolution {
  const { text, filename, hasEin, hasSsn } = textSignals;

  if (dealEntities.length === 0) {
    return {
      entityId: null,
      entityRole: null,
      confidence: 0,
      ambiguous: false,
      tier: "none",
      evidence: [],
    };
  }

  // Ordered tier evaluators — first match wins
  const tiers: (TierMatch | null)[] = [];

  // Only attempt EIN matching if document signals indicate EIN presence
  if (hasEin) {
    tiers.push(matchByEin(text, dealEntities));
  }

  // Only attempt SSN matching if document signals indicate SSN presence
  if (hasSsn) {
    tiers.push(matchBySsn(text, dealEntities));
  }

  // Name-based tiers always attempted
  tiers.push(matchByNameExact(text, dealEntities));
  tiers.push(matchByNameFuzzy(text, dealEntities));
  tiers.push(matchByFilename(filename, dealEntities));

  // Role inference — weakest, only if entityType known
  tiers.push(matchByRoleInference(entityType ?? null, dealEntities));

  // Find the first tier with a match
  for (const tierResult of tiers) {
    if (!tierResult) continue;

    const uniqueIds = [...new Set(tierResult.candidateIds)];

    if (uniqueIds.length === 1) {
      // Unambiguous match
      const entity = dealEntities.find((e) => e.entityId === uniqueIds[0]);
      return {
        entityId: uniqueIds[0],
        entityRole: entity?.entityRole ?? null,
        confidence: tierResult.evidence[0]?.confidence ?? 0,
        ambiguous: false,
        tier: tierResult.tier,
        evidence: tierResult.evidence,
      };
    }

    // Multiple candidates at same tier → ambiguous
    return {
      entityId: null,
      entityRole: null,
      confidence: tierResult.evidence[0]?.confidence ?? 0,
      ambiguous: true,
      tier: tierResult.tier,
      evidence: tierResult.evidence,
    };
  }

  // No tier matched
  return {
    entityId: null,
    entityRole: null,
    confidence: 0,
    ambiguous: false,
    tier: "none",
    evidence: [],
  };
}

/**
 * Build EntityCandidate from raw entity data.
 * Utility for callers who have raw entity records.
 */
export function buildEntityCandidate(raw: {
  id: string;
  entityKind: string;
  legalName: string;
  ein?: string | null;
  ssnLast4?: string | null;
}): EntityCandidate {
  const roleMap: Record<string, EntityCandidate["entityRole"]> = {
    OPCO: "operating",
    PROPCO: "operating",
    HOLDCO: "holding",
    PERSON: "guarantor",
  };

  const einLast4 =
    raw.ein && raw.ein.replace(/-/g, "").length >= 4
      ? raw.ein.replace(/-/g, "").slice(-4)
      : null;

  return {
    entityId: raw.id,
    entityRole: roleMap[raw.entityKind] ?? "borrower",
    legalName: raw.legalName,
    einLast4,
    ssnLast4: raw.ssnLast4 ?? null,
    normalizedNameTokens: normalizeNameTokens(raw.legalName),
  };
}
