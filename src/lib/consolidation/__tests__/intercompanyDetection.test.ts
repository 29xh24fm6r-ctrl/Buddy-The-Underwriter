import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectIntercompanyTransactions,
  type ICDetectionInput,
  type EntityFacts,
} from "../intercompanyDetection";
import type { BorrowerEntity } from "../entityMap";

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
// Signal 1: Schedule L disclosures
// ---------------------------------------------------------------------------

describe("Signal 1 — Schedule L disclosures", () => {
  it("detects shareholder loans receivable as IC loan", () => {
    const input: ICDetectionInput = {
      entities: [
        makeEntity({ entityId: "lender" }),
        makeEntity({ entityId: "borrower" }),
      ],
      entityFacts: [
        { entityId: "lender", facts: { SL_SHAREHOLDER_LOANS_RECEIVABLE: 250_000 } },
        { entityId: "borrower", facts: {} },
      ],
      scopeEntityIds: ["lender", "borrower"],
    };
    const result = detectIntercompanyTransactions(input);
    assert.ok(result.transactions.length >= 1);
    const loan = result.transactions.find((t) => t.transactionType === "loan");
    assert.ok(loan);
    assert.equal(loan.receivingEntityId, "lender");
    assert.equal(loan.payingEntityId, "borrower");
    assert.equal(loan.annualAmount, 250_000);
    assert.equal(loan.detectionMethod, "tax_return_disclosure");
    assert.equal(loan.confidence, "high");
    assert.equal(loan.eliminationRequired, true);
  });
});

// ---------------------------------------------------------------------------
// Signal 2: Amount matching
// ---------------------------------------------------------------------------

describe("Signal 2 — Amount matching", () => {
  it("detects rent expense ≈ rental income as IC rent", () => {
    const input: ICDetectionInput = {
      entities: [
        makeEntity({ entityId: "opco" }),
        makeEntity({ entityId: "propco" }),
      ],
      entityFacts: [
        { entityId: "opco", facts: { RENT_EXPENSE: 120_000 } },
        { entityId: "propco", facts: { NET_RENTAL_INCOME: 118_000 } },
      ],
      scopeEntityIds: ["opco", "propco"],
    };
    const result = detectIntercompanyTransactions(input);
    const rent = result.transactions.find((t) => t.transactionType === "rent");
    assert.ok(rent, "Should detect rent IC transaction");
    assert.equal(rent.payingEntityId, "opco");
    assert.equal(rent.receivingEntityId, "propco");
    assert.equal(rent.detectionMethod, "amount_match");
  });

  it("rejects amounts outside 5% tolerance", () => {
    const input: ICDetectionInput = {
      entities: [
        makeEntity({ entityId: "a" }),
        makeEntity({ entityId: "b" }),
      ],
      entityFacts: [
        { entityId: "a", facts: { RENT_EXPENSE: 200_000 } },
        { entityId: "b", facts: { NET_RENTAL_INCOME: 100_000 } },
      ],
      scopeEntityIds: ["a", "b"],
    };
    const result = detectIntercompanyTransactions(input);
    const rent = result.transactions.filter((t) => t.transactionType === "rent");
    assert.equal(rent.length, 0, "Should not match when amounts differ by >5%");
  });

  it("uses conservative (lower) amount", () => {
    const input: ICDetectionInput = {
      entities: [
        makeEntity({ entityId: "x" }),
        makeEntity({ entityId: "y" }),
      ],
      entityFacts: [
        { entityId: "x", facts: { RENT_EXPENSE: 102_000 } },
        { entityId: "y", facts: { NET_RENTAL_INCOME: 100_000 } },
      ],
      scopeEntityIds: ["x", "y"],
    };
    const result = detectIntercompanyTransactions(input);
    const rent = result.transactions.find((t) => t.transactionType === "rent");
    assert.ok(rent);
    assert.equal(rent.annualAmount, 100_000); // lower of the two
  });
});

// ---------------------------------------------------------------------------
// Signal 3: EIN prefix match
// ---------------------------------------------------------------------------

describe("Signal 3 — EIN prefix match", () => {
  it("flags potential IC when EIN prefixes match and rent/revenue pattern found", () => {
    const input: ICDetectionInput = {
      entities: [
        makeEntity({ entityId: "a", ein: "12-3456789" }),
        makeEntity({ entityId: "b", ein: "12-9876543" }),
      ],
      entityFacts: [
        { entityId: "a", facts: { TOTAL_REVENUE: 100_000 } },
        { entityId: "b", facts: { RENT_EXPENSE: 98_000 } },
      ],
      scopeEntityIds: ["a", "b"],
    };
    const result = detectIntercompanyTransactions(input);
    // Should detect via either amount_match or address_match
    assert.ok(result.transactions.length >= 1);
  });
});

// ---------------------------------------------------------------------------
// Signal 4: Schedule E cross-reference
// ---------------------------------------------------------------------------

describe("Signal 4 — Schedule E cross-reference", () => {
  it("detects owner rental income ≈ entity rent expense", () => {
    const input: ICDetectionInput = {
      entities: [
        makeEntity({ entityId: "biz" }),
      ],
      entityFacts: [
        { entityId: "biz", facts: { RENT_EXPENSE: 60_000 } },
      ],
      ownerEntityFacts: {
        entityId: "owner",
        facts: { SCH_E_RENTS_RECEIVED: 60_000 },
      },
      scopeEntityIds: ["biz"],
    };
    const result = detectIntercompanyTransactions(input);
    const rent = result.transactions.find(
      (t) => t.transactionType === "rent" && t.detectionMethod === "schedule_e_cross_ref",
    );
    assert.ok(rent, "Should detect owner rental income ≈ entity rent expense");
    assert.equal(rent.payingEntityId, "biz");
    assert.equal(rent.receivingEntityId, "owner");
  });

  it("does not flag when no Schedule E rental income", () => {
    const input: ICDetectionInput = {
      entities: [makeEntity({ entityId: "biz" })],
      entityFacts: [{ entityId: "biz", facts: { RENT_EXPENSE: 60_000 } }],
      ownerEntityFacts: {
        entityId: "owner",
        facts: {},
      },
      scopeEntityIds: ["biz"],
    };
    const result = detectIntercompanyTransactions(input);
    const sch4 = result.transactions.filter((t) => t.detectionMethod === "schedule_e_cross_ref");
    assert.equal(sch4.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Signal 5: K-1 exclusions
// ---------------------------------------------------------------------------

describe("Signal 5 — K-1 exclusions", () => {
  it("adds entities with K1_ORDINARY_INCOME to k1Exclusions", () => {
    const input: ICDetectionInput = {
      entities: [
        makeEntity({ entityId: "e1" }),
        makeEntity({ entityId: "e2" }),
      ],
      entityFacts: [
        { entityId: "e1", facts: { K1_ORDINARY_INCOME: 150_000 } },
        { entityId: "e2", facts: {} },
      ],
      scopeEntityIds: ["e1", "e2"],
    };
    const result = detectIntercompanyTransactions(input);
    assert.ok(result.k1Exclusions.includes("e1"));
    assert.ok(!result.k1Exclusions.includes("e2"));
  });

  it("does not exclude entities not in scope", () => {
    const input: ICDetectionInput = {
      entities: [makeEntity({ entityId: "e1" })],
      entityFacts: [
        { entityId: "e1", facts: { K1_ORDINARY_INCOME: 50_000 } },
      ],
      scopeEntityIds: [], // not in scope
    };
    const result = detectIntercompanyTransactions(input);
    assert.equal(result.k1Exclusions.length, 0);
  });
});
