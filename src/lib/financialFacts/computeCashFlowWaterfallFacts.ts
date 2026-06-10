import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertDealFinancialFact, SENTINEL_UUID, SENTINEL_DATE } from "@/lib/financialFacts/writeFact";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { loadDealMethodology } from "@/lib/methodology/loadDealMethodology";
import { computeCashFlowWaterfall } from "@/lib/spreads/cashFlowWaterfall";
import {
  selectCompleteFiscalYearPeriod,
  buildWaterfallInputFromFacts,
  type PeriodFact,
} from "@/lib/financialFacts/cashFlowWaterfallInput";
import { reconcileFinancialFacts, type ReconcileFact } from "@/lib/financialFacts/reconcileFinancialFacts";

/**
 * SPEC-CANONICAL-NCADS-WATERFALL-WIRING-1 (Step 1) — canonical NCADS writer.
 *
 * Sources institutional cash-flow-waterfall inputs from DB facts for the MOST RECENT
 * COMPLETE FISCAL YEAR (never an interim quarter), runs the pure computeCashFlowWaterfall,
 * and persists CF_NCADS as the canonical CASH_FLOW_AVAILABLE with full provenance
 * (base, addbacks, QoE, owner benefit, tax/capex, selected period, source facts).
 *
 * Runs AFTER computeBusinessEbitdaFacts + analyzeOfficerCompFacts, BEFORE
 * runCashFlowAggregator (which then prefers this CF_NCADS over its crude fallbacks).
 * DSCR is owned downstream by computeTotalDebtService — this writer never writes DSCR.
 * Never throws.
 */

const INPUT_FACT_KEYS = [
  "ORDINARY_BUSINESS_INCOME",
  "TAXABLE_INCOME",
  "NET_INCOME",
  "DEPRECIATION",
  "AMORTIZATION",
  "SECTION_179_EXPENSE",
  "BONUS_DEPRECIATION",
  "INTEREST_EXPENSE",
  "NON_RECURRING_INCOME",
  "NON_RECURRING_EXPENSE",
  "OFFICER_COMPENSATION",
  "GUARANTEED_PAYMENTS",
  "GROSS_RECEIPTS",
  "TOTAL_TAX",
  "M1_FEDERAL_TAX_BOOK",
  "MAINTENANCE_CAPEX",
  "SCH_C_NET_PROFIT",
];

export type ComputeCashFlowWaterfallResult =
  | { ok: true; period: string; ncads: number | null; wrote: number }
  | { ok: false; reason: "no_complete_fiscal_year" | "no_ncads" | "query_failed"; detail?: string };

