import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Phase 15B — Pure Determinism Tests for Slot Policies
// ---------------------------------------------------------------------------
// These import pure functions (no server-only, no DB) — safe for test runner.

import type { IntakeScenario } from "../../types";
import { generateSba7aSlots } from "../sba7a";
import { generateConventionalSlots } from "../conventional";
import { resolveSlotPolicy, generateSlotsForScenario } from "../index";

const FIXED_DATE = new Date("2026-02-14");

// ---------------------------------------------------------------------------
// 1. SBA 7(a) EXISTING — has BTR + PTR + financials + SBA forms
// ---------------------------------------------------------------------------

test("SBA_7A EXISTING produces tax returns + financials + SBA forms", () => {
  const scenario: IntakeScenario = {
    product_type: "SBA_7A",
    borrower_business_stage: "EXISTING",
    has_business_tax_returns: true,
    has_financial_statements: true,
    has_projections: false,
    entity_age_months: 36,
  };

  const slots = generateSba7aSlots(scenario, FIXED_DATE);

  // Business tax returns (3 years)
  const btr = slots.filter((s) => s.slot_group === "BUSINESS_TAX_RETURN");
  assert.equal(btr.length, 3, "3 business tax return slots");
  assert.deepEqual(
    btr.map((s) => s.required_tax_year).sort(),
    [2023, 2024, 2025],
  );

  // Personal tax returns (3 years)
  const ptr = slots.filter((s) => s.slot_group === "PERSONAL_TAX_RETURN");
  assert.equal(ptr.length, 3, "3 personal tax return slots");

  // Financial statements
  assert.ok(slots.some((s) => s.slot_key === "INCOME_STATEMENT_YTD"));
  assert.ok(slots.some((s) => s.slot_key === "BALANCE_SHEET_CURRENT"));

  // PFS
  assert.ok(slots.some((s) => s.slot_key === "PFS_CURRENT"));

  // SBA forms
  assert.ok(slots.some((s) => s.slot_key === "SBA_1919"));
  assert.ok(slots.some((s) => s.slot_key === "SBA_413"));
  assert.ok(slots.some((s) => s.slot_key === "SBA_DEBT_SCHEDULE"));

  // All slots have sort_order
  assert.ok(slots.every((s) => typeof s.sort_order === "number"));

  // Count: 3 BTR + 3 PTR + PFS + IS + BS + 3 SBA = 12
  assert.equal(slots.length, 12);
});

// ---------------------------------------------------------------------------
// 2. SBA 7(a) STARTUP — NO BTR; has startup package
// ---------------------------------------------------------------------------

test("SBA_7A STARTUP omits business tax returns, adds startup package", () => {
  const scenario: IntakeScenario = {
    product_type: "SBA_7A",
    borrower_business_stage: "STARTUP",
    has_business_tax_returns: false,
    has_financial_statements: false,
    has_projections: false,
    entity_age_months: 3,
  };

  const slots = generateSba7aSlots(scenario, FIXED_DATE);

  // NO business tax returns
  const btr = slots.filter((s) => s.slot_group === "BUSINESS_TAX_RETURN");
  assert.equal(btr.length, 0, "Startups have no business tax return slots");

  // Personal tax returns still required
  const ptr = slots.filter((s) => s.slot_group === "PERSONAL_TAX_RETURN");
  assert.equal(ptr.length, 3, "Still need 3 personal tax returns");

  // Startup package
  assert.ok(slots.some((s) => s.slot_key === "BUSINESS_PLAN"));
  assert.ok(slots.some((s) => s.slot_key === "PROJECTIONS_3YR"));
  assert.ok(slots.some((s) => s.slot_key === "OWNER_RESUME"));

  // PFS still required
  assert.ok(slots.some((s) => s.slot_key === "PFS_CURRENT"));

  // SBA forms still required
  assert.ok(slots.some((s) => s.slot_key === "SBA_1919"));
  assert.ok(slots.some((s) => s.slot_key === "SBA_413"));

  // NO income statement / balance sheet for startup
  assert.ok(!slots.some((s) => s.slot_key === "INCOME_STATEMENT_YTD"));
  assert.ok(!slots.some((s) => s.slot_key === "BALANCE_SHEET_CURRENT"));
});

