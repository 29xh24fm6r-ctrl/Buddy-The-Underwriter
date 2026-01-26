/**
 * Fact Extraction Engine
 *
 * Extracts atomic facts from raw source data.
 * Rule-based extraction preferred. LLM only proposes candidates.
 * Each fact links to exactly ONE source.
 */

import type {
  ResearchSource,
  ResearchFact,
  FactType,
  FactValue,
  FactExtractionResult,
  EmploymentValue,
  CompetitorValue,
  NumericValue,
} from "./types";
import { hasValidContent } from "./ingestSource";

type ExtractedFact = Omit<ResearchFact, "id" | "mission_id" | "extracted_at">;

/**
 * Extract facts from Census County Business Patterns data.
 * Expected format: array of arrays from Census API
 */
function extractCensusCbpFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as unknown;

  if (!Array.isArray(content) || content.length < 2) {
    return facts;
  }

  // Census API returns: [headers, ...rows]
  const headers = content[0] as string[];
  const rows = content.slice(1) as string[][];

  // Find column indices
  const naicsIdx = headers.indexOf("NAICS2017");
  const labelIdx = headers.indexOf("NAICS2017_LABEL");
  const estabIdx = headers.indexOf("ESTAB");
  const empIdx = headers.indexOf("EMP");
  const payIdx = headers.indexOf("PAYANN");

  for (const row of rows) {
    const naicsCode = naicsIdx >= 0 ? row[naicsIdx] : null;
    const label = labelIdx >= 0 ? row[labelIdx] : null;
    const estab = estabIdx >= 0 ? parseInt(row[estabIdx], 10) : NaN;
    const emp = empIdx >= 0 ? parseInt(row[empIdx], 10) : NaN;
    const payann = payIdx >= 0 ? parseInt(row[payIdx], 10) : NaN;

    // Skip invalid rows
    if (!naicsCode || naicsCode === "00") continue;

    // Extract establishment count
    if (!isNaN(estab) && estab > 0) {
      facts.push({
        source_id: source.id,
        fact_type: "establishment_count",
        value: {
          value: estab,
          unit: "establishments",
          year: 2021, // CBP 2021 data
          geography: "US",
        } as NumericValue,
        confidence: 0.95,
        extracted_by: "rule",
        extraction_path: `$.ESTAB[NAICS2017=${naicsCode}]`,
        as_of_date: "2021-01-01",
      });
    }

    // Extract employment count
    if (!isNaN(emp) && emp > 0) {
      facts.push({
        source_id: source.id,
        fact_type: "employment_count",
        value: {
          count: emp,
          year: 2021,
          geography: "US",
        } as EmploymentValue,
        confidence: 0.95,
        extracted_by: "rule",
        extraction_path: `$.EMP[NAICS2017=${naicsCode}]`,
        as_of_date: "2021-01-01",
      });
    }

    // Extract average wage (payroll / employment)
    if (!isNaN(emp) && !isNaN(payann) && emp > 0) {
      const avgWage = Math.round((payann * 1000) / emp); // PAYANN is in $1000s
      facts.push({
        source_id: source.id,
        fact_type: "average_wage",
        value: {
          value: avgWage,
          unit: "USD/year",
          year: 2021,
          geography: "US",
        } as NumericValue,
        confidence: 0.9,
        extracted_by: "rule",
        extraction_path: `$.PAYANN/$.EMP[NAICS2017=${naicsCode}]`,
        as_of_date: "2021-01-01",
      });
    }
  }

  return facts;
}

/**
 * Extract facts from BLS employment data.
 * Expected format: BLS API response with Results.series
 */
function extractBlsEmploymentFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as Record<string, unknown>;

  const results = content?.Results as Record<string, unknown> | undefined;
  const series = results?.series as Array<Record<string, unknown>> | undefined;

  if (!series || !Array.isArray(series)) {
    return facts;
  }

  for (const s of series) {
    const data = s?.data as Array<Record<string, unknown>> | undefined;
    if (!data || !Array.isArray(data)) continue;

    // Get latest and earliest for growth calculation
    const sorted = [...data].sort((a, b) => {
      const aYear = parseInt(String(a.year), 10);
      const bYear = parseInt(String(b.year), 10);
      const aPeriod = String(a.period ?? "M01");
      const bPeriod = String(b.period ?? "M01");
      if (aYear !== bYear) return bYear - aYear;
      return bPeriod.localeCompare(aPeriod);
    });

    if (sorted.length === 0) continue;

    // Latest employment figure
    const latest = sorted[0];
    const latestValue = parseFloat(String(latest.value));
    const latestYear = parseInt(String(latest.year), 10);

    if (!isNaN(latestValue) && !isNaN(latestYear)) {
      facts.push({
        source_id: source.id,
        fact_type: "employment_count",
        value: {
          count: Math.round(latestValue * 1000), // BLS data is in thousands
          year: latestYear,
          geography: "US",
        } as EmploymentValue,
        confidence: 0.95,
        extracted_by: "rule",
        extraction_path: `$.Results.series[0].data[0]`,
        as_of_date: `${latestYear}-12-01`,
      });
    }

    // Employment growth (if we have multi-year data)
    if (sorted.length >= 12) {
      // Compare to same period 5 years ago if available
      const fiveYearsAgo = sorted.find((d) => {
        const y = parseInt(String(d.year), 10);
        return y === latestYear - 5;
      });

      if (fiveYearsAgo) {
        const oldValue = parseFloat(String(fiveYearsAgo.value));
        if (!isNaN(oldValue) && oldValue > 0) {
          const growthPct = ((latestValue - oldValue) / oldValue) * 100;
          facts.push({
            source_id: source.id,
            fact_type: "employment_growth",
            value: {
              count: Math.round(latestValue * 1000),
              year: latestYear,
              geography: "US",
              change_pct: Math.round(growthPct * 10) / 10,
            } as EmploymentValue,
            confidence: 0.9,
            extracted_by: "rule",
            extraction_path: `$.Results.series[0].data[growth_calc]`,
            as_of_date: `${latestYear}-12-01`,
          });
        }
      }
    }
  }

  return facts;
}

