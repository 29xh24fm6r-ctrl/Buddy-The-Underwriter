import "server-only";

/**
 * SPEC-FINANCIAL-READINESS-GCF-PREREQ-REPAIR-1
 *
 * Deterministic financial-readiness prerequisite repair layer. Before Global
 * Cash Flow, the financial snapshot, memo readiness, or lifecycle surface a
 * missing-GCF / missing-financial-snapshot blocker, the system must FIRST
 * perform cheap deterministic prerequisite repair for facts that are already
 * derivable from accepted upstream data.
 *
 * This helper is intentionally CHEAP and DETERMINISTIC:
 *   - no OCR, no LLM, no extraction jobs, no spreads rendering, no research
 *   - no manual assumptions, no invented values
 *   - no schema changes, no broad lifecycle mutation
 *
 * It repairs only:
 *   1. ANNUAL_DEBT_SERVICE — via computeTotalDebtService, from latest structural
 *      pricing (materializing the structural row from pricing inputs first if the
 *      structural ADS is entirely absent).
 *   2. PFS_ANNUAL_DEBT_SERVICE — derived from accepted PFS monthly-payment facts.
 *   3. PFS_LIVING_EXPENSES — derived ONLY when a source-backed living-expense
 *      fact already exists under a recognized alternate key; otherwise left as a
 *      precise blocker (fail-closed).
 *
 * Idempotent: a second run finds nothing to repair and writes nothing, so it is
 * safe to call on reconciliation/readiness paths without recursion.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";
import { computeTotalDebtService } from "@/lib/structuralPricing/computeTotalDebtService";
import {
  planAnnualDebtServiceRepair,
  derivePfsAnnualDebtServiceByOwner,
  derivePfsLivingExpensesByOwner,
  hasActiveFact,
  ANNUAL_DEBT_SERVICE_KEY,
  PFS_ANNUAL_DEBT_SERVICE_KEY,
  PFS_LIVING_EXPENSES_KEY,
  type PrereqFactRow,
} from "./financialReadinessPrereqCore";

export type EnsureFinancialReadinessPrerequisitesArgs = {
  dealId: string;
  bankId: string;
  reason: string;
  /**
   * When true (action/retry paths), schedule a readiness refresh after any write.
   * Callers that recompute readiness inline (e.g. buildMemoInputPackage) should
   * leave this false to avoid redundant work; idempotency already prevents loops.
   */
  scheduleRefresh?: boolean;
};

export type EnsureFinancialReadinessPrerequisitesResult = {
  ok: boolean;
  repaired: {
    annualDebtService: boolean;
    pfsAnnualDebtService: boolean;
    pfsLivingExpenses: boolean;
  };
  factsWritten: string[];
  remainingMissing: string[];
  diagnostics: string[];
};

const FACT_SELECT =
  "fact_key, fact_value_num, fact_type, owner_type, owner_entity_id, source_document_id, fact_period_start, fact_period_end, confidence, is_superseded";

async function loadActiveFacts(dealId: string, bankId: string): Promise<PrereqFactRow[]> {
  const sb = supabaseAdmin();
  const { data } = await (sb as any)
    .from("deal_financial_facts")
    .select(FACT_SELECT)
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("is_superseded", false);
  return (data ?? []) as PrereqFactRow[];
}

async function loadLatestStructuralAds(dealId: string): Promise<number | null> {
  const sb = supabaseAdmin();
  const { data } = await (sb as any)
    .from("deal_structural_pricing")
    .select("annual_debt_service_est")
    .eq("deal_id", dealId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.annual_debt_service_est ?? null;
}

/**
 * If there is no structural ADS at all but banker-entered pricing inputs exist,
 * materialize the latest structural pricing row from those inputs first. This is
 * pure deterministic math (computeStructuralPricingFromInputs) — no assumptions.
 */
async function ensureStructuralPricingFromInputs(dealId: string, bankId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data: inputs } = await (sb as any)
    .from("deal_pricing_inputs")
    .select("*")
    .eq("deal_id", dealId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!inputs || inputs.loan_amount == null || Number(inputs.loan_amount) <= 0) return false;

  try {
    const { computeStructuralPricingFromInputs } = await import(
      "@/lib/structuralPricing/computeStructuralPricingFromInputs"
    );
    const res = await computeStructuralPricingFromInputs({ dealId, bankId, inputs });
    return res.ok && res.data?.annual_debt_service_est != null;
  } catch {
    return false;
  }
}

