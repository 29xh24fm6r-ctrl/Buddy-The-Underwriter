/**
 * Entity Map — God Tier Phase 2C, Section 1
 *
 * Builds an EntityMap from deal entities and extracted canonical facts.
 * Detects entity roles, ownership structure, and consolidation scope.
 * Pure function — no DB, no server imports.
 */

// ---------------------------------------------------------------------------
// Types — Entity Model (per spec Section 1A)
// ---------------------------------------------------------------------------

export type EntityType =
  | "c_corp"
  | "s_corp"
  | "partnership"
  | "llc_single_member"
  | "llc_multi_member"
  | "sole_proprietor"
  | "individual";

export type TaxForm = "1120" | "1120-S" | "1065" | "1040" | "none";

export type EntityRole =
  | "operating_company"
  | "real_estate_holding"
  | "management_company"
  | "ip_holding"
  | "investment_holding"
  | "personal_holding"
  | "subsidiary"
  | "affiliate";

export type OwnershipEntry = {
  ownerName: string;
  ownerEntityId?: string;
  ownershipPct: number; // 0–100
  ownershipType: "common" | "preferred" | "membership" | "partnership";
  isGuarantor: boolean;
};

export type BorrowerEntity = {
  entityId: string;
  legalName: string;
  ein: string | null;
  entityType: EntityType;
  taxForm: TaxForm;
  role: EntityRole;
  ownershipStructure: OwnershipEntry[];
  primaryNaics: string | null;
  accountingBasis: "cash" | "accrual" | "tax_basis" | "unknown";
  fiscalYearEnd: string | null; // MM-DD
  isPrimaryBorrower: boolean;
  isGuarantorEntity: boolean;
  documentIds: string[];
};

// ---------------------------------------------------------------------------
// Types — Relationships (per spec Section 1B)
// ---------------------------------------------------------------------------

export type RelationshipType =
  | "parent_subsidiary"
  | "common_control"
  | "affiliated"
  | "guarantor_relationship";

export type ControlType =
  | "majority"
  | "minority"
  | "common_control"
  | "affiliated";

export type EntityRelationship = {
  relationshipId: string;
  parentEntityId: string;
  childEntityId: string;
  relationshipType: RelationshipType;
  ownershipPct: number;
  controlType: ControlType;
  consolidationRequired: boolean;
};

// ---------------------------------------------------------------------------
// Types — Consolidation Scope (per spec Section 1C)
// ---------------------------------------------------------------------------

export type ConsolidationMethod =
  | "full_consolidation"
  | "proportionate"
  | "equity_method"
  | "global_cash_flow"
  | "combined";

export type ConsolidationScope = {
  method: ConsolidationMethod;
  entitiesInScope: string[];
  entitiesExcluded: string[];
  exclusionReasons: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Types — EntityMap (top-level per spec Section 1A)
// ---------------------------------------------------------------------------

export type EntityMap = {
  dealId: string;
  entities: BorrowerEntity[];
  relationships: EntityRelationship[];
  consolidationScope: ConsolidationScope;
  version: number;
};

// ---------------------------------------------------------------------------
// Types — Input for building the map
// ---------------------------------------------------------------------------

export type EntityFactSet = {
  entityId: string;
  legalName: string;
  ein: string | null;
  facts: Record<string, number | string | boolean | null>;
  documentIds: string[];
};

// ---------------------------------------------------------------------------
// Detection: infer entity type from tax form
// ---------------------------------------------------------------------------

export function inferEntityType(taxForm: TaxForm): EntityType {
  switch (taxForm) {
    case "1120": return "c_corp";
    case "1120-S": return "s_corp";
    case "1065": return "partnership";
    case "1040": return "individual";
    default: return "llc_single_member";
  }
}

// ---------------------------------------------------------------------------
// Detection: infer entity role from facts
// ---------------------------------------------------------------------------

export function inferEntityRole(facts: Record<string, number | string | boolean | null>): EntityRole {
  // RE holding: has rental income, no significant operating revenue
  const rentalIncome = toNum(facts["SCH_E_RENTS_RECEIVED"]) + toNum(facts["NET_RENTAL_INCOME"]);
  const revenue = toNum(facts["TOTAL_REVENUE"]) + toNum(facts["GROSS_RECEIPTS"]);

  if (rentalIncome > 0 && (revenue === 0 || rentalIncome / Math.max(revenue, 1) > 0.7)) {
    return "real_estate_holding";
  }

  // Management company: revenue primarily from management fees (no COGS, small headcount)
  const cogs = toNum(facts["COST_OF_GOODS_SOLD"]);
  const salaries = toNum(facts["SALARIES_WAGES"]);
  if (revenue > 0 && cogs === 0 && salaries > 0 && salaries / revenue > 0.5) {
    return "management_company";
  }

  // IP holding: royalty income dominant
  const royalties = toNum(facts["K1_ROYALTIES"]);
  if (royalties > 0 && revenue > 0 && royalties / revenue > 0.5) {
    return "ip_holding";
  }

  return "operating_company";
}

// ---------------------------------------------------------------------------
// Detection: infer relationships from ownership overlap
// ---------------------------------------------------------------------------

export function inferRelationships(
  entities: BorrowerEntity[],
): EntityRelationship[] {
  const relationships: EntityRelationship[] = [];
  let relId = 0;

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];

      // Check if A owns B
      for (const entry of b.ownershipStructure) {
        if (entry.ownerEntityId === a.entityId && entry.ownershipPct > 0) {
          relationships.push(makeRelationship(
            `rel_${relId++}`, a.entityId, b.entityId, entry.ownershipPct,
          ));
        }
      }

      // Check if B owns A
      for (const entry of a.ownershipStructure) {
        if (entry.ownerEntityId === b.entityId && entry.ownershipPct > 0) {
          relationships.push(makeRelationship(
            `rel_${relId++}`, b.entityId, a.entityId, entry.ownershipPct,
          ));
        }
      }

      // Check common control (same owner names)
      const ownersA = new Set(a.ownershipStructure.map((o) => o.ownerName.toLowerCase()));
      const ownersB = new Set(b.ownershipStructure.map((o) => o.ownerName.toLowerCase()));
      const commonOwners = [...ownersA].filter((o) => ownersB.has(o));
      if (commonOwners.length > 0 && !relationships.some((r) =>
        (r.parentEntityId === a.entityId && r.childEntityId === b.entityId) ||
        (r.parentEntityId === b.entityId && r.childEntityId === a.entityId)
      )) {
        relationships.push({
          relationshipId: `rel_${relId++}`,
          parentEntityId: a.entityId,
          childEntityId: b.entityId,
          relationshipType: "common_control",
          ownershipPct: 0,
          controlType: "common_control",
          consolidationRequired: true,
        });
      }
    }
  }

  return relationships;
}

