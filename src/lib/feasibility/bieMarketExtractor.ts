import "server-only";

// src/lib/feasibility/bieMarketExtractor.ts
// Phase God Tier Feasibility — Phase 2 Gap A (step 1/9).
//
// Pulls structured, market-relevant claims out of BIE research so the
// scoring engine gets data-driven inputs instead of neutral defaults.
// The output contract (BIEMarketData) is the same shape the Phase 2 spec
// documents; the data sources are the actual tables on main:
//
//   buddy_research_missions     — per-deal mission header
//   buddy_research_facts        — numeric + structured claims (jsonb)
//   buddy_research_inferences   — text conclusions (inference_type, text)
//   buddy_research_narratives   — jsonb sections with compiled prose
//
// (The spec referenced buddy_research_claim_ledger, which does not exist
// in this codebase; we consume the equivalent data from the live tables.)

import { supabaseAdmin } from "@/lib/supabase/admin";

export interface BIEMarketData {
  // From market intelligence thread JSON / inference output
  trendDirection:
    | "improving"
    | "stable"
    | "deteriorating"
    | "unclear"
    | null;

  // Extracted numeric claims from research facts (if parseable)
  populationMentioned: number | null;
  medianIncomeMentioned: number | null;
  unemploymentRateMentioned: number | null;
  competitorCountMentioned: number | null;

  // Qualitative signals from research prose
  hasCompetitorNames: boolean;
  competitorNameCount: number;
  hasRealEstateData: boolean;
  hasNaturalDisasterRisk: boolean;
  hasEconomicConcentrationRisk: boolean;
  hasCrimeRisk: boolean;

  // Raw text for narrative injection
  areaSpecificRisksText: string | null;
  realEstateMarketText: string | null;
  demographicTrendsText: string | null;
}

const DEFAULTS: BIEMarketData = {
  trendDirection: null,
  populationMentioned: null,
  medianIncomeMentioned: null,
  unemploymentRateMentioned: null,
  competitorCountMentioned: null,
  hasCompetitorNames: false,
  competitorNameCount: 0,
  hasRealEstateData: false,
  hasNaturalDisasterRisk: false,
  hasEconomicConcentrationRisk: false,
  hasCrimeRisk: false,
  areaSpecificRisksText: null,
  realEstateMarketText: null,
  demographicTrendsText: null,
};

type FactRow = {
  fact_type: string | null;
  value: unknown;
  confidence: number | string | null;
};
type InferenceRow = {
  inference_type: string | null;
  conclusion: string | null;
};
type NarrativeRow = {
  sections: unknown;
};

// Market-relevant fact types (buddy_research_facts.fact_type). Broad match so
// we pick up semantic variants like "local_market_size", "median_income", etc.
const MARKET_FACT_KEYWORDS = [
  "market",
  "population",
  "income",
  "unemployment",
  "demographic",
  "competitor",
  "competitive",
  "trend",
  "growth",
  "rent",
  "vacancy",
  "real_estate",
  "trade_area",
  "establishment",
];

const COMPETITOR_FACT_KEYWORDS = ["competitor", "competitive"];

const TREND_INFERENCE_KEYWORDS = [
  "growth_trajectory",
  "market_attractiveness",
  "demand_stability",
  "cyclicality",
  "trend_direction",
];

/**
 * Extract structured market data from BIE research for feasibility scoring.
 */
