import "server-only";

// src/lib/feasibility/franchiseComparator.ts
// Phase God Tier Feasibility — Franchise Comparator (step 8/16).
//
// Compares a proposed franchise brand against alternatives using the
// franchise intelligence DB (franchise_brands + fdd_item19_facts).
//
// IMPORTANT DATA LIMITATION (verified 2026-07-12): franchise_brands.naics_codes
// and .industry_category are both entirely unpopulated (0 of 8,433 canonical
// rows). True same-industry matching is therefore not possible yet — the
// naicsCode param is accepted but currently unused. Alternatives are matched
// on comparable initial investment range and SBA eligibility instead, which
// is an economics proxy, not an industry match. Revisit once brand-level
// NAICS/category data is backfilled.
//
// Still gracefully degrades to null if the franchise_brands table isn't
// present (e.g. in environments without the franchise intelligence DB).

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  scoreBrandMaturity,
  scoreFddItem19Percentile,
  scoreFranchiseSbaCertification,
  scoreFranchisorSupportBinary,
} from "@/lib/score/scoringCurves";
import type { ComparativeAnalysisResult, FranchiseComparison } from "./types";

const CANDIDATE_POOL_SIZE = 25;
const MAX_ALTERNATIVES = 3;

const BRAND_COLUMNS =
  "id, brand_name, sba_certification_status, sba_eligible, initial_investment_min, initial_investment_max, royalty_pct, unit_count, has_item_19";

type BrandRow = {
  id: string;
  brand_name: string;
  sba_certification_status: string | null;
  sba_eligible: boolean;
  initial_investment_min: number | null;
  initial_investment_max: number | null;
  royalty_pct: number | null;
  unit_count: number | null;
  has_item_19: boolean;
};

type Item19Fact = {
  brand_id: string;
  value: number;
  percentile_rank: number | null;
  filing_year: number;
};

/**
 * Compare the proposed franchise concept against alternatives that fit the
 * same borrower profile. Uses the franchise intelligence DB (franchise_brands
 * + fdd_item19_facts). Returns null if the DB isn't operational, or if no
 * proposed brand can be resolved from the given id/name — this is the
 * documented graceful-degradation path the orchestrator relies on.
 */
export async function runFranchiseComparison(params: {
  proposedBrandId: string | null;
  proposedBrandName: string | null;
  naicsCode: string | null;
  borrowerEquity: number;
  borrowerExperienceYears: number;
  tradeAreaPopulation: number | null;
  tradeAreaMedianIncome: number | null;
}): Promise<ComparativeAnalysisResult | null> {
  // Not yet usable — see file-header note on naics_codes/industry_category.
  void params.naicsCode;
  // Not yet used in the matching query (no trade-area join on franchise_brands).
  void params.tradeAreaPopulation;
  void params.tradeAreaMedianIncome;
  void params.borrowerExperienceYears;

  const sb = supabaseAdmin();

  // Detect whether the franchise intelligence tables exist yet. We ask the
  // catalog directly via a best-effort query and gracefully return null on
  // any error (missing table, RLS, schema mismatch).
  try {
    const { data, error } = await sb
      .rpc("buddy_table_exists" as never, {
        p_table_name: "franchise_brands",
      } as never)
      .maybeSingle();
    if (error) return null;
    const exists = (data as { exists?: boolean } | null)?.exists ?? false;
    if (!exists) return null;
  } catch {
    return null;
  }

  // ── Resolve the proposed brand ──────────────────────────────────────
  const proposedRow = await resolveProposedBrand(
    sb,
    params.proposedBrandId,
    params.proposedBrandName,
  );

  // No resolvable brand — nothing to compare against. As of 2026-07-12 this
  // is the live production path: the feasibility orchestrator always calls
  // this with proposedBrandId/proposedBrandName as null (see
  // feasibilityEngine.ts, "Franchise comparison (always null in v1)").
  // Wiring the orchestrator to pass the deal's actual selected brand is a
  // separate follow-up — this function is otherwise fully functional once
  // it receives a real brand.
  if (!proposedRow) return null;

  // ── Candidate pool — matched on investment range + SBA eligibility ──
  const proposedMid =
    proposedRow.initial_investment_min != null &&
    proposedRow.initial_investment_max != null
      ? (proposedRow.initial_investment_min +
          proposedRow.initial_investment_max) /
        2
      : params.borrowerEquity > 0
        ? params.borrowerEquity * 5 // 80% max LTV proxy, per original design note
        : null;

  const candidateQuery =
    proposedMid != null
      ? sb
          .from("franchise_brands")
          .select(BRAND_COLUMNS)
          .eq("canonical", true)
          .eq("sba_eligible", true)
          .neq("id", proposedRow.id)
          .gte("initial_investment_min", proposedMid * 0.6)
          .lte("initial_investment_max", proposedMid * 1.4)
          .limit(CANDIDATE_POOL_SIZE)
      : sb
          .from("franchise_brands")
          .select(BRAND_COLUMNS)
          .eq("canonical", true)
          .eq("sba_eligible", true)
          .neq("id", proposedRow.id)
          .limit(CANDIDATE_POOL_SIZE);

  const { data: candidateRows } = await candidateQuery;
  const candidates = (candidateRows as BrandRow[] | null) ?? [];

  // ── Latest AVERAGE_GROSS_REVENUE + percentile per brand in the set ──
  const brandIds = [proposedRow.id, ...candidates.map((c) => c.id)];
  const { data: itemFacts } = await sb
    .from("fdd_item19_facts")
    .select("brand_id, value, percentile_rank, filing_year")
    .in("brand_id", brandIds)
    .eq("metric_name", "AVERAGE_GROSS_REVENUE")
    .order("filing_year", { ascending: false });

  const latestByBrand = new Map<
    string,
    { value: number; percentileRank: number | null }
  >();
  for (const row of (itemFacts as Item19Fact[] | null) ?? []) {
    if (!latestByBrand.has(row.brand_id)) {
      latestByBrand.set(row.brand_id, {
        value: row.value,
        percentileRank: row.percentile_rank,
      });
    }
  }

  const toComparison = (row: BrandRow): FranchiseComparison =>
    buildComparison(row, latestByBrand.get(row.id) ?? null);

  const proposedComparison = toComparison(proposedRow);
  const alternativeComparisons = candidates
    .map(toComparison)
    .sort((a, b) => b.feasibilityScore - a.feasibilityScore)
    .slice(0, MAX_ALTERNATIVES);

  const betterAlternativeExists = alternativeComparisons.some(
    (alt) => alt.feasibilityScore > proposedComparison.feasibilityScore,
  );
  const proposedRank =
    1 +
    alternativeComparisons.filter(
      (alt) => alt.feasibilityScore > proposedComparison.feasibilityScore,
    ).length;

  return {
    proposedBrand: proposedComparison,
    alternatives: alternativeComparisons,
    proposedRank,
    betterAlternativeExists,
  };
}

