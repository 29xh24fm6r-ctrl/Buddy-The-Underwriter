/**
 * SPEC-FINENGINE-GLOBAL-CASHFLOW-ASSEMBLER-1 — global cash flow assembler
 * (first spec of the decision-core cutover track).
 *
 * `computeGlobalCashFlow` (methods/global.ts) consumes pre-assembled per-entity
 * cash-flow structs over an `EntityGraph`, but nothing builds those structs from a
 * deal's facts — and the entity-graph tables (`ownership_edges`,
 * `deal_entity_relationships`, `buddy_guarantor_cashflow`) are empty for every test
 * deal (verified). This assembler reads the CERTIFIED facts (not the empty tables)
 * and builds the minimal correct graph so the finengine's global DSCR can finally
 * run on a real deal.
 *
 * v1 NODE MODEL (correct for the GLOBAL number, which sums each side): one BUSINESS
 * node + one aggregated PERSONAL guarantor node + a single distribution edge between
 * them. Per-OPCO / per-guarantor nodes need the (empty) graph tables and are a
 * documented follow-on (see the spec's non-goals).
 *
 * THE SINGLE-COUNT WALL (NG-CORRECTNESS): K-1 Box 1 ordinary income and owner
 * distributions are NEVER mapped into personal `income.*`. Distributions live in
 * business operating cash (the internal transfer recorded on the edge); K-1 Box 1 is
 * never external income. Mapping either into personal income would double-count and
 * inflate global DSCR. The exclusion is by construction here and asserted in tests.
 *
 * Discipline (mirrors the EBITDA adapter): every missing component is named in
 * `warnings` and treated as 0 — never borrowed across period or scope (NG3).
 *
 * Pure — no DB import. The script does the read. Read-only (NG1).
 */

import {
  buildCertifiedSnapshots,
  SENTINEL_PERIOD,
  type CertifiedFactRow,
  type CertifiedPeriodSnapshot,
} from "@/lib/finengine/shadow/dealInputAdapter";
import { coreOperatingEarnings } from "@/lib/finengine/methods/foundation";
import { buildEntityGraph, type EntityGraph, type EntityEdge } from "@/lib/finengine/entityGraph";
import {
  computeGlobalCashFlow,
  type BusinessEntityCashFlow,
  type PersonalGuarantorCashFlow,
  type GlobalCashFlowResult,
} from "@/lib/finengine/methods/global";
import type { EntityNode } from "@/lib/finengine/contracts";

const BUSINESS_NODE_ID = "business";
const GUARANTOR_NODE_ID = "guarantor";

export type GlobalCashFlowInputs = {
  graph: EntityGraph;
  business: BusinessEntityCashFlow[];
  personal: PersonalGuarantorCashFlow[];
  analysisPeriod: string;
  warnings: string[]; // every gap named, never papered over (mirrors the EBITDA adapter)
};

const num = (v: number | null | undefined): number | null => (v == null ? null : v);

/**
 * Live deal-level value for a DEAL-scoped key (debt service, distributions): the
 * non-superseded row with the latest period, |value| as a stable tie-break. These
 * facts are not tied to a fiscal year, so they align by "latest live value" rather
 * than by the analysis period (per the spec's DEAL-scoped rule).
 */
function liveDealValue(rows: CertifiedFactRow[], key: string): number | null {
  const pool = rows.filter((r) => r.fact_key === key && !r.is_superseded && r.fact_value_num != null);
  if (pool.length === 0) return null;
  const sorted = [...pool].sort(
    (a, b) =>
      (a.fact_period_end < b.fact_period_end ? 1 : a.fact_period_end > b.fact_period_end ? -1 : 0) ||
      Math.abs(b.fact_value_num!) - Math.abs(a.fact_value_num!),
  );
  return sorted[0].fact_value_num;
}

/** First present (non-null) fact among the candidate keys in a snapshot's facts. */
function firstPresent(facts: Record<string, number | null>, keys: string[]): { key: string; value: number } | null {
  for (const k of keys) {
    const v = num(facts[k]);
    if (v != null) return { key: k, value: v };
  }
  return null;
}

/**
 * Build `computeGlobalCashFlow` inputs from a deal's certified facts.
 * Pure; reads only the certified snapshots + the deal's rows.
 */
