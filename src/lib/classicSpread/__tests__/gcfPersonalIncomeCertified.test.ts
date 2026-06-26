/**
 * SPEC-CLASSIC-SPREAD-PERSONAL-INCOME-CROSS-OWNER-CERTIFICATION-1 (Phase 4) — GCF consolidation.
 *
 * Proves GCF personal-income selection is sourced from the SAME certified cross-owner layer the
 * classic spread uses (buildCertifiedGcfPersonalIncome), no longer a separate
 * owner_type=PERSONAL / fact_type=PERSONAL_INCOME raw selector — while preserving K-1 exclusion,
 * the financial-readiness prerequisite repair behavior, and the orphan recovery path.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildCertifiedGcfPersonalIncome,
  buildCertifiedPersonalIncomeYears,
} from "../personalIncomeSelection";
import type { PersonalIncomeFact } from "../certification/certifiedPersonalIncome";
import {
  planAnnualDebtServiceRepair,
  derivePfsAnnualDebtServiceByOwner,
  derivePfsLivingExpensesByOwner,
} from "@/lib/financialReadiness/financialReadinessPrereqCore";

const OWNER = "owner-1";

const strong = (key: string, value: number, year = 2023, over: Partial<PersonalIncomeFact> = {}): PersonalIncomeFact => ({
  id: `strong-${key}-${year}`,
  fact_key: key,
  fact_value_num: value,
  fact_period_end: `${year}-12-31`,
  owner_type: "DEAL",
  owner_entity_id: null,
  source_document_id: "doc-tax",
  source_canonical_type: "PERSONAL_TAX_RETURN",
  fact_type: "TAX_RETURN",
  confidence: 0.8,
  extractor: "gemini_primary_v1",
  is_superseded: false,
  resolution_status: null,
  ...over,
});

const weak = (key: string, value: number, year = 2023, over: Partial<PersonalIncomeFact> = {}): PersonalIncomeFact => ({
  id: `weak-${key}-${year}`,
  fact_key: key,
  fact_value_num: value,
  fact_period_end: `${year}-12-31`,
  owner_type: "PERSONAL",
  owner_entity_id: OWNER,
  source_document_id: "doc-pi",
  source_canonical_type: "PERSONAL_TAX_RETURN",
  fact_type: "PERSONAL_INCOME",
  confidence: 0.55,
  extractor: "personalIncomeExtractor:v2:deterministic",
  is_superseded: false,
  resolution_status: null,
  ...over,
});

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

// ── 1. Omnicare-shaped: classic + GCF both choose the strong values ──────────────────────────

describe("Phase 4: GCF + classic personal income both certify strong values", () => {
  it("strong PERSONAL_TAX_RETURN/DEAL wins for both classic spread and GCF; weak recorded rejected", () => {
    const facts = [
      strong("WAGES_W2", 310_134), weak("WAGES_W2", 3),
      strong("ADJUSTED_GROSS_INCOME", 282_742), weak("ADJUSTED_GROSS_INCOME", 0),
      strong("TAXABLE_INCOME", 249_968), weak("TAXABLE_INCOME", 456),
    ];

    // classic spread (PR 563)
    const classic = buildCertifiedPersonalIncomeYears(facts);
    const y = classic.years.find((yy) => yy.year === 2023)!;
    assert.equal(y.wagesW2, 310_134);
    assert.equal(y.adjustedGrossIncome, 282_742);
    assert.equal(y.taxableIncome, 249_968);

    // GCF (Phase 4) — WAGES_W2 is the only GCF component here (AGI/TAXABLE are not GCF components)
    const gcf = buildCertifiedGcfPersonalIncome(facts);
    assert.equal(gcf.value, 310_134);
    assert.equal(gcf.components.WAGES_W2, 310_134);
    assert.equal(gcf.audit.hasStrongFamily, true);
    assert.ok(gcf.audit.rejected.some((r) => r.key === "WAGES_W2" && r.value === 3));
    // AGI / TAXABLE_INCOME are NOT summed into GCF personal income
    assert.equal(gcf.components.ADJUSTED_GROSS_INCOME, undefined);
    assert.equal(gcf.components.TAXABLE_INCOME, undefined);
  });

  it("per-sponsor: single-sponsor folds DEAL-owned strong facts so the strong value wins", () => {
    const facts = [weak("WAGES_W2", 3), strong("WAGES_W2", 310_134)];
    const gcf = buildCertifiedGcfPersonalIncome(facts, { ownerEntityId: OWNER, includeDealOwned: true });
    assert.equal(gcf.value, 310_134);
    assert.ok(gcf.audit.rejected.some((r) => r.value === 3));
  });
});

// ── 2. GCF does not depend on fact_type=PERSONAL_INCOME only ─────────────────────────────────

describe("Phase 4: GCF selection no longer requires the weak PERSONAL_INCOME family", () => {
  it("computes GCF personal income from strong DEAL/TAX_RETURN facts with NO PERSONAL_INCOME rows", () => {
    const facts = [strong("WAGES_W2", 310_134), strong("SOCIAL_SECURITY", 20_000)];
    const gcf = buildCertifiedGcfPersonalIncome(facts);
    // legacy sumGcfPersonalIncome would return null here (no owner_type=PERSONAL / PERSONAL_INCOME).
    assert.equal(gcf.value, 330_134); // 310,134 + 20,000
    assert.equal(gcf.components.WAGES_W2, 310_134);
    assert.equal(gcf.components.SOCIAL_SECURITY, 20_000);
    assert.equal(gcf.audit.hasStrongFamily, true);
  });
});

// ── 3. K-1 / pass-through exclusion preserved ────────────────────────────────────────────────

describe("Phase 4: GCF still excludes K-1 / pass-through income", () => {
  it("never sums K1_ORDINARY_INCOME into GCF personal income", () => {
    const facts = [strong("WAGES_W2", 100_000), strong("K1_ORDINARY_INCOME", 500_000)];
    const gcf = buildCertifiedGcfPersonalIncome(facts);
    assert.equal(gcf.value, 100_000);
    assert.equal(gcf.components.K1_ORDINARY_INCOME, undefined);
    assert.equal(gcf.components.WAGES_W2, 100_000);
  });

  it("prefers SCH_E_RENTAL_TOTAL over combined SCH_E_NET to avoid double-counting", () => {
    const facts = [strong("SCH_E_RENTAL_TOTAL", 12_000), strong("SCH_E_NET", 20_000)];
    const gcf = buildCertifiedGcfPersonalIncome(facts);
    assert.equal(gcf.components.SCH_E_RENTAL_TOTAL, 12_000);
    assert.equal(gcf.components.SCH_E_NET, undefined);
    assert.equal(gcf.value, 12_000);
  });
});

// ── multi-sponsor: shared DEAL fact is not double-counted ─────────────────────────────────────

describe("Phase 4: multi-sponsor does not double-count a shared DEAL-owned fact", () => {
  it("each sponsor sums only its own PERSONAL facts when DEAL-fold is disabled", () => {
    const facts = [
      weak("WAGES_W2", 50_000, 2023, { id: "o1", owner_entity_id: "owner-1" }),
      weak("WAGES_W2", 60_000, 2023, { id: "o2", owner_entity_id: "owner-2" }),
      strong("WAGES_W2", 310_134),
    ];
    const a = buildCertifiedGcfPersonalIncome(facts, { ownerEntityId: "owner-1", includeDealOwned: false });
    const b = buildCertifiedGcfPersonalIncome(facts, { ownerEntityId: "owner-2", includeDealOwned: false });
    assert.equal(a.value, 50_000);
    assert.equal(b.value, 60_000);
    // sum across sponsors = 110,000 — the DEAL 310,134 is not folded into either (no double count)
  });
});

// ── 4. PFS_LIVING_EXPENSES remains fail-closed (preserved) ───────────────────────────────────

describe("Phase 4: financial-readiness behavior preserved", () => {
  it("PFS_LIVING_EXPENSES stays missing/gated when no source-backed fact exists", () => {
    const r = derivePfsLivingExpensesByOwner([
      { fact_key: "PFS_MORTGAGE_PAYMENT_MO", fact_value_num: 18_000, owner_type: "PERSONAL", owner_entity_id: OWNER, is_superseded: false, fact_period_end: "2025-12-31" },
      { fact_key: "PFS_NET_WORTH", fact_value_num: 24_837_000, owner_type: "PERSONAL", owner_entity_id: OWNER, is_superseded: false, fact_period_end: "2025-12-31" },
    ]);
    assert.equal(r.derivations.length, 0);
    assert.ok(r.diagnostic && /not repairable from existing facts; extraction\/manual review required/i.test(r.diagnostic));
  });

  // ── 5. ANNUAL_DEBT_SERVICE / PFS_ANNUAL_DEBT_SERVICE repair still materializes ──────────────
  it("ANNUAL_DEBT_SERVICE repair still triggers from current structural pricing", () => {
    const plan = planAnnualDebtServiceRepair({ facts: [], latestStructuralAds: 101_250 });
    assert.equal(plan.shouldRecompute, true);
    assert.equal(plan.reason, "annual_debt_service_missing");
  });

  it("PFS_ANNUAL_DEBT_SERVICE still derives from PFS monthly payments (mortgage × 12)", () => {
    const r = derivePfsAnnualDebtServiceByOwner([
      { fact_key: "PFS_MORTGAGE_PAYMENT_MO", fact_value_num: 18_000, owner_type: "PERSONAL", owner_entity_id: OWNER, source_document_id: "doc-pfs", is_superseded: false, fact_period_end: "2025-12-31" },
    ]);
    assert.equal(r.derivations.length, 1);
    assert.equal(r.derivations[0].value, 216_000);
  });
});

// ── 6. Orphan recovery path intact ───────────────────────────────────────────────────────────

describe("Phase 4: ORPHANED_BY_FAILED_ORCHESTRATION recovery path intact", () => {
  it("recompute route still runs prerequisite repair before the GCF gate (re-enqueue can recover orphan)", () => {
    const src = read("src/app/api/deals/[dealId]/spreads/recompute/route.ts");
    const repairIdx = src.indexOf("ensureFinancialReadinessPrerequisites");
    const gateIdx = src.indexOf("getCanonicalGlobalCashFlow(dealId, access.bankId)");
    assert.ok(repairIdx !== -1, "route runs prerequisite repair");
    assert.ok(gateIdx !== -1, "route still evaluates GCF prerequisites");
    assert.ok(repairIdx < gateIdx, "repair runs before the gate so a ready GCF can re-enqueue");
  });
});

// ── wiring guard: persistGlobalCashFlow uses the certified helper, not the raw selector ───────

describe("Phase 4: persistGlobalCashFlow wiring", () => {
  it("imports + uses buildCertifiedGcfPersonalIncome and no longer uses sumGcfPersonalIncome as the selector", () => {
    const src = read("src/lib/financialIntelligence/persistGlobalCashFlow.ts");
    assert.ok(/import\s*\{\s*buildCertifiedGcfPersonalIncome\s*\}/.test(src), "imports the certified GCF helper");
    assert.ok(/buildCertifiedGcfPersonalIncome\(/.test(src), "calls the certified GCF helper");
    assert.ok(!/sumGcfPersonalIncome\(/.test(src), "no longer calls sumGcfPersonalIncome as the raw selector");
  });
});