async function resolveProposedBrand(
  sb: ReturnType<typeof supabaseAdmin>,
  proposedBrandId: string | null,
  proposedBrandName: string | null,
): Promise<BrandRow | null> {
  if (proposedBrandId) {
    const { data } = await sb
      .from("franchise_brands")
      .select(BRAND_COLUMNS)
      .eq("id", proposedBrandId)
      .eq("canonical", true)
      .maybeSingle();
    return (data as BrandRow | null) ?? null;
  }

  if (proposedBrandName) {
    const { data } = await sb.rpc("search_franchise_brands" as never, {
      search_term: proposedBrandName,
      result_limit: 1,
    } as never);
    const top = (data as Array<{ id: string }> | null)?.[0];
    if (!top?.id) return null;

    const { data: row } = await sb
      .from("franchise_brands")
      .select(BRAND_COLUMNS)
      .eq("id", top.id)
      .maybeSingle();
    return (row as BrandRow | null) ?? null;
  }

  return null;
}

function buildComparison(
  row: BrandRow,
  item19: { value: number; percentileRank: number | null } | null,
): FranchiseComparison {
  const supportFlag =
    row.has_item_19 && row.sba_eligible && (row.unit_count ?? 0) >= 50
      ? true
      : false;

  const scores = [
    scoreFranchiseSbaCertification(row.sba_certification_status),
    scoreFddItem19Percentile(item19?.percentileRank ?? null),
    scoreBrandMaturity(row.unit_count),
    scoreFranchisorSupportBinary(supportFlag),
  ].filter((s): s is number => s != null);

  const feasibilityScore =
    scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / (scores.length * 5)) * 100)
      : 0;

  const matchReasons: string[] = [];
  const riskFactors: string[] = [];

  if (row.sba_certification_status?.toLowerCase() === "certified") {
    matchReasons.push("SBA-certified franchise system");
  }
  if (item19?.percentileRank != null && item19.percentileRank >= 60) {
    matchReasons.push(
      `Item 19 economics rank in the top ${100 - Math.round(item19.percentileRank)}% of disclosed systems`,
    );
  }
  if ((row.unit_count ?? 0) >= 200) {
    matchReasons.push(`Established system — ${row.unit_count} units`);
  }
  if (matchReasons.length === 0) {
    matchReasons.push("Comparable initial investment range");
  }

  if (!row.has_item_19) {
    riskFactors.push(
      "Franchisor has not disclosed FDD Item 19 financial performance data",
    );
  }
  if (
    row.sba_certification_status == null ||
    row.sba_certification_status.toLowerCase() === "not_listed"
  ) {
    riskFactors.push("SBA certification status not yet verified");
  }

  return {
    brandName: row.brand_name,
    feasibilityScore,
    systemAverageRevenue: item19?.value ?? null,
    initialInvestmentLow: row.initial_investment_min,
    initialInvestmentHigh: row.initial_investment_max,
    royaltyPct: row.royalty_pct,
    sbaCertified: row.sba_certification_status?.toLowerCase() === "certified",
    matchReasons,
    riskFactors,
  };
}