export function buildGlobalCashFlowInputs(
  dealId: string,
  rows: CertifiedFactRow[],
  opts?: { analysisPeriod?: string },
): GlobalCashFlowInputs {
  const warnings: string[] = [];
  const snaps = buildCertifiedSnapshots(dealId, rows);

  // ── analysis period: latest real BUSINESS period (never invented) ──────────
  const businessSnaps = snaps.filter((s) => s.entityScope === "BUSINESS");
  const realBusiness = businessSnaps.filter((s) => s.fiscalPeriodEnd !== SENTINEL_PERIOD);
  const analysisPeriod =
    opts?.analysisPeriod ??
    (realBusiness.length > 0
      ? realBusiness[realBusiness.length - 1].fiscalPeriodEnd // snaps are period-ascending, sentinel last
      : businessSnaps[0]?.fiscalPeriodEnd ?? SENTINEL_PERIOD);
  if (realBusiness.length === 0) {
    warnings.push("no real BUSINESS period — analysis period falls back to sentinel/empty (business cash flow may be 0).");
  }

  // ── BUSINESS node: EBITDA (pre-distribution) + debt service incl. proposed ──
  const bizSnap =
    businessSnaps.find((s) => s.fiscalPeriodEnd === analysisPeriod) ?? businessSnaps[0];
  let operatingCashFlow = 0;
  let baseKey = "NONE";
  let interest = 0;
  let depAmort = 0;
  if (bizSnap) {
    const core = coreOperatingEarnings({ facts: bizSnap.facts, entityForm: "UNKNOWN", fiscalPeriodEnd: analysisPeriod });
    operatingCashFlow = core.value ?? 0;
    baseKey = core.base.key;
    interest = core.interest;
    depAmort = core.depAmort;
    if (core.value == null) warnings.push(`BUSINESS ${analysisPeriod}: EBITDA unresolved (no base income) — operating cash flow treated as 0.`);
  } else {
    warnings.push("no BUSINESS snapshot — business operating cash flow treated as 0.");
  }

  // R4: existing + proposed debt service are SUMMED (not max'd / either-or'd).
  const existingDS = liveDealValue(rows, "ANNUAL_DEBT_SERVICE");
  const proposedDS = liveDealValue(rows, "ANNUAL_DEBT_SERVICE_PROPOSED");
  if (existingDS == null) warnings.push("missing ANNUAL_DEBT_SERVICE (existing) — treated as 0.");
  if (proposedDS == null) warnings.push("missing ANNUAL_DEBT_SERVICE_PROPOSED (proposed loan) — treated as 0; global DSCR will NOT reflect the new loan.");
  const businessDebtService = (existingDS ?? 0) + (proposedDS ?? 0);

  const business: BusinessEntityCashFlow[] = [
    {
      nodeId: BUSINESS_NODE_ID,
      operatingCashFlow,
      businessDebtService,
      ncadsProvenance: {
        nodeId: BUSINESS_NODE_ID,
        base: "EBITDA",
        components: { base: bizSnap ? num(bizSnap.facts[baseKey]) ?? 0 : 0, interest, depAmort, existingDebtService: existingDS ?? 0, proposedDebtService: proposedDS ?? 0 },
        note: `Operating cash flow = conservative EBITDA (base ${baseKey}, pre-distribution); debt service = existing(${existingDS ?? 0}) + proposed(${proposedDS ?? 0}).`,
      },
    },
  ];

  // ── PERSONAL node: external income only (single-count wall) ─────────────────
  const personalSnaps = snaps.filter((s) => s.entityScope === "PERSONAL");
  const personal: PersonalGuarantorCashFlow[] = [];
  const edges: EntityEdge[] = [];

  if (personalSnaps.length > 0) {
    // Tax-derived income reads strictly at the analysis period (NG3 — no cross-period
    // borrow). PFS is a point-in-time statement, read from its own (latest) snapshot.
    const personalAtAnalysis = personalSnaps.find((s) => s.fiscalPeriodEnd === analysisPeriod);
    const pfsSnap = latestPfsSnapshot(personalSnaps);

    const taxFacts = personalAtAnalysis?.facts ?? {};
    const pfsFacts = pfsSnap?.facts ?? {};

    // wages — prefer the tax-return W-2 at the analysis period; fall back to PFS salary.
    const w2 = num(taxFacts["WAGES_W2"]) ?? num(taxFacts["W2_WAGES"]);
    const pfsSalary = num(pfsFacts["PFS_SALARY_WAGES"]);
    const wages = w2 ?? pfsSalary ?? 0;
    if (w2 == null && pfsSalary == null) warnings.push(`PERSONAL: no wages (WAGES_W2 at ${analysisPeriod} or PFS_SALARY_WAGES) — treated as 0.`);
    else if (w2 == null) warnings.push(`PERSONAL: no W-2 wages at ${analysisPeriod}; used PFS_SALARY_WAGES (${pfsSalary}).`);

    // net rental — a true net Sch E figure if resolvable, else gross rents + overstatement warning.
    const net = firstPresent(taxFacts, ["SCH_E_RENTAL_TOTAL", "SCH_E_NET_PER_PROPERTY", "NET_RENTAL_INCOME"]);
    const gross = firstPresent(taxFacts, ["SCH_E_GROSS_RENTS_RECEIVED", "SCH_E_RENTS_RECEIVED"]);
    let netRental = 0;
    if (net) netRental = net.value;
    else if (gross) {
      netRental = gross.value;
      warnings.push(`PERSONAL: only gross Schedule E rents (${gross.key}=${gross.value}) — net rental OVERSTATED (no Sch E operating expenses extracted).`);
    } else {
      warnings.push("PERSONAL: no Schedule E rental income — treated as 0.");
    }

    // investment — dividends + interest if present, else 0 + warning.
    const div = num(taxFacts["F1099DIV_ORDINARY"]);
    const int = num(taxFacts["F1099INT_INTEREST"]);
    const investment = (div ?? 0) + (int ?? 0);
    if (div == null && int == null) warnings.push("PERSONAL: no dividend/interest income facts — investment income treated as 0.");

    const personalDebtService = num(pfsFacts["PFS_ANNUAL_DEBT_SERVICE"]) ?? 0;
    if (pfsFacts["PFS_ANNUAL_DEBT_SERVICE"] == null) warnings.push("PERSONAL: missing PFS_ANNUAL_DEBT_SERVICE — personal debt service treated as 0.");

    const statedLiving = num(pfsFacts["PFS_LIVING_EXPENSES"]);
    if (statedLiving == null) warnings.push("PERSONAL: missing PFS_LIVING_EXPENSES — living expenses fall to the next available basis (none → 0).");

    personal.push({
      nodeId: GUARANTOR_NODE_ID,
      income: { wages, netRental, investment, other: 0 }, // NO distributions, NO k1Ordinary (single-count wall)
      personalDebtService,
      livingExpenses: { stated: statedLiving, fromHousing: null, sbaMinimum: null },
    });

    // R2: v1 aggregates all guarantors into one node — make the limitation visible.
    warnings.push("v1 aggregates all guarantors into a single personal node; per-guarantor attribution requires the (empty) entity-graph tables — documented follow-on.");

    // ── distribution edge: business → personal (the single-count proof) ───────
    const distribution = liveDealValue(rows, "M2_DISTRIBUTIONS") ?? liveDealValue(rows, "DISTRIBUTIONS") ?? 0;
    if (liveDealValue(rows, "M2_DISTRIBUTIONS") == null && liveDealValue(rows, "DISTRIBUTIONS") == null) {
      warnings.push("no distributions fact (M2_DISTRIBUTIONS / DISTRIBUTIONS) — distribution edge set to 0.");
    }
    edges.push({ from: BUSINESS_NODE_ID, to: GUARANTOR_NODE_ID, type: "distribution", amount: distribution });
  } else {
    warnings.push("no PERSONAL (guarantor) facts — global cash flow is business-only.");
  }

  // ── graph ───────────────────────────────────────────────────────────────────
  const nodes: EntityNode[] = [
    { id: BUSINESS_NODE_ID, ownerType: "borrower", displayName: "Operating Business", form: "UNKNOWN", isPrimaryOperating: true },
  ];
  if (personal.length > 0) {
    nodes.push({ id: GUARANTOR_NODE_ID, ownerType: "guarantor", displayName: "Guarantor (aggregated)", form: "INDIVIDUAL", isGuarantor: true });
  }
  const graph = buildEntityGraph(nodes, edges);

  return { graph, business, personal, analysisPeriod, warnings };
}