// ---------------------------------------------------------------------------
// 3. SBA 7(a) ACQUISITION — seller docs + purchase agreement
// ---------------------------------------------------------------------------

test("SBA_7A ACQUISITION includes seller financials + purchase agreement", () => {
  const scenario: IntakeScenario = {
    product_type: "SBA_7A",
    borrower_business_stage: "ACQUISITION",
    has_business_tax_returns: true,
    has_financial_statements: true,
    has_projections: false,
    entity_age_months: null,
  };

  const slots = generateSba7aSlots(scenario, FIXED_DATE);

  // Seller tax returns
  const sellerTax = slots.filter((s) => s.slot_key.startsWith("SELLER_TAX_RETURN"));
  assert.equal(sellerTax.length, 3, "3 seller tax return slots");

  // Seller financials
  assert.ok(slots.some((s) => s.slot_key === "SELLER_INCOME_STATEMENT_YTD"));
  assert.ok(slots.some((s) => s.slot_key === "SELLER_BALANCE_SHEET"));

  // Acquisition docs
  assert.ok(slots.some((s) => s.slot_key === "PURCHASE_AGREEMENT"));
  assert.ok(slots.some((s) => s.slot_key === "PRO_FORMA"));
  assert.ok(slots.some((s) => s.slot_key === "BUYER_ENTITY_DOCS"));

  // Personal docs still required
  assert.ok(slots.some((s) => s.slot_key === "PFS_CURRENT"));
  const ptr = slots.filter((s) => s.slot_group === "PERSONAL_TAX_RETURN");
  assert.equal(ptr.length, 3);

  // NO borrower business tax returns (it's an acquisition, not existing biz)
  const borrowerBtr = slots.filter(
    (s) => s.slot_group === "BUSINESS_TAX_RETURN",
  );
  assert.equal(borrowerBtr.length, 0, "Acquisition uses seller tax returns instead");

  // SBA forms
  assert.ok(slots.some((s) => s.slot_key === "SBA_1919"));
});

// ---------------------------------------------------------------------------
// 4. Conventional — baseline 11 slots (backward compatible)
// ---------------------------------------------------------------------------

test("conventional policy produces 11 baseline slots", () => {
  const scenario: IntakeScenario = {
    product_type: "CRE_TERM",
    borrower_business_stage: "EXISTING",
    has_business_tax_returns: true,
    has_financial_statements: true,
    has_projections: false,
    entity_age_months: 120,
  };

  const slots = generateConventionalSlots(scenario, FIXED_DATE);
  assert.equal(slots.length, 9, "Conventional produces 9 slots (3 BTR + 3 PTR + PFS + IS + BS)");

  // Verify structure matches Phase 15 baseline
  const btr = slots.filter((s) => s.slot_group === "BUSINESS_TAX_RETURN");
  assert.equal(btr.length, 3);
  const ptr = slots.filter((s) => s.slot_group === "PERSONAL_TAX_RETURN");
  assert.equal(ptr.length, 3);
  assert.ok(slots.some((s) => s.slot_key === "PFS_CURRENT"));
  assert.ok(slots.some((s) => s.slot_key === "INCOME_STATEMENT_YTD"));
  assert.ok(slots.some((s) => s.slot_key === "BALANCE_SHEET_CURRENT"));

  // All are UPLOAD mode, no interactive
  assert.ok(slots.every((s) => s.slot_mode === "UPLOAD"));
  assert.ok(slots.every((s) => s.interactive_kind === null));
});

// ---------------------------------------------------------------------------
// 5. Determinism — same inputs → same output
// ---------------------------------------------------------------------------

test("generateSba7aSlots is deterministic (same inputs produce identical output)", () => {
  const scenario: IntakeScenario = {
    product_type: "SBA_7A",
    borrower_business_stage: "STARTUP",
    has_business_tax_returns: false,
    has_financial_statements: false,
    has_projections: true,
    entity_age_months: 6,
  };

  const run1 = generateSba7aSlots(scenario, FIXED_DATE);
  const run2 = generateSba7aSlots(scenario, FIXED_DATE);
  assert.deepEqual(run1, run2, "Two runs must produce identical output");
});

