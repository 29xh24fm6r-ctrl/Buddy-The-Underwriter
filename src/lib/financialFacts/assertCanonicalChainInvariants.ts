/**
 * SPEC-FOUNDATION-V1-PR5I — Canonical Chain Invariant Assertion
 *
 * Checks the seven postcondition invariants from the PIV table after the
 * canonical chain completes. Returns violations without throwing.
 * Observed, NOT enforced in v1.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ChainInvariantViolation {
  invariantId: string;
  errorCode: string;
  precondition: string;
  expectedPostcondition: string;
  actualState: Record<string, unknown>;
}

export async function assertCanonicalChainInvariants(args: {
  dealId: string;
  bankId: string;
}): Promise<{ ok: true } | { ok: false; violations: ChainInvariantViolation[] }> {
  const { dealId, bankId } = args;
  const sb = supabaseAdmin();
  const violations: ChainInvariantViolation[] = [];

  // Helper: check if a fact_key exists with non-null value
  async function factExists(factKey: string): Promise<boolean> {
    const { data } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_value_num")
      .eq("deal_id", dealId)
      .eq("is_superseded", false)
      .eq("fact_key", factKey)
      .not("fact_value_num", "is", null)
      .limit(1)
      .maybeSingle();
    return data !== null;
  }

  async function factValue(factKey: string): Promise<number | null> {
    const { data } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_value_num")
      .eq("deal_id", dealId)
      .eq("is_superseded", false)
      .eq("fact_key", factKey)
      .not("fact_value_num", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.fact_value_num != null ? Number(data.fact_value_num) : null;
  }

  // ── Invariant 1: NCADS → CASH_FLOW_AVAILABLE ──────────────────────────
  const hasEbitda = await factExists("EBITDA");
  const hasObi = await factExists("ORDINARY_BUSINESS_INCOME");
  const hasNi = await factExists("NET_INCOME");
  const hasNcads = hasEbitda || hasObi || hasNi;
  const hasCfa = await factExists("CASH_FLOW_AVAILABLE");

  if (hasNcads && !hasCfa) {
    violations.push({
      invariantId: "INV-1",
      errorCode: "INVARIANT_BOOTSTRAP_MISSED",
      precondition: "At least one of EBITDA/OBI/NET_INCOME exists with non-null value",
      expectedPostcondition: "CASH_FLOW_AVAILABLE exists with non-null value",
      actualState: { hasEbitda, hasObi, hasNi, hasCfa },
    });
  }

  // ── Invariant 2: Structural pricing → ANNUAL_DEBT_SERVICE ─────────────
  const { data: pricingRow } = await (sb as any)
    .from("deal_structural_pricing")
    .select("annual_debt_service_est")
    .eq("deal_id", dealId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const hasPositiveAdsEst =
    pricingRow?.annual_debt_service_est != null &&
    Number(pricingRow.annual_debt_service_est) > 0;
  const hasAds = await factExists("ANNUAL_DEBT_SERVICE");

  if (hasPositiveAdsEst && !hasAds) {
    violations.push({
      invariantId: "INV-2",
      errorCode: "INVARIANT_ADS_MISSING",
      precondition: "deal_structural_pricing.annual_debt_service_est > 0",
      expectedPostcondition: "ANNUAL_DEBT_SERVICE exists with non-null value > 0",
      actualState: { adsEst: pricingRow?.annual_debt_service_est, hasAds },
    });
  }

  // ── Invariant 3: CFA + ADS → DSCR ────────────────────────────────────
  const adsValue = await factValue("ANNUAL_DEBT_SERVICE");
  const hasDscr = await factExists("DSCR");

  if (hasCfa && hasAds && adsValue != null && adsValue > 0 && !hasDscr) {
    violations.push({
      invariantId: "INV-3",
      errorCode: "INVARIANT_DSCR_MISSING",
      precondition: "CASH_FLOW_AVAILABLE exists AND ANNUAL_DEBT_SERVICE exists AND > 0",
      expectedPostcondition: "DSCR exists with non-null value",
      actualState: { hasCfa, hasAds, adsValue, hasDscr },
    });
  }

  // ── Invariant 4: CFA + ADS → EXCESS_CASH_FLOW ────────────────────────
  const hasEcf = await factExists("EXCESS_CASH_FLOW");

  if (hasCfa && hasAds && !hasEcf) {
    violations.push({
      invariantId: "INV-4",
      errorCode: "INVARIANT_ECF_MISSING",
      precondition: "CASH_FLOW_AVAILABLE exists AND ANNUAL_DEBT_SERVICE exists",
      expectedPostcondition: "EXCESS_CASH_FLOW exists with non-null value",
      actualState: { hasCfa, hasAds, hasEcf },
    });
  }

  // ── Invariant 5: GCF spread ready → GCF facts ────────────────────────
  const { data: gcfSpread } = await (sb as any)
    .from("deal_spreads")
    .select("status")
    .eq("deal_id", dealId)
    .eq("spread_type", "GLOBAL_CASH_FLOW")
    .eq("status", "ready")
    .limit(1)
    .maybeSingle();

  if (gcfSpread) {
    const hasGcfGlobal = await factExists("GCF_GLOBAL_CASH_FLOW");
    const hasGcfDscr = await factExists("GCF_DSCR");
    const hasGcfCashAvail = await factExists("GCF_CASH_AVAILABLE");

    if (!hasGcfGlobal || !hasGcfDscr || !hasGcfCashAvail) {
      violations.push({
        invariantId: "INV-5",
        errorCode: "INVARIANT_GCF_FACTS_MISSING",
        precondition: "GCF spread rendered successfully (status='ready')",
        expectedPostcondition: "GCF_GLOBAL_CASH_FLOW, GCF_DSCR, GCF_CASH_AVAILABLE facts exist",
        actualState: { hasGcfGlobal, hasGcfDscr, hasGcfCashAvail },
      });
    }
  }

  // ── Invariant 6: Entity + personal income → GLOBAL_CASH_FLOW ─────────
  // Soft check: only if entities exist
  const { count: entityCount } = await (sb as any)
    .from("deal_entities")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);

  const hasPersonalIncome = await factExists("PERSONAL_TOTAL_INCOME");
  const hasGlobalCf = await factExists("GLOBAL_CASH_FLOW");

  if ((entityCount ?? 0) > 0 && hasPersonalIncome && !hasGlobalCf) {
    violations.push({
      invariantId: "INV-6",
      errorCode: "INVARIANT_GLOBAL_CF_MISSING",
      precondition: "At least one entity exists AND personal income facts exist",
      expectedPostcondition: "GLOBAL_CASH_FLOW fact exists with non-null value",
      actualState: { entityCount, hasPersonalIncome, hasGlobalCf },
    });
  }

  // ── Invariant 7: All canonical writes carry provenance.extractor ──────
  const { data: noExtractorRows } = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_key, provenance")
    .eq("deal_id", dealId)
    .eq("is_superseded", false)
    .eq("fact_type", "FINANCIAL_ANALYSIS")
    .not("fact_value_num", "is", null)
    .limit(50);

  const missingExtractor = ((noExtractorRows ?? []) as any[]).filter(
    (r) => !r.provenance?.extractor,
  );

  if (missingExtractor.length > 0) {
    violations.push({
      invariantId: "INV-7",
      errorCode: "INVARIANT_PROVENANCE_GAP",
      precondition: "Any canonical writer writes a fact",
      expectedPostcondition: "provenance.extractor is populated",
      actualState: {
        missingCount: missingExtractor.length,
        missingKeys: missingExtractor.map((r) => r.fact_key),
      },
    });
  }

  if (violations.length === 0) {
    return { ok: true };
  }

  return { ok: false, violations };
}
