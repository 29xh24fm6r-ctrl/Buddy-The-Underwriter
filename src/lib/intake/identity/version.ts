/**
 * Identity Layer version constant.
 *
 * Emitted in every identity-instrumented event (classification.decided,
 * match.*) so that all identity metadata is fully auditable and
 * version-tracked across engine upgrades.
 *
 * v1.0 — observability only: identity metadata emitted but never used
 * to expand or restrict auto-attach authority.
 * v1.1 — enforcement (safety mode): identity used to block cross-entity
 * auto-attach and upgrade silent no_match to routed_to_review.
 * v1.2 — precision (controlled expansion): entity-assisted candidate ranking
 * in matchEngine.ts (feature-flagged ENABLE_ENTITY_PRECISION).
 */
export const ENTITY_GRAPH_VERSION = 1;

/**
 * Minimum entity resolution confidence required to activate the
 * identity enforcement layer in runMatch.ts.
 *
 * Below this threshold, entity mismatch does not trigger enforcement —
 * fail-open is preserved. Set above the fuzzy name-match tier and below
 * the deterministic EIN-match tier.
 *
 * CI-locked: identityEnforcementGuard.test.ts asserts this value === 0.75.
 */
export const ENTITY_PROTECTION_THRESHOLD = 0.75;

/**
 * Minimum entity resolution confidence required to activate the
 * identity precision ranking layer in matchEngine.ts.
 *
 * Above ENTITY_PROTECTION_THRESHOLD (0.75). Approaching the deterministic
 * EIN-match tier. Avoids fuzzy-only name matches. Conservative expansion.
 *
 * Feature-flagged: ENABLE_ENTITY_PRECISION=false by default.
 * CI-locked: identityPrecisionGuard.test.ts asserts this value >= 0.85.
 */
export const ENTITY_PRECISION_THRESHOLD = 0.85;