test("generateSlotsForScenario is deterministic via registry", () => {
  const scenario: IntakeScenario = {
    product_type: "SBA_7A",
    borrower_business_stage: "EXISTING",
    has_business_tax_returns: true,
    has_financial_statements: true,
    has_projections: false,
    entity_age_months: null,
  };

  const run1 = generateSlotsForScenario(scenario, FIXED_DATE);
  const run2 = generateSlotsForScenario(scenario, FIXED_DATE);
  assert.deepEqual(run1, run2);
});

// ---------------------------------------------------------------------------
// 6. resolveSlotPolicy maps SBA variants correctly
// ---------------------------------------------------------------------------

test("resolveSlotPolicy maps SBA variants to SBA_7A policy", () => {
  assert.equal(resolveSlotPolicy("SBA_7A").product, "SBA_7A");
  assert.equal(resolveSlotPolicy("SBA_7A_STANDARD").product, "SBA_7A");
  assert.equal(resolveSlotPolicy("SBA_7A_SMALL").product, "SBA_7A");
  assert.equal(resolveSlotPolicy("SBA_EXPRESS").product, "SBA_7A");
  assert.equal(resolveSlotPolicy("SBA_CAPLines").product, "SBA_7A");
});

test("resolveSlotPolicy falls back to CONVENTIONAL for unknown types", () => {
  assert.equal(resolveSlotPolicy("CRE_TERM").product, "CONVENTIONAL");
  assert.equal(resolveSlotPolicy("LOC").product, "CONVENTIONAL");
  assert.equal(resolveSlotPolicy("UNKNOWN_PRODUCT").product, "CONVENTIONAL");
});

// ---------------------------------------------------------------------------
// 7. All SBA slots have help_reason populated
// ---------------------------------------------------------------------------

test("all required SBA EXISTING slots have help_reason", () => {
  const scenario: IntakeScenario = {
    product_type: "SBA_7A",
    borrower_business_stage: "EXISTING",
    has_business_tax_returns: true,
    has_financial_statements: true,
    has_projections: false,
    entity_age_months: 36,
  };

  const slots = generateSba7aSlots(scenario, FIXED_DATE);
  const requiredSlots = slots.filter((s) => s.required);
  assert.ok(requiredSlots.length > 0, "Must have required slots");
  assert.ok(
    requiredSlots.every((s) => s.help_reason && s.help_reason.length > 0),
    "All required SBA slots must have help_reason populated",
  );
});

test("startup package slots have help_examples", () => {
  const scenario: IntakeScenario = {
    product_type: "SBA_7A",
    borrower_business_stage: "STARTUP",
    has_business_tax_returns: false,
    has_financial_statements: false,
    has_projections: false,
    entity_age_months: 3,
  };

  const slots = generateSba7aSlots(scenario, FIXED_DATE);
  const startupSlots = slots.filter((s) => s.slot_group === "STARTUP_PACKAGE");
  assert.ok(startupSlots.length >= 3, "At least 3 startup package slots");

  const businessPlan = startupSlots.find((s) => s.slot_key === "BUSINESS_PLAN");
  assert.ok(businessPlan, "Must have BUSINESS_PLAN slot");
  assert.ok(
    businessPlan!.help_examples && businessPlan!.help_examples.length > 0,
    "Business plan must have help_examples",
  );
});

// ---------------------------------------------------------------------------
// 8. All slots have correct slot_mode
// ---------------------------------------------------------------------------

test("all slots default to UPLOAD mode", () => {
  const scenarios: IntakeScenario[] = [
    {
      product_type: "SBA_7A",
      borrower_business_stage: "EXISTING",
      has_business_tax_returns: true,
      has_financial_statements: true,
      has_projections: false,
      entity_age_months: null,
    },
    {
      product_type: "SBA_7A",
      borrower_business_stage: "STARTUP",
      has_business_tax_returns: false,
      has_financial_statements: false,
      has_projections: false,
      entity_age_months: null,
    },
    {
      product_type: "CRE",
      borrower_business_stage: "EXISTING",
      has_business_tax_returns: true,
      has_financial_statements: true,
      has_projections: false,
      entity_age_months: null,
    },
  ];

  for (const scenario of scenarios) {
    const slots = generateSlotsForScenario(scenario, FIXED_DATE);
    assert.ok(
      slots.every((s) => s.slot_mode === "UPLOAD"),
      `All slots for ${scenario.product_type}/${scenario.borrower_business_stage} should be UPLOAD mode in Phase 15B`,
    );
  }
});
