import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inferEntityType,
  inferEntityRole,
  inferRelationships,
  determineConsolidationScope,
  buildEntityMap,
  type BorrowerEntity,
} from "../entityMap";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(overrides: Partial<BorrowerEntity> & { entityId: string }): BorrowerEntity {
  return {
    legalName: "Test Entity",
    ein: null,
    entityType: "s_corp",
    taxForm: "1120-S",
    role: "operating_company",
    ownershipStructure: [],
    primaryNaics: null,
    accountingBasis: "accrual",
    fiscalYearEnd: "12-31",
    isPrimaryBorrower: false,
    isGuarantorEntity: false,
    documentIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// inferEntityType
// ---------------------------------------------------------------------------

describe("inferEntityType", () => {
  it("maps 1120 → c_corp", () => {
    assert.equal(inferEntityType("1120"), "c_corp");
  });

  it("maps 1120-S → s_corp", () => {
    assert.equal(inferEntityType("1120-S"), "s_corp");
  });

  it("maps 1065 → partnership", () => {
    assert.equal(inferEntityType("1065"), "partnership");
  });

  it("maps 1040 → individual", () => {
    assert.equal(inferEntityType("1040"), "individual");
  });

  it("maps none → llc_single_member", () => {
    assert.equal(inferEntityType("none"), "llc_single_member");
  });
});

// ---------------------------------------------------------------------------
// inferEntityRole
// ---------------------------------------------------------------------------

describe("inferEntityRole", () => {
  it("detects real_estate_holding when rental income > 70% of revenue", () => {
    const role = inferEntityRole({
      SCH_E_RENTS_RECEIVED: 800_000,
      TOTAL_REVENUE: 1_000_000,
    });
    assert.equal(role, "real_estate_holding");
  });

  it("detects real_estate_holding when rental income exists and no operating revenue", () => {
    const role = inferEntityRole({
      NET_RENTAL_INCOME: 500_000,
      TOTAL_REVENUE: 0,
    });
    assert.equal(role, "real_estate_holding");
  });

  it("detects management_company when no COGS and high salary ratio", () => {
    const role = inferEntityRole({
      TOTAL_REVENUE: 1_000_000,
      COST_OF_GOODS_SOLD: 0,
      SALARIES_WAGES: 600_000,
    });
    assert.equal(role, "management_company");
  });

  it("detects ip_holding when royalties > 50% of revenue", () => {
    const role = inferEntityRole({
      K1_ROYALTIES: 600_000,
      TOTAL_REVENUE: 1_000_000,
    });
    assert.equal(role, "ip_holding");
  });

  it("defaults to operating_company", () => {
    const role = inferEntityRole({
      TOTAL_REVENUE: 1_000_000,
      COST_OF_GOODS_SOLD: 400_000,
      SALARIES_WAGES: 200_000,
    });
    assert.equal(role, "operating_company");
  });
});

// ---------------------------------------------------------------------------
// inferRelationships
// ---------------------------------------------------------------------------

describe("inferRelationships", () => {
  it("detects parent_subsidiary when ownership > 50%", () => {
    const parent = makeEntity({ entityId: "parent-1", legalName: "Parent Co" });
    const child = makeEntity({
      entityId: "child-1",
      legalName: "Child Co",
      ownershipStructure: [{
        ownerName: "Parent Co",
        ownerEntityId: "parent-1",
        ownershipPct: 80,
        ownershipType: "common",
        isGuarantor: false,
      }],
    });
    const rels = inferRelationships([parent, child]);
    assert.equal(rels.length, 1);
    assert.equal(rels[0].relationshipType, "parent_subsidiary");
    assert.equal(rels[0].parentEntityId, "parent-1");
    assert.equal(rels[0].childEntityId, "child-1");
    assert.equal(rels[0].ownershipPct, 80);
    assert.equal(rels[0].controlType, "majority");
    assert.equal(rels[0].consolidationRequired, true);
  });

  it("detects affiliated when ownership 20-50%", () => {
    const parent = makeEntity({ entityId: "a-1" });
    const child = makeEntity({
      entityId: "b-1",
      ownershipStructure: [{
        ownerName: "A Corp",
        ownerEntityId: "a-1",
        ownershipPct: 35,
        ownershipType: "common",
        isGuarantor: false,
      }],
    });
    const rels = inferRelationships([parent, child]);
    assert.equal(rels.length, 1);
    assert.equal(rels[0].relationshipType, "affiliated");
    assert.equal(rels[0].controlType, "minority");
    assert.equal(rels[0].consolidationRequired, false);
  });

  it("detects common_control via overlapping owner names", () => {
    const entityA = makeEntity({
      entityId: "a-1",
      ownershipStructure: [{
        ownerName: "John Smith",
        ownershipPct: 100,
        ownershipType: "common",
        isGuarantor: false,
      }],
    });
    const entityB = makeEntity({
      entityId: "b-1",
      ownershipStructure: [{
        ownerName: "John Smith",
        ownershipPct: 100,
        ownershipType: "membership",
        isGuarantor: false,
      }],
    });
    const rels = inferRelationships([entityA, entityB]);
    assert.equal(rels.length, 1);
    assert.equal(rels[0].relationshipType, "common_control");
    assert.equal(rels[0].controlType, "common_control");
    assert.equal(rels[0].consolidationRequired, true);
  });

  it("returns empty for unrelated entities", () => {
    const a = makeEntity({ entityId: "a-1" });
    const b = makeEntity({ entityId: "b-1" });
    const rels = inferRelationships([a, b]);
    assert.equal(rels.length, 0);
  });
});

// ---------------------------------------------------------------------------
// determineConsolidationScope
// ---------------------------------------------------------------------------

describe("determineConsolidationScope", () => {
  it("includes entities with consolidation-required relationships", () => {
    const entities = [
      makeEntity({ entityId: "a-1", isPrimaryBorrower: true }),
      makeEntity({ entityId: "b-1" }),
    ];
    const rels = [{
      relationshipId: "rel-1",
      parentEntityId: "a-1",
      childEntityId: "b-1",
      relationshipType: "parent_subsidiary" as const,
      ownershipPct: 80,
      controlType: "majority" as const,
      consolidationRequired: true,
    }];
    const scope = determineConsolidationScope(entities, rels);
    assert.deepEqual(scope.entitiesInScope.sort(), ["a-1", "b-1"]);
    assert.equal(scope.method, "full_consolidation");
  });

  it("always includes primary borrower in scope", () => {
    const entities = [
      makeEntity({ entityId: "primary", isPrimaryBorrower: true }),
      makeEntity({ entityId: "unrelated", role: "operating_company" }),
    ];
    const scope = determineConsolidationScope(entities, []);
    assert.ok(scope.entitiesInScope.includes("primary"));
  });

  it("excludes individual entities", () => {
    const entities = [
      makeEntity({ entityId: "biz", isPrimaryBorrower: true }),
      makeEntity({ entityId: "person", entityType: "individual" }),
    ];
    const scope = determineConsolidationScope(entities, []);
    assert.ok(scope.entitiesExcluded.includes("person"));
    assert.ok(scope.exclusionReasons["person"]?.includes("Personal"));
  });
});

// ---------------------------------------------------------------------------
// buildEntityMap
// ---------------------------------------------------------------------------

describe("buildEntityMap", () => {
  it("returns a complete EntityMap with version 1", () => {
    const entities = [
      makeEntity({
        entityId: "opco",
        isPrimaryBorrower: true,
        ownershipStructure: [{
          ownerName: "Jane Doe",
          ownershipPct: 100,
          ownershipType: "common",
          isGuarantor: true,
        }],
      }),
      makeEntity({
        entityId: "propco",
        ownershipStructure: [{
          ownerName: "Jane Doe",
          ownershipPct: 100,
          ownershipType: "membership",
          isGuarantor: false,
        }],
      }),
    ];
    const map = buildEntityMap("deal-1", entities);
    assert.equal(map.dealId, "deal-1");
    assert.equal(map.version, 1);
    assert.equal(map.entities.length, 2);
    // Should detect common control
    assert.ok(map.relationships.length > 0);
    assert.ok(map.consolidationScope.entitiesInScope.length > 0);
  });
});
