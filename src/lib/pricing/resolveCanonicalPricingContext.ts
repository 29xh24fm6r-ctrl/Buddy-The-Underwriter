import "server-only";

/**
 * SPEC-PRICING-CANONICAL-SOURCE-OF-TRUTH-1
 *
 * Single resolver that every pricing surface and scenario generator uses.
 *
 * Precedence:
 *   1. valid explicit deal_pricing_inputs (if complete and not contradictory)
 *   2. latest deal_structural_pricing
 *   3. primary submitted deal_loan_requests
 *   4. safe defaults
 *
 * If deal_pricing_inputs is stale/invalid, the resolver repairs AND persists
 * the corrected values so all downstream readers see consistent data.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type IndexCode = "SOFR" | "UST_5Y" | "PRIME";

export type IndexRateSource = "live" | "manual_override" | "structural_placeholder" | "none";

export type CanonicalPricingContext = {
  product_type: string | null;
  loan_amount: number | null;
  rate_type: "floating" | "fixed";
  index_code: IndexCode;
  index_rate_pct: number | null;
  index_rate_source: IndexRateSource;
  spread_bps: number | null;
  all_in_rate_pct: number | null;
  fixed_rate_pct: number | null;
  term_months: number;
  amort_months: number;
  interest_only_months: number;
  annual_debt_service_est: number | null;
  source_priority: string;
  repair_applied: boolean;
  repair_reason: string | null;
};

const VALID_INDEX = new Set<string>(["SOFR", "UST_5Y", "PRIME"]);

function isValidIndex(v: unknown): v is IndexCode {
  return typeof v === "string" && VALID_INDEX.has(v);
}

function toFinite(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function resolveCanonicalPricingContext(
  dealId: string,
  bankId: string,
): Promise<CanonicalPricingContext> {
  const sb = supabaseAdmin();

  // Parallel load all three sources
  const [{ data: dpi }, { data: sp }, { data: lr }] = await Promise.all([
    sb.from("deal_pricing_inputs").select("*").eq("deal_id", dealId).maybeSingle(),
    sb.from("deal_structural_pricing")
      .select("*")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from("deal_loan_requests")
      .select("*")
      .eq("deal_id", dealId)
      .order("request_number", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const d = (dpi ?? {}) as Record<string, any>;
  const s = (sp ?? {}) as Record<string, any>;
  const l = (lr ?? {}) as Record<string, any>;

  // ── Detect invalid deal_pricing_inputs ────────────────────────────
  const dpiExists = dpi != null;
  const isFixedNoRate = d.rate_type === "fixed" && d.fixed_rate_pct == null;
  const isFloatingNoIdx = d.rate_type === "floating" && d.index_rate_pct == null;
  const dpiIsInvalid = dpiExists && (isFixedNoRate || isFloatingNoIdx);

  // Also detect if deal_pricing_inputs index_code contradicts structural pricing
  const spIndex = isValidIndex(s.rate_index) ? (s.rate_index as IndexCode) : null;
  const lrIndex = isValidIndex(l.requested_rate_index) ? (l.requested_rate_index as IndexCode) : null;
  const dpiIndex = isValidIndex(d.index_code) ? (d.index_code as IndexCode) : null;
  const indexConflict = dpiExists && !!spIndex && !!dpiIndex && dpiIndex !== spIndex;

  // ── Product type ──────────────────────────────────────────────────
  const product_type: string | null = l.product_type ?? null;

  // ── Rate type ─────────────────────────────────────────────────────
  // structural pricing is authoritative (it reflects the actual computed pricing)
  const spRateType = s.rate_type === "variable" ? "floating" : s.rate_type === "fixed" ? "fixed" : null;
  const lrRateType = l.requested_rate_type === "VARIABLE" ? "floating"
    : l.requested_rate_type === "FIXED" ? "fixed" : null;
  const dpiRateType = (d.rate_type === "floating" || d.rate_type === "fixed") ? d.rate_type : null;

  let rate_type: "floating" | "fixed";
  let source_priority: string;

  if (dpiExists && !dpiIsInvalid && !indexConflict && dpiRateType) {
    rate_type = dpiRateType;
    source_priority = "deal_pricing_inputs";
  } else if (spRateType) {
    rate_type = spRateType;
    source_priority = "deal_structural_pricing";
  } else if (lrRateType) {
    rate_type = lrRateType;
    source_priority = "deal_loan_requests";
  } else {
    rate_type = "floating";
    source_priority = "defaults";
  }

  // ── Index code ────────────────────────────────────────────────────
  let index_code: IndexCode;
  if (source_priority === "deal_pricing_inputs" && dpiIndex) {
    index_code = dpiIndex;
  } else {
    index_code = spIndex ?? lrIndex ?? "SOFR";
  }

  // ── Index rate ────────────────────────────────────────────────────
  // For floating loans, the index rate is the current market rate by definition.
  // structural_pricing.index_rate_pct is a point-in-time computation input, NOT
  // the current index — do not treat it as canonical unless the banker explicitly
  // locked it via base_rate_override_pct.
  //
  // Resolution:
  //   1. base_rate_override_pct set → explicit banker lock ("manual_override")
  //   2. floating with no lock → null, meaning "use live rate" ("live")
  //   3. fixed → use deal_pricing_inputs or structural rate
  let index_rate_pct: number | null;
  let index_rate_source: IndexRateSource;

  const hasManualOverride = toFinite(d.base_rate_override_pct) != null;

  if (rate_type === "fixed") {
    // Fixed loans don't use index rates for pricing
    index_rate_pct = toFinite(d.index_rate_pct) ?? toFinite(s.index_rate_pct);
    index_rate_source = index_rate_pct != null ? "structural_placeholder" : "none";
  } else if (hasManualOverride) {
    // Banker explicitly locked a rate override
    index_rate_pct = toFinite(d.base_rate_override_pct);
    index_rate_source = "manual_override";
  } else {
    // Floating with no lock → leave null so card/scenarios use live rates
    index_rate_pct = null;
    index_rate_source = "live";
  }

  // ── Fixed rate ────────────────────────────────────────────────────
  const fixed_rate_pct = rate_type === "fixed" ? (toFinite(d.fixed_rate_pct) ?? toFinite(s.structural_rate_pct)) : null;

  // ── Spread ────────────────────────────────────────────────────────
  let spread_bps: number | null;
  if (source_priority === "deal_pricing_inputs" && d.spread_override_bps != null) {
    spread_bps = toFinite(d.spread_override_bps);
  } else {
    spread_bps = toFinite(s.requested_spread_bps) ?? toFinite(l.requested_spread_bps);
  }

  // ── Loan amount ───────────────────────────────────────────────────
  const loan_amount = toFinite(d.loan_amount) ?? toFinite(s.loan_amount) ?? toFinite(l.requested_amount);

  // ── Term / amort / IO ─────────────────────────────────────────────
  const term_months = toFinite(s.term_months) ?? toFinite(d.term_months) ?? toFinite(l.requested_term_months) ?? 120;
  // DB CHECK: amort_months > 0. For LOC (interest-only), structural pricing
  // may have amort_months=0; clamp to 1 so DB constraint is satisfied.
  const rawAmort = toFinite(s.amort_months) ?? toFinite(d.amort_months) ?? toFinite(l.requested_amort_months) ?? 300;
  const amort_months = Math.max(rawAmort, 1);
  // DB CHECK: interest_only_months <= amort_months. Clamp if needed.
  const rawIo = toFinite(s.interest_only_months) ?? toFinite(d.interest_only_months) ?? toFinite(l.requested_interest_only_months) ?? 0;
  const interest_only_months = Math.min(rawIo, amort_months);

  // ── All-in rate ───────────────────────────────────────────────────
  let all_in_rate_pct: number | null = null;
  if (rate_type === "fixed" && fixed_rate_pct != null) {
    all_in_rate_pct = fixed_rate_pct;
  } else if (index_rate_pct != null) {
    all_in_rate_pct = index_rate_pct + (spread_bps ?? 0) / 100;
  }

  // ── ADS ───────────────────────────────────────────────────────────
  const annual_debt_service_est = toFinite(s.annual_debt_service_est);

  // ── Repair / create detection ──────────────────────────────────────
  const needsRepair = dpiExists && (dpiIsInvalid || indexConflict);
  const needsCreate = !dpiExists && (sp != null || lr != null);
  let repair_reason: string | null = null;

  if (needsRepair) {
    if (isFixedNoRate) repair_reason = "rate_type=fixed with null fixed_rate_pct";
    else if (isFloatingNoIdx) repair_reason = "rate_type=floating with null index_rate_pct";
    else if (indexConflict) repair_reason = `index_code ${dpiIndex} conflicts with structural pricing ${spIndex}`;
  } else if (needsCreate) {
    repair_reason = "deal_pricing_inputs missing; created from structural pricing / loan request";
  }

  // ── Persist: upsert deal_pricing_inputs (create if missing, repair if stale) ──
  if (needsRepair || needsCreate) {
    const canonicalRow: Record<string, any> = {
      deal_id: dealId,
      rate_type,
      index_code,
      // For floating loans with no manual override, persist null so the card
      // auto-populates from live rates instead of showing a stale structural value.
      index_rate_pct: index_rate_source === "live" ? null : index_rate_pct,
      spread_override_bps: spread_bps,
      loan_amount,
      term_months,
      amort_months,
      interest_only_months,
      fixed_rate_pct: rate_type === "fixed" ? fixed_rate_pct : null,
      include_existing_debt: dpiExists ? (d.include_existing_debt ?? true) : true,
      include_proposed_debt: dpiExists ? (d.include_proposed_debt ?? true) : true,
      notes: dpiExists ? (d.notes ?? null) : null,
    };

    try {
      const { error: upsertErr } = await sb
        .from("deal_pricing_inputs")
        .upsert(canonicalRow, { onConflict: "deal_id" });

      if (upsertErr) {
        console.error("[resolveCanonicalPricingContext] canonical upsert FAILED", {
          dealId,
          error: upsertErr.message,
          code: upsertErr.code,
          canonicalRow,
        });
      }
    } catch (err: any) {
      console.error("[resolveCanonicalPricingContext] canonical upsert threw", {
        dealId,
        error: err?.message,
      });
    }
  }

  return {
    product_type,
    loan_amount,
    rate_type,
    index_code,
    index_rate_pct,
    index_rate_source,
    spread_bps,
    all_in_rate_pct,
    fixed_rate_pct,
    term_months,
    amort_months,
    interest_only_months,
    annual_debt_service_est,
    source_priority,
    repair_applied: needsRepair || needsCreate,
    repair_reason,
  };
}