export async function ensureFinancialReadinessPrerequisites(
  args: EnsureFinancialReadinessPrerequisitesArgs,
): Promise<EnsureFinancialReadinessPrerequisitesResult> {
  const { dealId, bankId } = args;
  const factsWritten: string[] = [];
  const diagnostics: string[] = [];
  const repaired = {
    annualDebtService: false,
    pfsAnnualDebtService: false,
    pfsLivingExpenses: false,
  };

  try {
    let facts = await loadActiveFacts(dealId, bankId);

    // ── 1+2. ANNUAL_DEBT_SERVICE ──────────────────────────────────────────
    let latestStructuralAds = await loadLatestStructuralAds(dealId);
    let plan = planAnnualDebtServiceRepair({ facts, latestStructuralAds });

    // If ADS is missing because there's no structural pricing yet, try to flow
    // banker pricing inputs into a structural row first, then re-plan.
    if (plan.reason === "no_structural_pricing") {
      const materialized = await ensureStructuralPricingFromInputs(dealId, bankId);
      if (materialized) {
        latestStructuralAds = await loadLatestStructuralAds(dealId);
        plan = planAnnualDebtServiceRepair({ facts, latestStructuralAds });
      }
    }

    if (plan.shouldRecompute) {
      const res = await computeTotalDebtService({ dealId, bankId });
      if (res.ok && res.data.total != null) {
        repaired.annualDebtService = true;
        factsWritten.push(ANNUAL_DEBT_SERVICE_KEY);
        facts = await loadActiveFacts(dealId, bankId); // refresh for downstream checks
      } else {
        diagnostics.push(
          `ANNUAL_DEBT_SERVICE not computable (${res.ok ? "no structural pricing data" : res.error}); route to pricing / loan terms.`,
        );
      }
    } else if (plan.reason === "no_structural_pricing") {
      diagnostics.push(
        "ANNUAL_DEBT_SERVICE missing and no structural pricing / pricing inputs on file; route to pricing / loan terms.",
      );
    }

    // ── 3+4. PFS_ANNUAL_DEBT_SERVICE ──────────────────────────────────────
    if (!hasActiveFact(facts, PFS_ANNUAL_DEBT_SERVICE_KEY, { ownerType: "PERSONAL" })) {
      const derive = derivePfsAnnualDebtServiceByOwner(facts);
      let wroteAny = false;
      for (const d of derive.derivations) {
        const isDocBacked = !!d.sourceDocumentId;
        const ok = await upsertDealFinancialFact({
          dealId,
          bankId,
          sourceDocumentId: d.sourceDocumentId,
          factType: "PERSONAL_FINANCIAL_STATEMENT",
          factKey: PFS_ANNUAL_DEBT_SERVICE_KEY,
          factValueNum: d.value,
          confidence: d.confidence,
          factPeriodStart: d.periodStart,
          factPeriodEnd: d.periodEnd,
          provenance: {
            source_type: isDocBacked ? "DOC_EXTRACT" : "STRUCTURAL",
            source_ref: isDocBacked
              ? `deal_documents:${d.sourceDocumentId}`
              : `financialReadinessPrereqRepair:pfs_annual_debt_service:${dealId}`,
            as_of_date: d.periodEnd,
            extractor: "financialReadinessPrereqRepair:pfs_annual_debt_service",
            calc: d.calc,
            confidence: d.confidence,
          },
          ownerType: "PERSONAL",
          ownerEntityId: d.ownerEntityId,
        });
        if (ok.ok) wroteAny = true;
      }
      if (wroteAny) {
        repaired.pfsAnnualDebtService = true;
        factsWritten.push(PFS_ANNUAL_DEBT_SERVICE_KEY);
      } else if (derive.diagnostic) {
        diagnostics.push(derive.diagnostic);
      }
    }

    // ── 5. PFS_LIVING_EXPENSES (fail-closed) ──────────────────────────────
    if (!hasActiveFact(facts, PFS_LIVING_EXPENSES_KEY, { ownerType: "PERSONAL" })) {
      const derive = derivePfsLivingExpensesByOwner(facts);
      let wroteAny = false;
      for (const d of derive.derivations) {
        const isDocBacked = !!d.sourceDocumentId;
        const ok = await upsertDealFinancialFact({
          dealId,
          bankId,
          sourceDocumentId: d.sourceDocumentId,
          factType: "PERSONAL_FINANCIAL_STATEMENT",
          factKey: PFS_LIVING_EXPENSES_KEY,
          factValueNum: d.value,
          confidence: d.confidence,
          factPeriodStart: d.periodStart,
          factPeriodEnd: d.periodEnd,
          provenance: {
            source_type: isDocBacked ? "DOC_EXTRACT" : "STRUCTURAL",
            source_ref: isDocBacked
              ? `deal_documents:${d.sourceDocumentId}`
              : `financialReadinessPrereqRepair:pfs_living_expenses:${dealId}`,
            as_of_date: d.periodEnd,
            extractor: "financialReadinessPrereqRepair:pfs_living_expenses",
            calc: d.calc,
            confidence: d.confidence,
            // SPEC-FINANCIAL-READINESS-GCF-PREREQ-REPAIR-1: surface the shared-basis
            // overlap when living expenses were derived from a housing PAYMENT that
            // also backs PFS_ANNUAL_DEBT_SERVICE, so the double-count basis is visible.
            audit_note: d.auditNote ?? undefined,
          },
          ownerType: "PERSONAL",
          ownerEntityId: d.ownerEntityId,
        });
        if (ok.ok) {
          wroteAny = true;
          // Echo the double-count audit note into the result diagnostics so it is
          // visible to reviewers/operators, not only buried in fact provenance.
          if (d.auditNote) diagnostics.push(d.auditNote);
        }
      }
      if (wroteAny) {
        repaired.pfsLivingExpenses = true;
        factsWritten.push(PFS_LIVING_EXPENSES_KEY);
      } else if (derive.diagnostic) {
        // Fail-closed: keep the blocker, surface a precise diagnostic.
        diagnostics.push(derive.diagnostic);
      }
    }

    // ── Post-repair: compute the still-missing canonical prerequisite keys ──
    const fresh = factsWritten.length > 0 ? await loadActiveFacts(dealId, bankId) : facts;
    const remainingMissing: string[] = [];
    if (!hasActiveFact(fresh, ANNUAL_DEBT_SERVICE_KEY)) remainingMissing.push(ANNUAL_DEBT_SERVICE_KEY);
    if (!hasActiveFact(fresh, PFS_ANNUAL_DEBT_SERVICE_KEY, { ownerType: "PERSONAL" }))
      remainingMissing.push(PFS_ANNUAL_DEBT_SERVICE_KEY);
    if (!hasActiveFact(fresh, PFS_LIVING_EXPENSES_KEY, { ownerType: "PERSONAL" }))
      remainingMissing.push(PFS_LIVING_EXPENSES_KEY);

    // ── Cache invalidation + optional readiness refresh (only on real writes) ──
    if (factsWritten.length > 0) {
      try {
        const { invalidateLifecycleCache } = await import("@/buddy/lifecycle/lifecycleCache");
        invalidateLifecycleCache(dealId);
      } catch {
        // non-fatal
      }
      if (args.scheduleRefresh) {
        try {
          const { scheduleReadinessRefresh } = await import(
            "@/lib/deals/readiness/refreshDealReadiness"
          );
          // Idempotency guarantees the re-derivation will not re-trigger repair.
          scheduleReadinessRefresh({ dealId, trigger: "financial_facts_written" });
        } catch {
          // non-fatal
        }
      }
    }

    return {
      ok: true,
      repaired,
      factsWritten,
      remainingMissing,
      diagnostics,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      repaired,
      factsWritten,
      remainingMissing: [],
      diagnostics: [...diagnostics, `ensureFinancialReadinessPrerequisites failed: ${msg}`],
    };
  }
}