export async function computeCashFlowWaterfallFacts(args: {
  dealId: string;
  bankId: string;
}): Promise<ComputeCashFlowWaterfallResult> {
  const { dealId, bankId } = args;
  try {
    const sb = supabaseAdmin();

    const { data: rawRows, error } = await (sb as any)
      .from("deal_financial_facts")
      .select("id, fact_key, fact_value_num, fact_period_end, owner_type, owner_entity_id, source_document_id, source_canonical_type, confidence, provenance")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("owner_type", "DEAL")
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected")
      .in("fact_key", INPUT_FACT_KEYS)
      .not("fact_value_num", "is", null);

    if (error) return { ok: false, reason: "query_failed", detail: error.message };

    // SPEC-SPREAD-FACT-RECONCILIATION-AND-CONFIDENCE-GATES-1: reconcile duplicate /
    // impossible / conflicting facts BEFORE they feed NCADS. Rejected facts are
    // excluded from selection (never deleted) and audited via a ledger event.
    const reconcileInput: ReconcileFact[] = ((rawRows ?? []) as any[]).map((r) => ({
      id: r.id ?? null,
      fact_key: r.fact_key,
      fact_period_end: r.fact_period_end ?? null,
      owner_type: r.owner_type,
      owner_entity_id: r.owner_entity_id ?? null,
      source_document_id: r.source_document_id ?? null,
      source_canonical_type: r.source_canonical_type ?? null,
      confidence: r.confidence ?? null,
      extractor: r.provenance?.extractor ?? null,
      fact_value_num: r.fact_value_num !== null ? Number(r.fact_value_num) : null,
    }));
    const reconciliation = reconcileFinancialFacts(reconcileInput);
    if (reconciliation.rejected.length > 0) {
      void writeEvent({
        dealId,
        kind: "deal.compute.fact_reconciliation",
        meta: {
          severity: "warning",
          rejected_count: reconciliation.rejected.length,
          confidence_tier: reconciliation.confidenceTier,
          rejected: reconciliation.rejected.slice(0, 20).map((x) => ({
            fact_key: x.fact.fact_key,
            value: x.fact.fact_value_num,
            period: x.fact.fact_period_end,
            extractor: x.fact.extractor,
            conflict_class: x.conflictClass,
            reason: x.reason,
          })),
        },
      }).catch(() => {});
    }

    // Only reconciliation-SELECTED facts feed NCADS.
    const rows = reconciliation.selected;
    const facts: PeriodFact[] = rows.map((r) => ({
      fact_key: r.fact_key,
      fact_value_num: r.fact_value_num,
      fact_period_end: r.fact_period_end,
    }));

    // 1. Select the most recent COMPLETE fiscal year (never interim).
    const period = selectCompleteFiscalYearPeriod(facts);
    if (!period) {
      // Labeled diagnostic — no fabricated precision. The aggregator's cold-start
      // bootstrap remains the fallback.
      void writeEvent({
        dealId,
        kind: "deal.compute.missing_prereq",
        meta: {
          error_code: "NCADS_NO_COMPLETE_FISCAL_YEAR",
          severity: "warning",
          detail: "No complete fiscal-year period with an income base fact; waterfall NCADS skipped (aggregator bootstrap applies).",
        },
      }).catch(() => {});
      return { ok: false, reason: "no_complete_fiscal_year" };
    }

    // 2. Build the period's fact map (highest-confidence fact per key for that period).
    const factMap: Record<string, number | null> = {};
    for (const k of INPUT_FACT_KEYS) {
      const periodRows = (rows as any[]).filter(
        (r) => r.fact_key === k && r.fact_period_end === period,
      );
      if (periodRows.length === 0) {
        factMap[k] = null;
        continue;
      }
      periodRows.sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0));
      factMap[k] = periodRows[0].fact_value_num !== null ? Number(periodRows[0].fact_value_num) : null;
    }

    // 3. Build waterfall input (reuses ebitdaEngine base + ownerCompTreatment).
    const { slate } = await loadDealMethodology(dealId, bankId);
    const built = buildWaterfallInputFromFacts(factMap, slate);

    // No income base → NCADS would be fabricated from addbacks alone (e.g. just D&A).
    // Emit a labeled diagnostic instead of fake precision.
    if (built.input.netIncomeBase === null) {
      void writeEvent({
        dealId,
        kind: "deal.compute.missing_prereq",
        meta: {
          error_code: "NCADS_NO_INCOME_BASE",
          severity: "warning",
          detail: `Complete fiscal year ${period} has no usable income base (OBI/TAXABLE/NET); waterfall NCADS skipped.`,
        },
      }).catch(() => {});
      return { ok: false, reason: "no_ncads" };
    }

    const waterfall = computeCashFlowWaterfall(built.input);

    if (waterfall.cfNcads === null || !Number.isFinite(waterfall.cfNcads)) {
      void writeEvent({
        dealId,
        kind: "deal.compute.missing_prereq",
        meta: {
          error_code: "NCADS_WATERFALL_NULL",
          severity: "warning",
          detail: `Waterfall produced null NCADS for ${period}; base=${built.provenance.base_value}.`,
        },
      }).catch(() => {});
      return { ok: false, reason: "no_ncads" };
    }

    const ncads = Math.round(Number(waterfall.cfNcads) * 100) / 100;
    const asOf = new Date().toISOString().slice(0, 10);
    const provenance = {
      source_type: "STRUCTURAL" as const,
      source_ref: `waterfall:${dealId}:${period}`,
      as_of_date: asOf,
      extractor: "computeCashFlowWaterfallFacts:v1",
      calc: waterfall.steps
        .map((s) => `${s.label}=${s.value === null ? "—" : s.value}`)
        .join(" | "),
      // Full institutional traceability (SPEC-CANONICAL-NCADS-WATERFALL-WIRING-1):
      ncads_waterfall: {
        selected_period: period,
        entity_form: built.form,
        ...built.provenance,
        ebitda_reported: waterfall.cfEbitdaReported,
        ebitda_owner_adjusted: waterfall.cfEbitdaOwnerAdjusted,
        ncads: ncads,
        reconciliation: {
          confidence_tier: reconciliation.confidenceTier,
          rejected_count: reconciliation.rejected.length,
          caveats: reconciliation.caveats,
          by_class: reconciliation.summary.byClass,
        },
      },
    };

    // 4. Persist CF_NCADS + the canonical CASH_FLOW_AVAILABLE (idempotent sentinel period,
    // high confidence so the institutional value wins over crude fallbacks).
    let wrote = 0;
    for (const factKey of ["CF_NCADS", "CASH_FLOW_AVAILABLE"]) {
      const res = await upsertDealFinancialFact({
        dealId,
        bankId,
        sourceDocumentId: SENTINEL_UUID,
        factType: "FINANCIAL_ANALYSIS",
        factKey,
        factValueNum: ncads,
        confidence: 0.97,
        provenance,
        ownerType: "DEAL",
        ownerEntityId: SENTINEL_UUID,
        factPeriodStart: SENTINEL_DATE,
        factPeriodEnd: SENTINEL_DATE,
      });
      if (res.ok) wrote += 1;
    }

    return { ok: true, period, ncads, wrote };
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: "query_failed", detail };
  }
}
