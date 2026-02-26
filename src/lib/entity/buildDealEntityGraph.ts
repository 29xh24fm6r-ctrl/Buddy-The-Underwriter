/**
 * Buddy Deal Entity Graph Builder — v1.0.0
 *
 * Pure function. No server-only, no DB, no IO.
 *
 * Builds an authoritative DealEntityGraph from raw deal entity data + slot bindings.
 * Deduplicates by EIN/SSN/name fingerprint, resolves roles, detects ambiguity.
 *
 * Invariants:
 *   1. Graph.entities.length >= 1 (never empty)
 *   2. primaryBorrowerId always set and references a real entity in the graph
 *   3. Fingerprint is deterministic and stable
 *   4. GROUP entities are always excluded
 */

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const DEAL_ENTITY_GRAPH_VERSION = "v1.0.0" as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DealEntityRole = "BORROWER" | "GUARANTOR" | "OPERATING_CO" | "HOLDCO";

export type DealEntityType = "PERSON" | "BUSINESS";

export interface DealEntity {
  entityId: string;
  role: DealEntityRole;
  entityType: DealEntityType;
  taxFormSignatures: string[];
  fingerprint: string;
}

export interface DealEntityGraph {
  entities: DealEntity[];
  primaryBorrowerId: string;
  ambiguityFlags: {
    duplicateTaxForms: boolean;
    overlappingRoles: boolean;
  };
  version: "v1.0.0";
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type EntityKind = "OPCO" | "PROPCO" | "HOLDCO" | "PERSON" | "GROUP";

export type RawDealEntity = {
  id: string;
  entityKind: EntityKind;
  name: string;
  legalName: string | null;
  ein: string | null;
  ssnLast4: string | null;
  synthetic: boolean;
};

export type EntitySlotBinding = {
  requiredDocType: string;
  requiredEntityId: string | null;
  requiredEntityRole: string | null;
};

export type BuildGraphInput = {
  entities: RawDealEntity[];
  slotBindings: EntitySlotBinding[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maps slot doc type → expected tax form signatures for that doc type. */
const DOC_TYPE_FORM_SIGNATURES: Record<string, string[]> = {
  BUSINESS_TAX_RETURN: ["1120", "1120S", "1065"],
  PERSONAL_TAX_RETURN: ["1040"],
  PERSONAL_FINANCIAL_STATEMENT: ["PFS"],
  K1: ["K-1"],
};

/** Fallback form signatures when no slots are bound to an entity. */
const DEFAULT_FORM_SIGNATURES: Record<string, string[]> = {
  OPCO: ["1120", "1120S", "1065"],
  PROPCO: ["1120", "1120S", "1065"],
  HOLDCO: ["1120", "1120S", "1065"],
  PERSON: ["1040"],
};

// ---------------------------------------------------------------------------
// Fingerprint computation
// ---------------------------------------------------------------------------

/**
 * Compute a stable, deterministic fingerprint for deduplication.
 *
 * Priority: EIN > SSN > normalized name.
 * All fingerprints are prefixed with their type for collision avoidance.
 */
export function computeFingerprint(entity: RawDealEntity): string {
  if (entity.ein) {
    return `ein:${entity.ein.replace(/\D/g, "")}`;
  }
  if (entity.ssnLast4) {
    return `ssn:${entity.ssnLast4.replace(/\D/g, "")}`;
  }
  const normalized = (entity.legalName ?? entity.name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
  return `name:${normalized}`;
}

// ---------------------------------------------------------------------------
// Role + type mapping
// ---------------------------------------------------------------------------

function mapEntityKindToRole(
  entityKind: EntityKind,
  slotRole: string | null,
): DealEntityRole {
  switch (entityKind) {
    case "OPCO":
    case "PROPCO":
      return "OPERATING_CO";
    case "HOLDCO":
      return "HOLDCO";
    case "PERSON":
      if (slotRole === "guarantor") return "GUARANTOR";
      return "BORROWER";
    default:
      return "BORROWER";
  }
}

function mapEntityKindToType(entityKind: EntityKind): DealEntityType {
  return entityKind === "PERSON" ? "PERSON" : "BUSINESS";
}

// ---------------------------------------------------------------------------
// Tax form signatures
// ---------------------------------------------------------------------------

function buildTaxFormSignatures(
  slotDocTypes: Set<string>,
  entityKind: EntityKind,
): string[] {
  const signatures = new Set<string>();

  for (const dt of slotDocTypes) {
    const sigs = DOC_TYPE_FORM_SIGNATURES[dt];
    if (sigs) {
      for (const s of sigs) signatures.add(s);
    }
  }

  if (signatures.size === 0) {
    const defaults = DEFAULT_FORM_SIGNATURES[entityKind] ?? [];
    for (const s of defaults) signatures.add(s);
  }

  return [...signatures].sort();
}

// ---------------------------------------------------------------------------
// Ambiguity detection
// ---------------------------------------------------------------------------

function detectDuplicateTaxForms(entities: DealEntity[]): boolean {
  const seen = new Set<string>();
  for (const e of entities) {
    for (const sig of e.taxFormSignatures) {
      if (seen.has(sig)) return true;
      seen.add(sig);
    }
  }
  return false;
}

function detectOverlappingRoles(
  fpGroups: Map<string, RawDealEntity[]>,
  slotsByEntity: Map<string, { roles: Set<string> }>,
): boolean {
  for (const [, group] of fpGroups) {
    const allRoles = new Set<string>();
    for (const e of group) {
      const bindings = slotsByEntity.get(e.id);
      if (bindings) {
        for (const r of bindings.roles) allRoles.add(r);
      }
    }
    if (allRoles.size > 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Primary borrower resolution
// ---------------------------------------------------------------------------

/**
 * Determine primaryBorrowerId.
 *
 * In institutional/commercial lending, the operating company is the primary
 * borrower. For personal lending, the individual borrower takes priority.
 *
 * Priority: OPERATING_CO > BORROWER > HOLDCO > first entity.
 */
function resolvePrimaryBorrowerId(entities: DealEntity[]): string {
  const opco = entities.find((e) => e.role === "OPERATING_CO");
  if (opco) return opco.entityId;

  const borrower = entities.find((e) => e.role === "BORROWER");
  if (borrower) return borrower.entityId;

  const holdco = entities.find((e) => e.role === "HOLDCO");
  if (holdco) return holdco.entityId;

  return entities[0].entityId;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an authoritative DealEntityGraph from raw deal entities and slot bindings.
 *
 * Steps:
 *   1. Filter out GROUP entities
 *   2. Compute fingerprints and group by fingerprint (dedup)
 *   3. For each group, select representative (prefer non-synthetic)
 *   4. Resolve role from entity kind + slot role bindings
 *   5. Build tax form signatures from slot doc types (or entity kind defaults)
 *   6. Detect ambiguity flags
 *   7. Resolve primary borrower
 *
 * @throws Error if no entities remain after GROUP filter
 */
export function buildDealEntityGraph(input: BuildGraphInput): DealEntityGraph {
  const { entities: rawEntities, slotBindings } = input;

  // Step 1: Filter out GROUP entities
  const filtered = rawEntities.filter((e) => e.entityKind !== "GROUP");

  if (filtered.length === 0) {
    throw new Error(
      "buildDealEntityGraph: no entities after GROUP filter — caller must ensure entities exist",
    );
  }

  // Build slot binding lookup: entityId → { docTypes, roles }
  const slotsByEntity = new Map<
    string,
    { docTypes: Set<string>; roles: Set<string> }
  >();
  for (const sb of slotBindings) {
    if (!sb.requiredEntityId) continue;
    let entry = slotsByEntity.get(sb.requiredEntityId);
    if (!entry) {
      entry = { docTypes: new Set(), roles: new Set() };
      slotsByEntity.set(sb.requiredEntityId, entry);
    }
    entry.docTypes.add(sb.requiredDocType);
    if (sb.requiredEntityRole) entry.roles.add(sb.requiredEntityRole);
  }

  // Step 2: Compute fingerprints and group
  const fpGroups = new Map<string, RawDealEntity[]>();
  for (const entity of filtered) {
    const fp = computeFingerprint(entity);
    const group = fpGroups.get(fp) ?? [];
    group.push(entity);
    fpGroups.set(fp, group);
  }

  // Step 3-5: Build deduplicated entities
  const dealEntities: DealEntity[] = [];

  for (const [fp, group] of fpGroups) {
    // Prefer non-synthetic entity as representative
    const representative = group.find((e) => !e.synthetic) ?? group[0];

    // Collect all slot bindings across group members
    const allDocTypes = new Set<string>();
    const allRoles = new Set<string>();
    for (const e of group) {
      const bindings = slotsByEntity.get(e.id);
      if (bindings) {
        for (const dt of bindings.docTypes) allDocTypes.add(dt);
        for (const r of bindings.roles) allRoles.add(r);
      }
    }

    // Determine role (first slot role wins for PERSON entities)
    const slotRole = allRoles.size > 0 ? [...allRoles][0] : null;
    const role = mapEntityKindToRole(representative.entityKind, slotRole);

    // Build tax form signatures
    const taxFormSignatures = buildTaxFormSignatures(
      allDocTypes,
      representative.entityKind,
    );

    dealEntities.push({
      entityId: representative.id,
      role,
      entityType: mapEntityKindToType(representative.entityKind),
      taxFormSignatures,
      fingerprint: fp,
    });
  }

  // Step 6: Detect ambiguity
  const duplicateTaxForms = detectDuplicateTaxForms(dealEntities);
  const overlappingRoles = detectOverlappingRoles(fpGroups, slotsByEntity);

  // Step 7: Resolve primary borrower
  const primaryBorrowerId = resolvePrimaryBorrowerId(dealEntities);

  return {
    entities: dealEntities,
    primaryBorrowerId,
    ambiguityFlags: {
      duplicateTaxForms,
      overlappingRoles,
    },
    version: DEAL_ENTITY_GRAPH_VERSION,
  };
}