/** Latest PERSONAL snapshot that carries any PFS-sourced key (PFS is point-in-time). */
function latestPfsSnapshot(personalSnaps: CertifiedPeriodSnapshot[]): CertifiedPeriodSnapshot | undefined {
  const withPfs = personalSnaps.filter((s) => Object.keys(s.facts).some((k) => k.startsWith("PFS_")));
  if (withPfs.length === 0) return undefined;
  // personalSnaps are period-ascending (sentinel last); take the latest real one.
  return [...withPfs].sort((a, b) => (a.fiscalPeriodEnd < b.fiscalPeriodEnd ? -1 : 1)).at(-1);
}

export type GlobalCashFlowShadowResult = {
  dealId: string;
  inputs: GlobalCashFlowInputs;
  result: GlobalCashFlowResult;
};

/**
 * Convenience runner: assemble inputs → computeGlobalCashFlow → return both for
 * inspection. No diff/golden yet (that is the decision-core shadow spec). Pure.
 */
export function runGlobalCashFlowShadow(dealId: string, rows: CertifiedFactRow[], opts?: { analysisPeriod?: string }): GlobalCashFlowShadowResult {
  const inputs = buildGlobalCashFlowInputs(dealId, rows, opts);
  const result = computeGlobalCashFlow(inputs.graph, inputs.business, inputs.personal);
  return { dealId, inputs, result };
}
