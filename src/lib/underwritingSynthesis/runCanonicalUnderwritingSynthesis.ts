import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertDealFinancialFact, SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import { CANONICAL_FACTS } from "@/lib/financialFacts/keys";
import { backfillCanonicalFactsFromSpreads } from "@/lib/financialFacts/backfillFromSpreads";
import { getCanonicalMemoStatusForDeals } from "@/lib/creditMemo/canonical/getCanonicalMemoStatusForDeals";
import { computeDebtService } from "@/lib/structuralPricing/debtServiceMath";
import { writeEvent } from "@/lib/ledger/writeEvent";
import {
  computeSourcesUsesFacts,
  computeCollateralFactValues,
  computeFinancialAnalysisFacts,
  computeArBorrowingBaseFacts,
  type MissingInput,
  type CollateralInput,
  type ArAgingInput,
} from "./computePure";

// ── Types ──────────────────────────────────────────────────────────────

export type SynthesisArgs = {
  dealId: string;
  bankId: string;
  userId?: string | null;
  force?: boolean;
  reason?: string | null;
};

export type SynthesisResult =
  | {
      ok: true;
      runId: string;
      dealId: string;
      factsWritten: number;
      factsSkipped: number;
      writtenFacts: string[];
      skippedFacts: string[];
      missingInputs: MissingInput[];
      missing: string[];
      readiness: { status: string; missing_spreads: string[] };
      readinessStatus: string;
      warnings: string[];
    }
  | { ok: false; error: string };

// ── Canonical key → DB column mapping ────────────────────────────────

const COLLATERAL_FACT_MAP: Record<string, { factType: string; factKey: string }> = {
  COLLATERAL_GROSS_VALUE: { factType: CANONICAL_FACTS.COLLATERAL_GROSS_VALUE.fact_type, factKey: CANONICAL_FACTS.COLLATERAL_GROSS_VALUE.fact_key },
  COLLATERAL_NET_VALUE: { factType: CANONICAL_FACTS.COLLATERAL_NET_VALUE.fact_type, factKey: CANONICAL_FACTS.COLLATERAL_NET_VALUE.fact_key },
  COLLATERAL_DISCOUNTED_VALUE: { factType: CANONICAL_FACTS.COLLATERAL_DISCOUNTED_VALUE.fact_type, factKey: CANONICAL_FACTS.COLLATERAL_DISCOUNTED_VALUE.fact_key },
  COLLATERAL_DISCOUNTED_COVERAGE: { factType: CANONICAL_FACTS.COLLATERAL_DISCOUNTED_COVERAGE.fact_type, factKey: CANONICAL_FACTS.COLLATERAL_DISCOUNTED_COVERAGE.fact_key },
  LTV_GROSS: { factType: CANONICAL_FACTS.LTV_GROSS.fact_type, factKey: CANONICAL_FACTS.LTV_GROSS.fact_key },
  LTV_NET: { factType: CANONICAL_FACTS.LTV_NET.fact_type, factKey: CANONICAL_FACTS.LTV_NET.fact_key },
};

const SOURCES_USES_FACT_MAP: Record<string, { factType: string; factKey: string }> = {
  BANK_LOAN_TOTAL: { factType: CANONICAL_FACTS.BANK_LOAN_TOTAL.fact_type, factKey: CANONICAL_FACTS.BANK_LOAN_TOTAL.fact_key },
  TOTAL_PROJECT_COST: { factType: CANONICAL_FACTS.TOTAL_PROJECT_COST.fact_type, factKey: CANONICAL_FACTS.TOTAL_PROJECT_COST.fact_key },
  BORROWER_EQUITY: { factType: CANONICAL_FACTS.BORROWER_EQUITY.fact_type, factKey: CANONICAL_FACTS.BORROWER_EQUITY.fact_key },
  BORROWER_EQUITY_PCT: { factType: CANONICAL_FACTS.BORROWER_EQUITY_PCT.fact_type, factKey: CANONICAL_FACTS.BORROWER_EQUITY_PCT.fact_key },
};

