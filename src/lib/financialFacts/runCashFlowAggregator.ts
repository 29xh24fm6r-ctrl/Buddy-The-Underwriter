/**
 * Cash Flow Aggregator — standalone module.
 *
 * SPEC-FOUNDATION-V1-PR4-EXTRACT (Workstream B1 of SPEC-BANKER-HOLY-SHIT-V1)
 *
 * This aggregator mirrors the embedded compute pathway from
 *   src/app/api/deals/[dealId]/classic-spread/route.ts
 * as it stood at commit ce262f37. Any logic change here MUST be paired
 * with a change to the route, or the route must be changed to call this
 * module exclusively.
 *
 * What it does:
 *   1. Reads proposed ADS from deal_structural_pricing
 *   2. Reads latest-period NCADS (EBITDA → OBI → NET_INCOME fallback)
 *   3. Computes DSCR = NCADS / proposedAds
 *   4. Upserts ANNUAL_DEBT_SERVICE / DSCR / CASH_FLOW_AVAILABLE /
 *      EXCESS_CASH_FLOW to deal_financial_facts
 *
 * What it does NOT do:
 *   - Snapshot rebuild (stays in the route or caller)
 *   - Stress methodology (Stress A/B/C) — deferred to B4.1
 *   - Per-tenant policy packs — deferred to v1.1 of B4
 *
 * SPEC-B4 (Batch 2): now slate-aware on Axis 1 (NCADS source).
 * Axes 4 + 5 live in persistGlobalCashFlow.ts. Axes 2 + 3 deferred
 * to v1.1 (require wiring upstream EBITDA / officer comp writers).
 *
 * Do not import from this module in test files that need "server-only"
 * avoidance. The module is server-only by nature (Supabase admin writes).
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadDealMethodology } from "@/lib/methodology/loadDealMethodology";
import { computeSlateHash } from "@/lib/methodology/slateHash";
import { METHODOLOGY_AXES } from "@/lib/methodology/methodologyAxes";
import { DEFAULT_METHODOLOGY_SLATE } from "@/lib/methodology/methodologyDefaults";
import { buildRationale } from "@/lib/methodology/rationaleTemplates";
import type { MethodologyProvenance } from "@/lib/methodology/types";

// ── Sentinel constants — match route exactly ───────────────────────────────
const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";
const SENTINEL_DATE = "1900-01-01";
const ON_CONFLICT_COLS =
  "deal_id,bank_id,source_document_id,fact_type,fact_key,fact_period_start,fact_period_end,owner_type,owner_entity_id";

// ── Result type ────────────────────────────────────────────────────────────

export type RunCashFlowAggregatorResult =
  | {
      ok: true;
      dealId: string;
      bankId: string;
      proposedAds: number;
      ncads: number | null;
      ncadsSource: "EBITDA" | "ORDINARY_BUSINESS_INCOME" | "NET_INCOME" | null;
      latestPeriod: string;
      dscr: number | null;
      factsWritten: number;
      factsAttempted: number;
    }
  | {
      ok: false;
      reason:
        | "no_pricing_row"
        | "invalid_proposed_ads"
        | "no_ncads_candidates"
        | "internal_error";
      detail?: string;
    };

// ── Main function ──────────────────────────────────────────────────────────

export async function runCashFlowAggregator(args: {
  dealId: string;
  bankId: string;
}): Promise<RunCashFlowAggregatorResult> {
  const { dealId, bankId } = args;
  const sb = supabaseAdmin();

  // SPEC-B4 — Load methodology slate (banker choices merged over defaults)
  const { slate: methodologySlate, isAllDefaults } =
    await loadDealMethodology(dealId, bankId);
  const slateHash = computeSlateHash(methodologySlate);

  // 1. Read proposedAds from deal_structural_pricing
  const { data: pricingRow } = await (sb as any)
    .from("deal_structural_pricing")
    .select("annual_debt_service_est")
    .eq("deal_id", dealId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const proposedAds = pricingRow?.annual_debt_service_est
    ? Number(pricingRow.annual_debt_service_est)
    : null;

  if (proposedAds === null) {
    return { ok: false, reason: "no_pricing_row" };
  }
  if (!(proposedAds > 0)) {
    return {
      ok: false,
      reason: "invalid_proposed_ads",
      detail: `annual_debt_service_est = ${pricingRow.annual_debt_service_est}`,
    };
  }

  // SPEC-B4.1.2 — try entity-summed EBITDA first (slate-aware, per-entity)
  let entityEbitdaSum: number | null = null;
  {
    const { data: entityEbitdaRows } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_value_num, fact_period_end, owner_entity_id, provenance")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("owner_type", "ENTITY")
      .eq("fact_key", "EBITDA")
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected")
      .not("fact_value_num", "is", null)
      .order("fact_period_end", { ascending: false });

    if (entityEbitdaRows && entityEbitdaRows.length > 0) {
      const latestEntityPeriod = (entityEbitdaRows as any[])[0].fact_period_end;
      const periodRows = (entityEbitdaRows as any[]).filter(
        (r: any) => r.fact_period_end === latestEntityPeriod,
      );
      entityEbitdaSum = periodRows.reduce(
        (sum: number, r: any) => sum + Number(r.fact_value_num),
        0,
      );
    }
  }

  // 2. Read NCADS candidates
  const { data: factRows } = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, fact_period_end")
    .eq("deal_id", dealId)
    .eq("is_superseded", false)
    .neq("resolution_status", "rejected")
    .in("fact_key", ["EBITDA", "ORDINARY_BUSINESS_INCOME", "NET_INCOME"])
    .not("fact_value_num", "is", null)
    .order("fact_period_end", { ascending: false })
    .limit(10);

  if (!factRows || factRows.length === 0) {
    return { ok: false, reason: "no_ncads_candidates" };
  }

  // 3. Apply fallback logic — match route exactly
  const latestPeriod = (factRows as any[])[0].fact_period_end as string;
  const periodFacts = (factRows as any[]).filter(
    (r: any) => r.fact_period_end === latestPeriod,
  );

  // SPEC-B4 — NCADS source decision varies by methodology slate (Axis 1)
  //   "standard"        → EBITDA → OBI → NET_INCOME fallback (matches pre-B4 behavior)
  //   "conservative"    → NET_INCOME only (no operational add-backs)
  //   "tax_return_basis" → OBI only (what the IRS sees)
  const ncadsVariant = methodologySlate.ncads_source;

  let ncads: number | null = null;
  let ncadsSource: "EBITDA" | "ORDINARY_BUSINESS_INCOME" | "NET_INCOME" | null = null;

  if (ncadsVariant === "conservative") {
    const niRow = periodFacts.find((r: any) => r.fact_key === "NET_INCOME");
    ncads = niRow?.fact_value_num ?? null;
    ncadsSource = niRow ? "NET_INCOME" : null;
  } else if (ncadsVariant === "tax_return_basis") {
    const obiRow = periodFacts.find(
      (r: any) => r.fact_key === "ORDINARY_BUSINESS_INCOME",
    );
    ncads = obiRow?.fact_value_num ?? null;
    ncadsSource = obiRow ? "ORDINARY_BUSINESS_INCOME" : null;
  } else {
    // "standard" — prefer entity-summed EBITDA (SPEC-B4.1.2), fall back to
    // deal-scoped EBITDA fact (legacy / RE), then OBI, then NI
    if (entityEbitdaSum !== null) {
      ncads = entityEbitdaSum;
      ncadsSource = "EBITDA";
    } else {
      const ebitdaRow = periodFacts.find((r: any) => r.fact_key === "EBITDA");
      const obiRow = periodFacts.find(
        (r: any) => r.fact_key === "ORDINARY_BUSINESS_INCOME",
      );
      const niRow = periodFacts.find((r: any) => r.fact_key === "NET_INCOME");

      ncads =
        ebitdaRow?.fact_value_num ??
        obiRow?.fact_value_num ??
        niRow?.fact_value_num ??
        null;

      ncadsSource = ebitdaRow
        ? "EBITDA"
        : obiRow
          ? "ORDINARY_BUSINESS_INCOME"
          : niRow
            ? "NET_INCOME"
            : null;
    }
  }

  // 4. Compute DSCR
  const dscrValue =
    ncads !== null && isFinite(Number(ncads))
      ? Math.round((Number(ncads) / proposedAds) * 100) / 100
      : null;

  // 5. Build facts to write
  // SPEC-FOUNDATION-V1 PR5h — use SENTINEL_DATE for fact_period_end instead
  // of today's date. The aggregator's facts are "current best estimate"
  // derived from structural pricing + latest-period NCADS, not period-specific
  // financial data. Using today's date created a new row on every run because
  // fact_period_end is part of the natural-uniqueness constraint. SENTINEL_DATE
  // matches the convention used by computeTotalDebtService, backfill, and
  // persistGlobalCashFlow, making the upsert idempotent across runs.
  const persistDate = new Date().toISOString().slice(0, 10);

  const factsToWrite = [
    { key: "ANNUAL_DEBT_SERVICE", value: proposedAds },
    { key: "DSCR", value: dscrValue },
    ...(ncads !== null && Number(ncads) > 0
      ? [
          { key: "CASH_FLOW_AVAILABLE", value: Number(ncads) },
          { key: "EXCESS_CASH_FLOW", value: Number(ncads) - proposedAds },
        ]
      : []),
  ].filter(
    (f): f is { key: string; value: number } =>
      f.value !== null && Number.isFinite(f.value),
  );

  // SPEC-B4 — Build methodology provenance for Axis 1 (NCADS source)
  const ncadsAxis = METHODOLOGY_AXES.ncads_source;
  const methodologyProvenance: MethodologyProvenance[] = [
    {
      axis: "ncads_source",
      chosen_variant: ncadsVariant,
      alternatives_considered: ncadsAxis.variants
        .map((v) => v.id)
        .filter((id) => id !== ncadsVariant),
      rationale: buildRationale("ncads_source", ncadsVariant),
      slate_hash: slateHash,
      is_default:
        ncadsVariant === DEFAULT_METHODOLOGY_SLATE.ncads_source && isAllDefaults,
    },
  ];

  // SPEC-B4.1.2 — when NCADS came from entity-summed EBITDA, attach Axis 2 provenance
  if (entityEbitdaSum !== null && ncadsSource === "EBITDA") {
    const ebitdaAxis = METHODOLOGY_AXES.ebitda_addback_stack;
    const ebitdaVariant = methodologySlate.ebitda_addback_stack;
    methodologyProvenance.push({
      axis: "ebitda_addback_stack",
      chosen_variant: ebitdaVariant,
      alternatives_considered: ebitdaAxis.variants
        .map((v) => v.id)
        .filter((id) => id !== ebitdaVariant),
      rationale: buildRationale("ebitda_addback_stack", ebitdaVariant),
      slate_hash: slateHash,
      is_default:
        ebitdaVariant === DEFAULT_METHODOLOGY_SLATE.ebitda_addback_stack &&
        isAllDefaults,
    });
  }

  // 6. Execute upserts
  let factsWritten = 0;
  for (const f of factsToWrite) {
    const { error: upsertErr } = await (sb as any)
      .from("deal_financial_facts")
      .upsert(
        {
          deal_id: dealId,
          bank_id: bankId,
          source_document_id: SENTINEL_UUID,
          fact_type: "FINANCIAL_ANALYSIS",
          fact_key: f.key,
          fact_period_start: SENTINEL_DATE,
          fact_period_end: SENTINEL_DATE,
          fact_value_num: f.value,
          fact_value_text: null,
          currency: "USD",
          confidence: 0.95,
          provenance: {
            source_type: "STRUCTURAL",
            source_ref: "computed:classic_spread:v2",
            as_of_date: persistDate,
            extractor: "runCashFlowAggregator:v2",
            methodology: methodologyProvenance,
          },
          owner_type: "DEAL",
          owner_entity_id: SENTINEL_UUID,
          is_superseded: false,
        },
        {
          onConflict: ON_CONFLICT_COLS,
        } as any,
      );

    if (upsertErr) {
      console.warn(
        `[runCashFlowAggregator] upsert failed for ${f.key}:`,
        upsertErr.message,
      );
    } else {
      factsWritten++;
    }
  }

  return {
    ok: true,
    dealId,
    bankId,
    proposedAds,
    ncads: ncads !== null ? Number(ncads) : null,
    ncadsSource,
    latestPeriod,
    dscr: dscrValue,
    factsWritten,
    factsAttempted: factsToWrite.length,
  };
}
