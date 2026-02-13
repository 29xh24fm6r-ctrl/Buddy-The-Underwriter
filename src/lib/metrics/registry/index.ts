/**
 * Phase 12 — Metric Registry Versioning
 *
 * Public API for versioned, immutable metric registry.
 */

export type {
  RegistryStatus,
  RegistryVersion,
  RegistryEntry,
  RegistryBinding,
} from "./types";

export {
  canonicalizeEntryJson,
  hashEntry,
  canonicalizeRegistryJson,
  hashRegistry,
  hashOutputs,
} from "./hash";

export {
  selectActiveVersion,
  loadVersionById,
  loadVersionEntries,
  resolveRegistryBinding,
  publishVersion,
} from "./selectActiveVersion";