function makeRelationship(
  id: string, parentId: string, childId: string, pct: number,
): EntityRelationship {
  const isParentSub = pct > 50;
  return {
    relationshipId: id,
    parentEntityId: parentId,
    childEntityId: childId,
    relationshipType: isParentSub ? "parent_subsidiary" : "affiliated",
    ownershipPct: pct,
    controlType: isParentSub ? "majority" : (pct >= 20 ? "minority" : "affiliated"),
    consolidationRequired: isParentSub || pct > 50,
  };
}

// ---------------------------------------------------------------------------
// Consolidation scope determination
// ---------------------------------------------------------------------------

export function determineConsolidationScope(
  entities: BorrowerEntity[],
  relationships: EntityRelationship[],
): ConsolidationScope {
  const inScope: string[] = [];
  const excluded: string[] = [];
  const exclusionReasons: Record<string, string> = {};

  // All entities with relationships requiring consolidation go in scope
  const requiredIds = new Set<string>();
  for (const rel of relationships) {
    if (rel.consolidationRequired || rel.relationshipType === "common_control") {
      requiredIds.add(rel.parentEntityId);
      requiredIds.add(rel.childEntityId);
    }
  }

  // Primary borrower always in scope
  for (const e of entities) {
    if (e.isPrimaryBorrower) requiredIds.add(e.entityId);
  }

  for (const e of entities) {
    if (requiredIds.has(e.entityId)) {
      inScope.push(e.entityId);
    } else if (e.role === "personal_holding" || e.entityType === "individual") {
      excluded.push(e.entityId);
      exclusionReasons[e.entityId] = "Personal/individual entity — handled via global cash flow";
    } else {
      // Include by default if there are relationships
      if (relationships.length > 0) {
        inScope.push(e.entityId);
      } else {
        excluded.push(e.entityId);
        exclusionReasons[e.entityId] = "No relationship detected";
      }
    }
  }

  // Determine method
  let method: ConsolidationMethod = "combined";
  const hasParentSub = relationships.some((r) => r.relationshipType === "parent_subsidiary");
  if (hasParentSub) {
    const minOwnership = Math.min(
      ...relationships.filter((r) => r.relationshipType === "parent_subsidiary").map((r) => r.ownershipPct),
    );
    method = minOwnership >= 50 ? "full_consolidation" : "proportionate";
  }

  return {
    method,
    entitiesInScope: inScope,
    entitiesExcluded: excluded,
    exclusionReasons,
  };
}

// ---------------------------------------------------------------------------
// Build EntityMap (main entry point)
// ---------------------------------------------------------------------------

export function buildEntityMap(
  dealId: string,
  entities: BorrowerEntity[],
): EntityMap {
  const relationships = inferRelationships(entities);
  const consolidationScope = determineConsolidationScope(entities, relationships);

  return {
    dealId,
    entities,
    relationships,
    consolidationScope,
    version: 1,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNum(v: number | string | boolean | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}
