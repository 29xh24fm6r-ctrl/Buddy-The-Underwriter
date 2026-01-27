/**
 * Typed accessors for the canonical Omega mapping.
 *
 * Server-only. Read-only. Loads docs/omega/mapping.json and exposes typed
 * getters. The mapping file is the single authoritative source — no inline
 * duplication is permitted elsewhere in code.
 */

import mappingData from "../../../docs/omega/mapping.json";

// ---------------------------------------------------------------------------
// Types — derived from mapping.json schema
// ---------------------------------------------------------------------------

export interface EntityLink {
  entity_type: string;
  id_path: string;
  optional?: boolean;
}

export interface EntityMapping {
  entity_type: string;
  omega_uri_template: string;
  buddy_primary_key: string;
  buddy_sources: string[];
  pii_rules: string[];
  notes: string;
}

export interface EventMapping {
  buddy_event_type: string;
  omega_event_type: string;
  omega_write_resource: string;
  entity_links: EntityLink[];
  payload_contract: string;
  redaction_profile: string;
}

export interface StateView {
  omega_state_uri_template: string;
  driven_by_events: string[];
  must_match_buddy_exports: string[];
  notes: string;
}

export interface ConstraintMapping {
  namespace: string;
  omega_constraints_resource: string;
  applies_to: string[];
  source_files: string[];
  notes: string;
}

export interface RedactionProfile {
  profile_name: string;
  description: string;
  deny_fields: string[];
  mask_fields: string[];
  hash_fields: string[];
  notes: string;
}

export interface OmegaMapping {
  version: string;
  ownership: {
    source_of_truth: string;
    operational_store: string;
    event_bus: string;
    audit_artifacts: string;
  };
  entities: EntityMapping[];
  events: EventMapping[];
  state_views: StateView[];
  constraints: ConstraintMapping[];
  redaction: RedactionProfile[];
}

// ---------------------------------------------------------------------------
// Validate minimal schema at import time
// ---------------------------------------------------------------------------

function assertMapping(m: unknown): asserts m is OmegaMapping {
  const obj = m as Record<string, unknown>;
  if (typeof obj.version !== "string") throw new Error("mapping.json missing version");
  if (!Array.isArray(obj.entities)) throw new Error("mapping.json missing entities[]");
  if (!Array.isArray(obj.events)) throw new Error("mapping.json missing events[]");
  if (!Array.isArray(obj.state_views)) throw new Error("mapping.json missing state_views[]");
  if (!Array.isArray(obj.constraints)) throw new Error("mapping.json missing constraints[]");
  if (!Array.isArray(obj.redaction)) throw new Error("mapping.json missing redaction[]");
}

assertMapping(mappingData);

const mapping: OmegaMapping = mappingData as OmegaMapping;

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

/**
 * Get entity mapping by entity type. Returns undefined if not found.
 */
export function getEntityMapping(entityType: string): EntityMapping | undefined {
  return mapping.entities.find((e) => e.entity_type === entityType);
}

/**
 * Get event mapping by Buddy event type string. Returns undefined if not found.
 */
export function getEventMapping(buddyEventType: string): EventMapping | undefined {
  return mapping.events.find((e) => e.buddy_event_type === buddyEventType);
}

/**
 * Get state view by URI template. Returns undefined if not found.
 */
export function getStateView(uriTemplate: string): StateView | undefined {
  return mapping.state_views.find((s) => s.omega_state_uri_template === uriTemplate);
}

/**
 * Get redaction profile by name. Returns undefined if not found.
 */
export function getRedactionProfile(name: string): RedactionProfile | undefined {
  return mapping.redaction.find((r) => r.profile_name === name);
}

/**
 * Get constraint mapping by namespace. Returns undefined if not found.
 */
export function getConstraintMapping(namespace: string): ConstraintMapping | undefined {
  return mapping.constraints.find((c) => c.namespace === namespace);
}

/**
 * Return the full mapping (read-only reference).
 */
export function getFullMapping(): Readonly<OmegaMapping> {
  return mapping;
}
