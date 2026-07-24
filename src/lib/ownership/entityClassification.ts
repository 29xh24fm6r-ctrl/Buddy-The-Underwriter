// src/lib/ownership/entityClassification.ts
//
// Shared person-vs-entity classification for ownership_entities rows.
// entity_type alone is not reliable: it's a fragmented vocabulary across
// writers ('person'/'company' from ownership/engine.ts, 'individual'
// defaulting to 'llc' from propagateBorrowerFacts.ts, 'individual'|'entity'
// from extractFactsFromDocument.ts) with no DB CHECK constraint enforcing
// it. Combine the entity_type check with the name-suffix heuristic
// (originally private to buildManagementPrincipals.ts) for a signal
// reliable enough to drive hard completeness gates.

const ENTITY_SUFFIX_RE = /\b(llc|inc|corp|ltd|lp|llp|pllc|co|company)\b/i;

const INDIVIDUAL_ENTITY_TYPES = new Set(["individual", "person"]);

export function isIndividualEntityType(entityType: string | null | undefined): boolean {
  return entityType != null && INDIVIDUAL_ENTITY_TYPES.has(entityType);
}

export function isLikelyEntityName(name: string, borrowerName: string | null, dealName: string | null): boolean {
  if (!name) return true;
  const lower = name.toLowerCase().trim();
  if (lower === "borrower" || lower === "unknown") return true;
  const borrowerLower = (borrowerName ?? "").toLowerCase().trim();
  const dealLower = (dealName ?? "").toLowerCase().trim();
  if (borrowerLower && lower === borrowerLower) return true;
  if (dealLower && lower === dealLower) return true;
  if (ENTITY_SUFFIX_RE.test(name)) return true;
  return false;
}

/**
 * Positive-evidence-only individual-owner check for hard completeness
 * gates. Returns true only on a clear signal this owner is a person, not
 * an entity — an explicit individual/person entity_type, OR a name that
 * doesn't look like an entity and isn't the borrower/deal name itself.
 * Ambiguous or missing data returns false (fail closed — never blocks a
 * legitimate deal on absent data).
 */
export function isLikelyIndividualOwner(
  owner: { display_name?: string | null; entity_type?: string | null },
  borrowerName: string | null,
  dealName: string | null,
): boolean {
  if (isIndividualEntityType(owner.entity_type)) return true;
  const name = owner.display_name ?? "";
  if (!name) return false;
  return !isLikelyEntityName(name, borrowerName, dealName);
}
