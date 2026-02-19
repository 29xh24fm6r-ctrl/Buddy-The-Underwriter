/**
 * Identity Layer version constant.
 *
 * Emitted in every identity-instrumented event (classification.decided,
 * match.*) so that all identity metadata is fully auditable and
 * version-tracked across engine upgrades.
 *
 * v1.0 — observability only: identity metadata emitted but never used
 * to expand or restrict auto-attach authority.
 */
export const ENTITY_GRAPH_VERSION = 1;
