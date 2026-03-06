import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flagFromDocuments } from "../flagFromDocuments";
import type { FlagEngineInput } from "../types";
import { resetFlagCounter } from "../flagHelpers";

function makeInput(
  facts: Record<string, unknown> = {},
  dealType?: string,
): FlagEngineInput {
  resetFlagCounter();
  return {
    deal_id: "deal-1",
    canonical_facts: facts,
    ratios: {},
    years_available: [2023],
    deal_type: dealType,
  };
}

describe("flagFromDocuments", () => {
  // ── Lease expiration ───────────────────────────────────────────────────
  it("flags lease_expiring_within_loan_term when lease expires before loan maturity", () => {
    const flags = flagFromDocuments(makeInput({
      lease_expiration_date: "2026-06-01",
      loan_maturity_date: "2028-12-31",
    }));
    const f = flags.find((f) => f.trigger_type === "lease_expiring_within_loan_term");
    assert.ok(f);
    assert.equal(f.severity, "elevated");
    assert.ok(f.borrower_question !== null);
  });

  it("does NOT flag lease when lease expires after loan maturity", () => {
    const flags = flagFromDocuments(makeInput({
      lease_expiration_date: "2030-01-01",
      loan_maturity_date: "2028-12-31",
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "lease_expiring_within_loan_term"));
  });

  // ── Customer concentration ─────────────────────────────────────────────
  it("flags customer_concentration_25pct when > 25%", () => {
    const flags = flagFromDocuments(makeInput({
      largest_customer_revenue_pct: 0.35,
    }));
    const f = flags.find((f) => f.trigger_type === "customer_concentration_25pct");
    assert.ok(f);
    assert.ok(f.borrower_question !== null);
  });

  it("does NOT flag customer concentration when <= 25%", () => {
    const flags = flagFromDocuments(makeInput({
      largest_customer_revenue_pct: 0.20,
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "customer_concentration_25pct"));
  });

  // ── Provider concentration ─────────────────────────────────────────────
  it("flags provider_concentration_80pct when > 80%", () => {
    const flags = flagFromDocuments(makeInput({
      largest_provider_revenue_pct: 0.90,
    }));
    const f = flags.find((f) => f.trigger_type === "provider_concentration_80pct");
    assert.ok(f);
  });

  // ── Contingent liabilities ─────────────────────────────────────────────
  it("flags undisclosed_contingent_liability when amount > 0", () => {
    const flags = flagFromDocuments(makeInput({
      pfs_contingent_liability_amount: 250_000,
    }));
    const f = flags.find((f) => f.trigger_type === "undisclosed_contingent_liability");
    assert.ok(f);
    assert.equal(f.severity, "critical");
  });

  it("does NOT flag contingent liability when zero", () => {
    const flags = flagFromDocuments(makeInput({
      pfs_contingent_liability_amount: 0,
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "undisclosed_contingent_liability"));
  });

  // ── Entity age ─────────────────────────────────────────────────────────
  it("flags entity_formed_within_12_months for recent formation", () => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const flags = flagFromDocuments(makeInput({
      entity_formation_date: sixMonthsAgo.toISOString().split("T")[0],
    }));
    const f = flags.find((f) => f.trigger_type === "entity_formed_within_12_months");
    assert.ok(f);
  });

  it("does NOT flag entity age when formed > 12 months ago", () => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const flags = flagFromDocuments(makeInput({
      entity_formation_date: twoYearsAgo.toISOString().split("T")[0],
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "entity_formed_within_12_months"));
  });

  // ── Schedule E missing ─────────────────────────────────────────────────
  it("flags schedule_e_missing when rental income present but no Schedule E", () => {
    const flags = flagFromDocuments(makeInput({
      SCH_E_RENTS_RECEIVED: 36_000,
      schedule_e_extracted: false,
    }));
    const f = flags.find((f) => f.trigger_type === "schedule_e_missing");
    assert.ok(f);
    assert.ok(f.borrower_question !== null);
  });

  // ── Rent roll missing for CRE ──────────────────────────────────────────
  it("flags rent_roll_missing for CRE deal without rent roll", () => {
    const flags = flagFromDocuments(makeInput({
      rent_roll_present: false,
    }, "CRE"));
    const f = flags.find((f) => f.trigger_type === "rent_roll_missing");
    assert.ok(f);
  });

  it("does NOT flag rent_roll_missing for non-CRE deals", () => {
    const flags = flagFromDocuments(makeInput({
      rent_roll_present: false,
    }, "SBA"));
    assert.ok(!flags.some((f) => f.trigger_type === "rent_roll_missing"));
  });

  // ── Construction budget missing ────────────────────────────────────────
  it("flags construction_budget_missing for construction deal without budget", () => {
    const flags = flagFromDocuments(makeInput({
      construction_budget_present: false,
    }, "construction"));
    const f = flags.find((f) => f.trigger_type === "construction_budget_missing");
    assert.ok(f);
    assert.equal(f.severity, "critical");
  });

  // ── Empty facts ────────────────────────────────────────────────────────
  it("returns empty array for empty facts", () => {
    const flags = flagFromDocuments(makeInput());
    assert.equal(flags.length, 0);
  });
});
