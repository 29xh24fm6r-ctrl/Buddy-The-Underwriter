import "server-only";

// Entity-scoped doc types (pure constant — governance contract)
export { ENTITY_SCOPED_DOC_TYPES } from "../identity/entityScopedDocTypes";

// Server-side entity resolver (loads deal_entities from DB, delegates to pure resolveEntity())
export { resolveDocumentEntityForDeal } from "../identity/resolveDocumentEntity";

// Slot binding orchestration (closes slot ↔ entity gap deterministically)
export { ensureEntityBindings } from "../slots/repair/ensureEntityBindings";

// Pure repair decision engine (zero DB, deterministic, CI-testable)
export { computeRepairDecision } from "../slots/repair/repairDecision";