/**
 * Extract facts from SEC EDGAR company search results.
 * Expected format: EDGAR full-text search API response
 */
function extractEdgarCompanyFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as Record<string, unknown>;

  // EDGAR search returns hits with _source containing company info
  const hits = (content?.hits as Record<string, unknown>)?.hits as Array<Record<string, unknown>> | undefined;

  if (!hits || !Array.isArray(hits)) {
    return facts;
  }

  // Track unique companies by CIK
  const seenCiks = new Set<string>();

  for (const hit of hits) {
    const src = hit._source as Record<string, unknown> | undefined;
    if (!src) continue;

    const cik = String(src.cik ?? "");
    const displayNames = src.display_names as string[] | undefined;
    const tickers = src.tickers as string[] | undefined;
    const companyName = String(displayNames?.[0] ?? src.entity ?? "");
    const ticker = String(tickers?.[0] ?? "");

    if (!cik || seenCiks.has(cik)) continue;
    seenCiks.add(cik);

    // Skip if no company name
    if (!companyName) continue;

    facts.push({
      source_id: source.id,
      fact_type: "competitor_name",
      value: {
        name: companyName,
        cik,
        ticker: ticker || undefined,
      } as CompetitorValue,
      confidence: 0.9,
      extracted_by: "rule",
      extraction_path: `$.hits.hits[cik=${cik}]`,
    });
  }

  return facts;
}

/**
 * Extract facts from Census Economic Census data.
 */
function extractCensusEconomicFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as unknown;

  if (!Array.isArray(content) || content.length < 2) {
    return facts;
  }

  // Census API returns: [headers, ...rows]
  const headers = content[0] as string[];
  const rows = content.slice(1) as string[][];

  // Find column indices
  const naicsIdx = headers.indexOf("NAICS2017");
  const estabIdx = headers.indexOf("ESTAB");
  const rcptotIdx = headers.indexOf("RCPTOT"); // Total receipts
  const empIdx = headers.indexOf("EMP");

  for (const row of rows) {
    const naicsCode = naicsIdx >= 0 ? row[naicsIdx] : null;
    const estab = estabIdx >= 0 ? parseInt(row[estabIdx], 10) : NaN;
    const rcptot = rcptotIdx >= 0 ? parseInt(row[rcptotIdx], 10) : NaN;
    const emp = empIdx >= 0 ? parseInt(row[empIdx], 10) : NaN;

    if (!naicsCode || naicsCode === "00") continue;

    // Market size proxy (total receipts)
    if (!isNaN(rcptot) && rcptot > 0) {
      facts.push({
        source_id: source.id,
        fact_type: "market_size",
        value: {
          amount: rcptot * 1000, // RCPTOT is in $1000s
          currency: "USD",
          year: 2022,
          scope: "US",
        },
        confidence: 0.9,
        extracted_by: "rule",
        extraction_path: `$.RCPTOT[NAICS2017=${naicsCode}]`,
        as_of_date: "2022-01-01",
      });
    }
  }

  return facts;
}

/**
 * Main fact extraction function.
 * Routes to appropriate extractor based on source characteristics.
 */
export function extractFacts(source: ResearchSource): FactExtractionResult {
  // Skip sources with errors
  if (!hasValidContent(source)) {
    return { facts: [] };
  }

  const sourceName = source.source_name.toLowerCase();
  let facts: ExtractedFact[] = [];

  // Route to appropriate extractor
  if (sourceName.includes("census") && sourceName.includes("business patterns")) {
    facts = extractCensusCbpFacts(source);
  } else if (sourceName.includes("bls") || sourceName.includes("employment")) {
    facts = extractBlsEmploymentFacts(source);
  } else if (sourceName.includes("edgar") || sourceName.includes("sec")) {
    facts = extractEdgarCompanyFacts(source);
  } else if (sourceName.includes("census") && sourceName.includes("economic")) {
    facts = extractCensusEconomicFacts(source);
  }

  return { facts };
}

/**
 * Extract facts from multiple sources.
 */
export function extractFactsFromSources(sources: ResearchSource[]): ExtractedFact[] {
  const allFacts: ExtractedFact[] = [];

  for (const source of sources) {
    const result = extractFacts(source);
    allFacts.push(...result.facts);
  }

  return allFacts;
}