const AR_FACT_MAP: Record<string, { factType: string; factKey: string }> = {
  AR_TOTAL: { factType: CANONICAL_FACTS.AR_TOTAL.fact_type, factKey: CANONICAL_FACTS.AR_TOTAL.fact_key },
  AR_ELIGIBLE: { factType: CANONICAL_FACTS.AR_ELIGIBLE.fact_type, factKey: CANONICAL_FACTS.AR_ELIGIBLE.fact_key },
  AR_INELIGIBLE: { factType: CANONICAL_FACTS.AR_INELIGIBLE.fact_type, factKey: CANONICAL_FACTS.AR_INELIGIBLE.fact_key },
  AR_ADVANCE_RATE: { factType: CANONICAL_FACTS.AR_ADVANCE_RATE.fact_type, factKey: CANONICAL_FACTS.AR_ADVANCE_RATE.fact_key },
  AR_BORROWING_BASE_VALUE: { factType: CANONICAL_FACTS.AR_BORROWING_BASE_VALUE.fact_type, factKey: CANONICAL_FACTS.AR_BORROWING_BASE_VALUE.fact_key },
  AR_BORROWING_BASE_AVAILABILITY: { factType: CANONICAL_FACTS.AR_BORROWING_BASE_AVAILABILITY.fact_type, factKey: CANONICAL_FACTS.AR_BORROWING_BASE_AVAILABILITY.fact_key },
};

// ── Canonical-named alias writes ─────────────────────────────────────
// After writing legacy keys (GROSS_VALUE, BORROWER_EQUITY, etc.), also
// write canonical-named keys so both exist in deal_financial_facts.
// Maps: computePure canonical key → { factType, factKey } for the
// canonical-named version that must also exist in DB.
const CANONICAL_ALIAS_WRITES: Record<string, { factType: string; factKey: string }> = {
  // Collateral: computePure emits COLLATERAL_GROSS_VALUE → written as GROSS_VALUE;
  // also write as COLLATERAL_GROSS_VALUE
  COLLATERAL_GROSS_VALUE: { factType: "COLLATERAL", factKey: "COLLATERAL_GROSS_VALUE" },
  COLLATERAL_NET_VALUE: { factType: "COLLATERAL", factKey: "COLLATERAL_NET_VALUE" },
  COLLATERAL_DISCOUNTED_VALUE: { factType: "COLLATERAL", factKey: "COLLATERAL_DISCOUNTED_VALUE" },
  COLLATERAL_DISCOUNTED_COVERAGE: { factType: "COLLATERAL", factKey: "COLLATERAL_COVERAGE_RATIO" },
  // Sources/Uses: BORROWER_EQUITY → also EQUITY_INJECTION
  BORROWER_EQUITY: { factType: "SOURCES_USES", factKey: "EQUITY_INJECTION" },
  BORROWER_EQUITY_PCT: { factType: "SOURCES_USES", factKey: "EQUITY_INJECTION_PCT" },
};

// Financial analysis facts have fact_key === canonical_key, all FINANCIAL_ANALYSIS type
const FA_FACT_TYPE = "FINANCIAL_ANALYSIS";

// All required financial analysis keys tracked by this synthesis
const FA_TRACKED_KEYS = [
  "CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE", "EXCESS_CASH_FLOW",
  "DSCR", "DSCR_STRESSED_300BPS", "ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
];

// ── Main orchestrator ────────────────────────────────────────────────