export async function extractBIEMarketData(
  dealId: string,
): Promise<BIEMarketData> {
  const sb = supabaseAdmin();

  // Find latest mission for this deal.
  const { data: mission } = await sb
    .from("buddy_research_missions")
    .select("id")
    .eq("deal_id", dealId)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!mission?.id) return DEFAULTS;
  const missionId = (mission as { id: string }).id;

  // Parallel load facts, inferences, narratives.
  const [factsRes, inferencesRes, narrativesRes] = await Promise.all([
    sb
      .from("buddy_research_facts")
      .select("fact_type, value, confidence")
      .eq("mission_id", missionId),
    sb
      .from("buddy_research_inferences")
      .select("inference_type, conclusion")
      .eq("mission_id", missionId),
    sb
      .from("buddy_research_narratives")
      .select("sections")
      .eq("mission_id", missionId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const facts: FactRow[] = (factsRes.data as FactRow[] | null) ?? [];
  const inferences: InferenceRow[] =
    (inferencesRes.data as InferenceRow[] | null) ?? [];
  const narratives = (narrativesRes.data as NarrativeRow | null) ?? null;

  // Build a union text blob from anything market-relevant so regex scanners
  // have material to bite on. We also keep the prose split so we can emit
  // areaSpecificRisksText / realEstateMarketText / demographicTrendsText.
  const marketFacts = facts.filter((f) =>
    containsAny((f.fact_type ?? "").toLowerCase(), MARKET_FACT_KEYWORDS),
  );
  const marketFactTexts = marketFacts.map((f) => stringifyValue(f.value));
  const inferenceTexts = inferences
    .filter(
      (i) =>
        typeof i.conclusion === "string" &&
        containsAny(
          (i.inference_type ?? "").toLowerCase(),
          TREND_INFERENCE_KEYWORDS,
        ),
    )
    .map((i) => i.conclusion as string);
  const narrativeSectionTexts = collectNarrativeSectionTexts(
    narratives?.sections,
  );

  const proseBlocks = [
    ...marketFactTexts,
    ...inferenceTexts,
    ...narrativeSectionTexts,
  ].filter((t) => t.length > 0);
  const allText = proseBlocks.join(" ");
  const lowerText = allText.toLowerCase();

  // ── Trend direction ─────────────────────────────────────────────
  // Prefer explicit inference signals first; fall back to text sniffing.
  let trendDirection: BIEMarketData["trendDirection"] = null;
  for (const i of inferences) {
    const key = (i.inference_type ?? "").toLowerCase();
    const conc = (i.conclusion ?? "").toLowerCase();
    if (!conc) continue;
    if (key === "trend_direction" || key === "growth_trajectory") {
      if (conc.includes("improv") || conc.includes("rapid") || conc.includes("growing")) {
        trendDirection = "improving";
        break;
      }
      if (
        conc.includes("deteriorat") ||
        conc.includes("declin") ||
        conc.includes("shrink")
      ) {
        trendDirection = "deteriorating";
        break;
      }
      if (conc.includes("stable") || conc.includes("steady")) {
        trendDirection = "stable";
        break;
      }
    }
  }
  if (trendDirection == null && allText) {
    if (
      lowerText.includes("improving") ||
      (lowerText.includes("growth") && lowerText.includes("strong"))
    ) {
      trendDirection = "improving";
    } else if (
      lowerText.includes("deteriorating") ||
      lowerText.includes("declining") ||
      lowerText.includes("contraction")
    ) {
      trendDirection = "deteriorating";
    } else if (lowerText.includes("stable") || lowerText.includes("steady")) {
      trendDirection = "stable";
    } else {
      trendDirection = "unclear";
    }
  }

  // ── Numeric claims ──────────────────────────────────────────────
  // First: pull directly from fact.value where the fact_type signals it.
  let populationMentioned = pickFactNumber(facts, [
    "population",
    "trade_area_population",
  ]);
  let medianIncomeMentioned = pickFactNumber(facts, [
    "median_income",
    "median_household_income",
  ]);
  let unemploymentRateMentioned = pickFactNumber(facts, [
    "unemployment",
    "unemployment_rate",
  ]);
  // Census/IRS-style rates often come as 0.xx; textual claims come as 4.2
  // (meaning 4.2%). Normalise so our output is always 0.xx.
  if (
    unemploymentRateMentioned != null &&
    unemploymentRateMentioned > 1 &&
    unemploymentRateMentioned <= 100
  ) {
    unemploymentRateMentioned = unemploymentRateMentioned / 100;
  }

  // Second: fall back to regex over the text blob when facts didn't surface
  // a clean numeric.
  if (populationMentioned == null) {
    const popMatch =
      allText.match(
        /population[^.]*?([\d,]+(?:\.\d+)?)\s*(?:residents|people|population)?/i,
      ) ?? allText.match(/([\d,]+(?:\.\d+)?)\s*(?:residents|people)/i);
    populationMentioned = popMatch ? parseNumericClaim(popMatch[1]) : null;
  }
  if (medianIncomeMentioned == null) {
    const incomeMatch =
      allText.match(
        /median\s+(?:household\s+)?income[^.]*?\$\s*([\d,.]+\s*[KkMm]?)/i,
      ) ?? allText.match(/\$\s*([\d,.]+\s*[KkMm]?)\s*median/i);
    medianIncomeMentioned = incomeMatch ? parseNumericClaim(incomeMatch[1]) : null;
  }
  if (unemploymentRateMentioned == null) {
    const ueMatch =
      allText.match(/unemployment[^.]*?([\d.]+)\s*%/i) ??
      allText.match(/([\d.]+)\s*%\s*unemployment/i);
    unemploymentRateMentioned = ueMatch ? parseFloat(ueMatch[1]) / 100 : null;
  }

  // Competitor count — count facts with competitor keywords; fall back to
  // competitor_count fact if one was stored.
  const competitorFacts = facts.filter((f) =>
    containsAny((f.fact_type ?? "").toLowerCase(), COMPETITOR_FACT_KEYWORDS),
  );
  const storedCompetitorCount = pickFactNumber(facts, [
    "competitor_count",
    "competitive_density",
  ]);
  const competitorNameCount = Math.max(
    storedCompetitorCount ?? 0,
    competitorFacts.length,
  );
  const hasCompetitorNames = competitorNameCount > 0;

  // ── Risk keyword scanning ──────────────────────────────────────
  const hasNaturalDisasterRisk =
    /flood|hurricane|wildfire|tornado|earthquake|storm\s*surge/i.test(
      lowerText,
    );
  const hasEconomicConcentrationRisk =
    /single.?employer|economic.?concentration|military.?base|one.?industry/i.test(
      lowerText,
    );
  const hasCrimeRisk = /crime|high.?crime|elevated.?crime|safety.?concern/i.test(
    lowerText,
  );
  const hasRealEstateData =
    /vacancy|commercial.?real.?estate|rent.?per|lease.?rate|office.?market|retail.?market/i.test(
      lowerText,
    );

  // ── Narrative slice builders ───────────────────────────────────
  const pickProseMatching = (keywords: RegExp): string | null => {
    const hits = proseBlocks.filter((t) => keywords.test(t));
    return hits.length > 0 ? hits.join(" ") : null;
  };

  const areaSpecificRisksText = pickProseMatching(
    /risk|disaster|flood|hurricane|crime|concentration|wildfire|tornado/i,
  );
  const realEstateMarketText = pickProseMatching(
    /vacancy|real\s*estate|rent|lease|office\s*market|retail\s*market/i,
  );
  const demographicTrendsText = pickProseMatching(
    /population|median|demographic|income|household/i,
  );

  return {
    trendDirection,
    populationMentioned,
    medianIncomeMentioned,
    unemploymentRateMentioned,
    competitorCountMentioned: hasCompetitorNames ? competitorNameCount : null,
    hasCompetitorNames,
    competitorNameCount,
    hasRealEstateData,
    hasNaturalDisasterRisk,
    hasEconomicConcentrationRisk,
    hasCrimeRisk,
    areaSpecificRisksText,
    realEstateMarketText,
    demographicTrendsText,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function containsAny(haystack: string, needles: string[]): boolean {
  for (const n of needles) if (haystack.includes(n)) return true;
  return false;
}

function stringifyValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

function pickFactNumber(facts: FactRow[], keys: string[]): number | null {
  for (const k of keys) {
    const hit = facts.find(
      (f) => (f.fact_type ?? "").toLowerCase() === k.toLowerCase(),
    );
    if (!hit) continue;
    const n = coerceNumber(hit.value);
    if (n != null) return n;
  }
  // Fall back to any fact whose type *contains* one of the keys (catches
  // variants like local_median_income).
  for (const k of keys) {
    const hit = facts.find((f) =>
      (f.fact_type ?? "").toLowerCase().includes(k.toLowerCase()),
    );
    if (!hit) continue;
    const n = coerceNumber(hit.value);
    if (n != null) return n;
  }
  return null;
}

function coerceNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[,$%\s]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if ("value" in obj) return coerceNumber(obj.value);
    if ("amount" in obj) return coerceNumber(obj.amount);
    if ("number" in obj) return coerceNumber(obj.number);
  }
  return null;
}

function parseNumericClaim(raw: string): number | null {
  if (!raw) return null;
  let cleaned = raw.replace(/,/g, "").trim();
  let multiplier = 1;
  if (/[Kk]$/.test(cleaned)) {
    multiplier = 1000;
    cleaned = cleaned.slice(0, -1);
  }
  if (/[Mm]$/.test(cleaned)) {
    multiplier = 1_000_000;
    cleaned = cleaned.slice(0, -1);
  }
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n * multiplier : null;
}

/**
 * buddy_research_narratives.sections is a jsonb blob. We don't know the exact
 * shape ahead of time (it has evolved across phases), so walk it depth-first
 * and collect every string value we find.
 */
function collectNarrativeSectionTexts(sections: unknown): string[] {
  if (sections == null) return [];
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === "string") {
      if (node.length >= 20) out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node === "object") {
      for (const v of Object.values(node as Record<string, unknown>)) walk(v);
    }
  };
  walk(sections);
  return out;
}