export async function runCanonicalUnderwritingSynthesis(
  args: SynthesisArgs,
): Promise<SynthesisResult> {
  const { dealId, bankId, userId, force, reason } = args;
  const runId = crypto.randomUUID();
  const asOfDate = new Date().toISOString().slice(0, 10);
  const writtenFacts: string[] = [];
  const skippedFacts: string[] = [];
  const missingInputs: MissingInput[] = [];
  const warnings: string[] = [];

  try {
    const sb = supabaseAdmin();

    // ── 1. Load deal context (parallel) ──────────────────────────────
    const [
      collateralRes,
      proceedsRes,
      loanReqRes,
      loanReqControlRes,
      structPricingRes,
      existingDebtRes,
      arAgingRes,
      borrowingBaseRes,
    ] = await Promise.all([
      (sb as any).from("deal_collateral_items")
        .select("id, item_type, estimated_value, advance_rate")
        .eq("deal_id", dealId),
      (sb as any).from("deal_proceeds_items")
        .select("id, amount")
        .eq("deal_id", dealId),
      (sb as any).from("deal_loan_requests")
        .select("requested_amount, approved_amount")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      (sb as any).from("loan_requests")
        .select("loan_amount")
        .eq("deal_id", dealId)
        .maybeSingle(),
      (sb as any).from("deal_structural_pricing")
        .select("annual_debt_service_est, structural_rate_pct, loan_amount, amort_months, interest_only_months")
        .eq("deal_id", dealId)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      (sb as any).from("deal_existing_debt_schedule")
        .select("annual_debt_service, monthly_payment")
        .eq("deal_id", dealId)
        .eq("included_in_global", true)
        .eq("is_being_refinanced", false),
      // AR aging — latest report for this deal
      (sb as any).from("ar_aging_reports")
        .select("id, total_ar, extraction_status")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Borrowing base — latest calculation
      (sb as any).from("borrowing_base_calculations")
        .select("gross_ar, ineligible_ar, eligible_ar, advance_rate, net_availability")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    // Parse collateral
    const collateral: CollateralInput[] = (collateralRes.data ?? []).map((r: any) => ({
      estimated_value: r.estimated_value != null ? Number(r.estimated_value) : null,
      advance_rate: r.advance_rate != null ? Number(r.advance_rate) : null,
      item_type: String(r.item_type ?? "other"),
    }));

    // Parse proceeds total
    const proceedsTotal: number | null = (() => {
      const items = proceedsRes.data ?? [];
      if (items.length === 0) return null;
      const sum = items.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
      return sum > 0 ? sum : null;
    })();

    // Resolve loan amount: control layer > approved > requested
    const loanAmount: number | null = (() => {
      const ctrl = loanReqControlRes.data?.loan_amount;
      if (ctrl != null && Number(ctrl) > 0) return Number(ctrl);
      const legacy = loanReqRes.data;
      if (legacy?.approved_amount != null && Number(legacy.approved_amount) > 0) return Number(legacy.approved_amount);
      if (legacy?.requested_amount != null && Number(legacy.requested_amount) > 0) return Number(legacy.requested_amount);
      return null;
    })();

    // Parse AR aging input
    const arAgingInput: ArAgingInput | null = (() => {
      const bb = borrowingBaseRes.data;
      const ar = arAgingRes.data;
      if (!bb && !ar) return null;
      // Prefer borrowing_base_calculations (richer), fall back to ar_aging_reports
      return {
        total_ar: bb?.gross_ar != null ? Number(bb.gross_ar) : (ar?.total_ar != null ? Number(ar.total_ar) : null),
        eligible_ar: bb?.eligible_ar != null ? Number(bb.eligible_ar) : null,
        ineligible_ar: bb?.ineligible_ar != null ? Number(bb.ineligible_ar) : null,
        advance_rate: bb?.advance_rate != null ? Number(bb.advance_rate) : null,
        net_availability: bb?.net_availability != null ? Number(bb.net_availability) : null,
      };
    })();

    // ── 2. Materialize financial analysis facts (backfill from spreads) ──
    const backfillResult = await backfillCanonicalFactsFromSpreads({ dealId, bankId });
    if (backfillResult.ok && backfillResult.factsWritten > 0) {
      warnings.push(`backfill wrote ${backfillResult.factsWritten} facts from spreads`);
    }

    // Read current facts after backfill (or force-read all)
    const factQuery = (sb as any)
      .from("deal_financial_facts")
      .select("fact_type, fact_key, fact_value_num, resolution_status")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("is_superseded", false);

    // When not forcing, exclude rejected facts from computation inputs
    if (!force) {
      factQuery.neq("resolution_status", "rejected");
    }

    const { data: currentFactRows } = await factQuery;

    const factValueMap = new Map<string, number>();
    const manualOrRejectedKeys = new Set<string>();
    for (const f of currentFactRows ?? []) {
      const compositeKey = `${f.fact_type}::${f.fact_key}`;
      if (f.resolution_status === "rejected") {
        manualOrRejectedKeys.add(compositeKey);
        continue;
      }
      if (f.fact_value_num != null) {
        factValueMap.set(compositeKey, Number(f.fact_value_num));
      }
    }

    const hasFact = (ft: string, fk: string) => factValueMap.has(`${ft}::${fk}`);
    const getFactValue = (ft: string, fk: string) => factValueMap.get(`${ft}::${fk}`) ?? null;
    const isRejected = (ft: string, fk: string) => !force && manualOrRejectedKeys.has(`${ft}::${fk}`);

    // ── 2b. Fill financial analysis gaps from structural pricing ──────
    const spRow = structPricingRes.data;
    const existingDebtRows = existingDebtRes.data ?? [];

    const needsFinancialFill = force || FA_TRACKED_KEYS.some((k) => !hasFact(FA_FACT_TYPE, k));

    if (needsFinancialFill && spRow?.annual_debt_service_est != null) {
      const proposedAds = Number(spRow.annual_debt_service_est);

      // Sum existing debt
      let existingDebt = 0;
      for (const row of existingDebtRows) {
        if (row.annual_debt_service != null) existingDebt += Number(row.annual_debt_service);
        else if (row.monthly_payment != null) existingDebt += Number(row.monthly_payment) * 12;
      }

      // Compute stressed ADS
      let stressedAds: number | null = null;
      const structRate = spRow.structural_rate_pct != null ? Number(spRow.structural_rate_pct) : null;
      const spLoanAmt = spRow.loan_amount != null ? Number(spRow.loan_amount) : null;
      const amortMo = spRow.amort_months != null ? Number(spRow.amort_months) : null;
      const ioMo = spRow.interest_only_months != null ? Number(spRow.interest_only_months) : 0;

      if (structRate != null && spLoanAmt != null && amortMo != null) {
        const stressedDs = computeDebtService({
          principal: spLoanAmt,
          ratePct: structRate + 3.0,
          amortMonths: amortMo,
          interestOnlyMonths: ioMo,
        });
        if (stressedDs.annualDebtService != null) {
          stressedAds = stressedDs.annualDebtService + existingDebt;
        }
      }

      const cfa = getFactValue(FA_FACT_TYPE, "CASH_FLOW_AVAILABLE");

      const faResult = computeFinancialAnalysisFacts({
        cashFlowAvailable: cfa,
        proposedAds,
        existingDebt,
        stressedAds,
      });

      // Write only facts not already present from backfill (unless force=true)
      for (const [key, value] of Object.entries(faResult.facts)) {
        if (isRejected(FA_FACT_TYPE, key)) {
          skippedFacts.push(key);
          warnings.push(`${key}: skipped (rejected by banker)`);
          continue;
        }
        if (!force && hasFact(FA_FACT_TYPE, key)) {
          skippedFacts.push(key);
          continue;
        }
        await supersedePriorFacts(sb, dealId, bankId, FA_FACT_TYPE, key);
        const res = await upsertDealFinancialFact({
          dealId,
          bankId,
          sourceDocumentId: SENTINEL_UUID,
          factType: FA_FACT_TYPE,
          factKey: key,
          factValueNum: value,
          confidence: 0.9,
          factPeriodEnd: asOfDate,
          provenance: {
            source_type: "STRUCTURAL",
            source_ref: `synthesis:financial_analysis:${dealId}`,
            as_of_date: asOfDate,
            extractor: "underwritingSynthesis:v2",
            calc: faCalcDescription(key, faResult.facts),
          },
          ownerType: "DEAL",
          ownerEntityId: SENTINEL_UUID,
        });
        if (res.ok) {
          writtenFacts.push(key);
          factValueMap.set(`${FA_FACT_TYPE}::${key}`, value);
        }
      }
      missingInputs.push(...faResult.missing);
    }

    // Track skipped/missing for all financial analysis keys
    for (const key of FA_TRACKED_KEYS) {
      if (writtenFacts.includes(key) || skippedFacts.includes(key)) continue;
      if (missingInputs.some((m) => m.factKey === key)) continue;
      if (hasFact(FA_FACT_TYPE, key)) {
        skippedFacts.push(key);
      } else {
        missingInputs.push({ factKey: key, reason: "not_available" });
      }
    }

    // ── 3. Materialize sources/uses facts ────────────────────────────
    const suResult = computeSourcesUsesFacts({ loanAmount, proceedsTotal });
    missingInputs.push(...suResult.missing);

    for (const [canonicalKey, value] of Object.entries(suResult.facts)) {
      const mapping = SOURCES_USES_FACT_MAP[canonicalKey];
      if (!mapping) continue;
      if (isRejected(mapping.factType, mapping.factKey)) {
        skippedFacts.push(canonicalKey);
        continue;
      }
      await supersedePriorFacts(sb, dealId, bankId, mapping.factType, mapping.factKey);
      const res = await upsertDealFinancialFact({
        dealId,
        bankId,
        sourceDocumentId: SENTINEL_UUID,
        factType: mapping.factType,
        factKey: mapping.factKey,
        factValueNum: value,
        confidence: 0.95,
        factPeriodEnd: asOfDate,
        provenance: {
          source_type: "STRUCTURAL",
          source_ref: `synthesis:sources_uses:${dealId}`,
          as_of_date: asOfDate,
          extractor: "underwritingSynthesis:v2",
          calc: suCalcDescription(canonicalKey, suResult.facts),
        },
        ownerType: "DEAL",
        ownerEntityId: SENTINEL_UUID,
      });
      if (res.ok) writtenFacts.push(canonicalKey);
    }

    // ── 4. Materialize collateral facts ──────────────────────────────
    const bankLoanTotal =
      suResult.facts.BANK_LOAN_TOTAL ??
      getFactValue("SOURCES_USES", CANONICAL_FACTS.BANK_LOAN_TOTAL.fact_key) ??
      loanAmount;

    const colResult = computeCollateralFactValues({ collateral, bankLoanTotal });
    missingInputs.push(...colResult.missing);

    for (const [canonicalKey, value] of Object.entries(colResult.facts)) {
      const mapping = COLLATERAL_FACT_MAP[canonicalKey];
      if (!mapping) continue;
      if (isRejected(mapping.factType, mapping.factKey)) {
        skippedFacts.push(canonicalKey);
        continue;
      }
      await supersedePriorFacts(sb, dealId, bankId, mapping.factType, mapping.factKey);
      const res = await upsertDealFinancialFact({
        dealId,
        bankId,
        sourceDocumentId: SENTINEL_UUID,
        factType: mapping.factType,
        factKey: mapping.factKey,
        factValueNum: value,
        confidence: 0.95,
        factPeriodEnd: asOfDate,
        provenance: {
          source_type: "STRUCTURAL",
          source_ref: `synthesis:collateral:${dealId}`,
          as_of_date: asOfDate,
          extractor: "underwritingSynthesis:v2",
          calc: colCalcDescription(canonicalKey, colResult.facts, bankLoanTotal),
        },
        ownerType: "DEAL",
        ownerEntityId: SENTINEL_UUID,
      });
      if (res.ok) writtenFacts.push(canonicalKey);
    }

    // ── 4b. Write canonical-named aliases for collateral + sources/uses ─
    // Both legacy keys (GROSS_VALUE, BORROWER_EQUITY) and canonical keys
    // (COLLATERAL_GROSS_VALUE, EQUITY_INJECTION) must exist as DB rows.
    const allComputedFacts: Record<string, number> = {
      ...suResult.facts,
      ...colResult.facts,
    };
    for (const [computedKey, value] of Object.entries(allComputedFacts)) {
      const alias = CANONICAL_ALIAS_WRITES[computedKey];
      if (!alias) continue;
      if (isRejected(alias.factType, alias.factKey)) continue;
      await supersedePriorFacts(sb, dealId, bankId, alias.factType, alias.factKey);
      const res = await upsertDealFinancialFact({
        dealId,
        bankId,
        sourceDocumentId: SENTINEL_UUID,
        factType: alias.factType,
        factKey: alias.factKey,
        factValueNum: value,
        confidence: 0.95,
        factPeriodEnd: asOfDate,
        provenance: {
          source_type: "STRUCTURAL",
          source_ref: `synthesis:canonical_alias:${dealId}`,
          as_of_date: asOfDate,
          extractor: "underwritingSynthesis:v2",
          calc: `canonical alias of ${computedKey} = ${value}`,
        },
        ownerType: "DEAL",
        ownerEntityId: SENTINEL_UUID,
      });
      if (res.ok) writtenFacts.push(alias.factKey);
    }

    // ── 5. Materialize AR / borrowing base facts ────────────────────
    const arResult = computeArBorrowingBaseFacts({ arAging: arAgingInput, bankLoanTotal });
    missingInputs.push(...arResult.missing);

    for (const [canonicalKey, value] of Object.entries(arResult.facts)) {
      const mapping = AR_FACT_MAP[canonicalKey];
      if (!mapping) continue;
      if (isRejected(mapping.factType, mapping.factKey)) {
        skippedFacts.push(canonicalKey);
        continue;
      }
      await supersedePriorFacts(sb, dealId, bankId, mapping.factType, mapping.factKey);
      const res = await upsertDealFinancialFact({
        dealId,
        bankId,
        sourceDocumentId: SENTINEL_UUID,
        factType: mapping.factType,
        factKey: mapping.factKey,
        factValueNum: value,
        confidence: 0.90,
        factPeriodEnd: asOfDate,
        provenance: {
          source_type: "STRUCTURAL",
          source_ref: `synthesis:ar_borrowing_base:${dealId}`,
          as_of_date: asOfDate,
          extractor: "underwritingSynthesis:v2",
        },
        ownerType: "DEAL",
        ownerEntityId: SENTINEL_UUID,
      });
      if (res.ok) writtenFacts.push(canonicalKey);
    }

    // ── 6. Recompute readiness ───────────────────────────────────────
    const statusMap = await getCanonicalMemoStatusForDeals({ bankId, dealIds: [dealId] });
    const readinessRow = statusMap[dealId];
    const readinessStatus = readinessRow?.status ?? "pending";
    const readiness = {
      status: readinessStatus,
      missing_spreads: readinessRow?.missing_spreads ?? [],
    };

    const missingKeys = missingInputs.map((m) => m.factKey);

    // ── 7. Emit ledger event ─────────────────────────────────────────
    writeEvent({
      dealId,
      kind: "synthesis.run_completed",
      actorUserId: userId ?? null,
      scope: "underwriting",
      action: "synthesis_run",
      input: { force: force ?? false, reason: reason ?? null },
      output: {
        runId,
        factsWritten: writtenFacts.length,
        factsSkipped: skippedFacts.length,
        missingFacts: missingKeys,
        readinessStatus,
      },
      meta: {
        run_id: runId,
        extractor_version: "underwritingSynthesis:v2",
      },
    }).catch(() => {
      // Fire-and-forget — never fail synthesis because of ledger write
    });

    return {
      ok: true,
      runId,
      dealId,
      factsWritten: writtenFacts.length,
      factsSkipped: skippedFacts.length,
      writtenFacts,
      skippedFacts,
      missingInputs,
      missing: missingKeys,
      readiness,
      readinessStatus,
      warnings,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);

    // Emit failure event (fire-and-forget)
    writeEvent({
      dealId,
      kind: "synthesis.run_failed",
      actorUserId: userId ?? null,
      scope: "underwriting",
      action: "synthesis_run",
      output: { runId, errorMessage: msg },
      meta: { run_id: runId },
    }).catch(() => {});

    return { ok: false, error: msg };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Mark older non-rejected facts for the same (deal, bank, type, key) as superseded.
 * Rejected facts are preserved — their is_superseded flag is not changed.
 */
async function supersedePriorFacts(
  sb: any,
  dealId: string,
  bankId: string,
  factType: string,
  factKey: string,
): Promise<void> {
  await sb
    .from("deal_financial_facts")
    .update({ is_superseded: true })
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("fact_type", factType)
    .eq("fact_key", factKey)
    .eq("is_superseded", false)
    .neq("resolution_status", "rejected");
}

function faCalcDescription(key: string, facts: Record<string, number>): string {
  switch (key) {
    case "ANNUAL_DEBT_SERVICE":
      return `proposed + existing = ${facts.ANNUAL_DEBT_SERVICE}`;
    case "DSCR":
      return `cash_flow_available / annual_debt_service = ${facts.DSCR}`;
    case "EXCESS_CASH_FLOW":
      return `cash_flow_available - annual_debt_service = ${facts.EXCESS_CASH_FLOW}`;
    case "ANNUAL_DEBT_SERVICE_STRESSED_300BPS":
      return `stressed_proposed + existing = ${facts.ANNUAL_DEBT_SERVICE_STRESSED_300BPS}`;
    case "DSCR_STRESSED_300BPS":
      return `cash_flow_available / stressed_ads = ${facts.DSCR_STRESSED_300BPS}`;
    default:
      return key;
  }
}

function suCalcDescription(key: string, facts: Record<string, number>): string {
  switch (key) {
    case "BANK_LOAN_TOTAL":
      return `loan_request.loan_amount = ${facts.BANK_LOAN_TOTAL}`;
    case "TOTAL_PROJECT_COST":
      return `sum(deal_proceeds_items.amount) = ${facts.TOTAL_PROJECT_COST}`;
    case "BORROWER_EQUITY":
      return `${facts.TOTAL_PROJECT_COST} - ${facts.BANK_LOAN_TOTAL} = ${facts.BORROWER_EQUITY}`;
    case "BORROWER_EQUITY_PCT":
      return `${facts.BORROWER_EQUITY} / ${facts.TOTAL_PROJECT_COST} = ${facts.BORROWER_EQUITY_PCT}`;
    default:
      return key;
  }
}

function colCalcDescription(key: string, facts: Record<string, number>, bankLoanTotal: number | null): string {
  switch (key) {
    case "COLLATERAL_GROSS_VALUE":
      return `sum(estimated_value) = ${facts.COLLATERAL_GROSS_VALUE}`;
    case "COLLATERAL_NET_VALUE":
      return `sum(estimated_value * advance_rate) = ${facts.COLLATERAL_NET_VALUE}`;
    case "COLLATERAL_DISCOUNTED_VALUE":
      return `sum(estimated_value * advance_rate) = ${facts.COLLATERAL_DISCOUNTED_VALUE}`;
    case "COLLATERAL_DISCOUNTED_COVERAGE":
      return `${facts.COLLATERAL_DISCOUNTED_VALUE} / ${bankLoanTotal} = ${facts.COLLATERAL_DISCOUNTED_COVERAGE}`;
    case "LTV_GROSS":
      return `${bankLoanTotal} / ${facts.COLLATERAL_GROSS_VALUE} = ${facts.LTV_GROSS}`;
    case "LTV_NET":
      return `${bankLoanTotal} / ${facts.COLLATERAL_NET_VALUE} = ${facts.LTV_NET}`;
    default:
      return key;
  }
}
