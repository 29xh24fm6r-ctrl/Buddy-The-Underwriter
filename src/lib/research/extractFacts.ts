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
  TextValue,
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
 * Extract facts from Census ACS (American Community Survey) data.
 * Handles population, income, age distribution, housing data.
 *
 * Census ACS variable codes:
 * - B01003_001E: Total population
 * - B01002_001E: Median age
 * - B19013_001E: Median household income
 * - B19301_001E: Per capita income
 * - B25077_001E: Median home value
 */
function extractCensusAcsFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as unknown;

  if (!Array.isArray(content) || content.length < 2) {
    return facts;
  }

  // Census API returns: [headers, ...rows]
  const headers = content[0] as string[];
  const rows = content.slice(1) as string[][];

  // Find column indices
  const nameIdx = headers.indexOf("NAME");
  const popIdx = headers.indexOf("B01003_001E");
  const medianAgeIdx = headers.indexOf("B01002_001E");
  const medianIncomeIdx = headers.indexOf("B19013_001E");
  const perCapitaIncomeIdx = headers.indexOf("B19301_001E");
  const homeValueIdx = headers.indexOf("B25077_001E");
  const stateIdx = headers.indexOf("state");
  const countyIdx = headers.indexOf("county");

  for (const row of rows) {
    const name = nameIdx >= 0 ? row[nameIdx] : "Unknown";
    const population = popIdx >= 0 ? parseInt(row[popIdx], 10) : NaN;
    const medianAge = medianAgeIdx >= 0 ? parseFloat(row[medianAgeIdx]) : NaN;
    const medianIncome = medianIncomeIdx >= 0 ? parseInt(row[medianIncomeIdx], 10) : NaN;
    const perCapitaIncome = perCapitaIncomeIdx >= 0 ? parseInt(row[perCapitaIncomeIdx], 10) : NaN;
    const homeValue = homeValueIdx >= 0 ? parseInt(row[homeValueIdx], 10) : NaN;

    // Determine geography level
    const state = stateIdx >= 0 ? row[stateIdx] : null;
    const county = countyIdx >= 0 ? row[countyIdx] : null;
    const geoLevel = county ? "county" : state ? "state" : "national";

    // Skip US total when we have state-level data (avoid duplicates)
    if (name === "United States" && rows.length > 1) continue;

    // Population fact
    if (!isNaN(population) && population > 0) {
      facts.push({
        source_id: source.id,
        fact_type: "population",
        value: {
          value: population,
          unit: "persons",
          year: 2022,
          geography: name,
        } as NumericValue,
        confidence: 0.95,
        extracted_by: "rule",
        extraction_path: `$.B01003_001E[NAME=${name}]`,
        as_of_date: "2022-01-01",
      });
    }

    // Median income fact
    if (!isNaN(medianIncome) && medianIncome > 0) {
      facts.push({
        source_id: source.id,
        fact_type: "median_income",
        value: {
          value: medianIncome,
          unit: "USD/year",
          year: 2022,
          geography: name,
        } as NumericValue,
        confidence: 0.95,
        extracted_by: "rule",
        extraction_path: `$.B19013_001E[NAME=${name}]`,
        as_of_date: "2022-01-01",
      });
    }

    // Per capita income (good for business planning)
    if (!isNaN(perCapitaIncome) && perCapitaIncome > 0) {
      facts.push({
        source_id: source.id,
        fact_type: "other",
        value: {
          text: `${perCapitaIncome}`,
          category: "per_capita_income",
        },
        confidence: 0.95,
        extracted_by: "rule",
        extraction_path: `$.B19301_001E[NAME=${name}]`,
        as_of_date: "2022-01-01",
      });
    }

    // Business density proxy (from home values - higher value areas = more commerce)
    if (!isNaN(homeValue) && homeValue > 0 && geoLevel !== "national") {
      facts.push({
        source_id: source.id,
        fact_type: "other",
        value: {
          text: `${homeValue}`,
          category: "median_home_value",
        },
        confidence: 0.9,
        extracted_by: "rule",
        extraction_path: `$.B25077_001E[NAME=${name}]`,
        as_of_date: "2022-01-01",
      });
    }

    // Median age (important for target market analysis)
    if (!isNaN(medianAge) && medianAge > 0) {
      facts.push({
        source_id: source.id,
        fact_type: "other",
        value: {
          text: `${medianAge}`,
          category: "median_age",
        },
        confidence: 0.95,
        extracted_by: "rule",
        extraction_path: `$.B01002_001E[NAME=${name}]`,
        as_of_date: "2022-01-01",
      });
    }
  }

  return facts;
}

/**
 * Extract facts from Census Population Estimates Program data.
 * Handles year-over-year population changes.
 */
function extractCensusPopulationEstimateFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as unknown;

  if (!Array.isArray(content) || content.length < 2) {
    return facts;
  }

  const headers = content[0] as string[];
  const rows = content.slice(1) as string[][];

  // Find column indices
  const nameIdx = headers.indexOf("NAME");
  const pop2023Idx = headers.indexOf("POP_2023");
  const pop2022Idx = headers.indexOf("POP_2022");
  const changeIdx = headers.indexOf("NPOPCHG_2023");

  for (const row of rows) {
    const name = nameIdx >= 0 ? row[nameIdx] : "Unknown";
    const pop2023 = pop2023Idx >= 0 ? parseInt(row[pop2023Idx], 10) : NaN;
    const pop2022 = pop2022Idx >= 0 ? parseInt(row[pop2022Idx], 10) : NaN;
    const change = changeIdx >= 0 ? parseInt(row[changeIdx], 10) : NaN;

    // Skip totals when we have breakdowns
    if (name === "United States" && rows.length > 1) continue;

    // Current population
    if (!isNaN(pop2023) && pop2023 > 0) {
      facts.push({
        source_id: source.id,
        fact_type: "population",
        value: {
          value: pop2023,
          unit: "persons",
          year: 2023,
          geography: name,
        } as NumericValue,
        confidence: 0.95,
        extracted_by: "rule",
        extraction_path: `$.POP_2023[NAME=${name}]`,
        as_of_date: "2023-07-01",
      });
    }

    // Population growth rate
    if (!isNaN(pop2023) && !isNaN(pop2022) && pop2022 > 0) {
      const growthRate = ((pop2023 - pop2022) / pop2022) * 100;
      facts.push({
        source_id: source.id,
        fact_type: "other",
        value: {
          text: `${growthRate.toFixed(2)}`,
          category: "population_growth_rate",
        },
        confidence: 0.9,
        extracted_by: "rule",
        extraction_path: `$.growth_calc[NAME=${name}]`,
        as_of_date: "2023-07-01",
      });
    }

    // Absolute population change
    if (!isNaN(change)) {
      facts.push({
        source_id: source.id,
        fact_type: "other",
        value: {
          text: `${change}`,
          category: "population_change",
        },
        confidence: 0.95,
        extracted_by: "rule",
        extraction_path: `$.NPOPCHG_2023[NAME=${name}]`,
        as_of_date: "2023-07-01",
      });
    }
  }

  return facts;
}

/**
 * Extract facts from Census ACS education and employment data.
 */
function extractCensusEducationEmploymentFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as unknown;

  if (!Array.isArray(content) || content.length < 2) {
    return facts;
  }

  const headers = content[0] as string[];
  const rows = content.slice(1) as string[][];

  const nameIdx = headers.indexOf("NAME");
  // B15003: Educational Attainment
  // B15003_022E: Bachelor's degree
  // B15003_023E: Master's degree
  // B15003_024E: Professional school degree
  // B15003_025E: Doctorate degree
  // B23025_002E: In labor force
  // B23025_005E: Unemployed

  const totalEdIdx = headers.indexOf("B15003_001E");
  const bachelorIdx = headers.indexOf("B15003_022E");
  const masterIdx = headers.indexOf("B15003_023E");
  const profIdx = headers.indexOf("B15003_024E");
  const docIdx = headers.indexOf("B15003_025E");
  const laborForceIdx = headers.indexOf("B23025_002E");
  const unemployedIdx = headers.indexOf("B23025_005E");

  for (const row of rows) {
    const name = nameIdx >= 0 ? row[nameIdx] : "Unknown";
    const totalEd = totalEdIdx >= 0 ? parseInt(row[totalEdIdx], 10) : NaN;
    const bachelor = bachelorIdx >= 0 ? parseInt(row[bachelorIdx], 10) : NaN;
    const master = masterIdx >= 0 ? parseInt(row[masterIdx], 10) : NaN;
    const prof = profIdx >= 0 ? parseInt(row[profIdx], 10) : NaN;
    const doc = docIdx >= 0 ? parseInt(row[docIdx], 10) : NaN;
    const laborForce = laborForceIdx >= 0 ? parseInt(row[laborForceIdx], 10) : NaN;
    const unemployed = unemployedIdx >= 0 ? parseInt(row[unemployedIdx], 10) : NaN;

    // College-educated workforce percentage
    if (!isNaN(totalEd) && totalEd > 0) {
      const collegeEducated = (bachelor || 0) + (master || 0) + (prof || 0) + (doc || 0);
      if (collegeEducated > 0) {
        const pct = (collegeEducated / totalEd) * 100;
        facts.push({
          source_id: source.id,
          fact_type: "other",
          value: {
            text: `${pct.toFixed(1)}`,
            category: "college_educated_pct",
          },
          confidence: 0.9,
          extracted_by: "rule",
          extraction_path: `$.education_calc[NAME=${name}]`,
          as_of_date: "2022-01-01",
        });
      }
    }

    // Unemployment rate
    if (!isNaN(laborForce) && laborForce > 0 && !isNaN(unemployed)) {
      const unemploymentRate = (unemployed / laborForce) * 100;
      facts.push({
        source_id: source.id,
        fact_type: "other",
        value: {
          text: `${unemploymentRate.toFixed(1)}`,
          category: "unemployment_rate",
        },
        confidence: 0.9,
        extracted_by: "rule",
        extraction_path: `$.unemployment_calc[NAME=${name}]`,
        as_of_date: "2022-01-01",
      });
    }
  }

  return facts;
}

/**
 * Extract facts from Census ACS housing data.
 */
function extractCensusHousingFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as unknown;

  if (!Array.isArray(content) || content.length < 2) {
    return facts;
  }

  const headers = content[0] as string[];
  const rows = content.slice(1) as string[][];

  const nameIdx = headers.indexOf("NAME");
  // B25001_001E: Total housing units
  // B25002_002E: Occupied
  // B25002_003E: Vacant
  // B25077_001E: Median home value

  const totalUnitsIdx = headers.indexOf("B25001_001E");
  const occupiedIdx = headers.indexOf("B25002_002E");
  const vacantIdx = headers.indexOf("B25002_003E");
  const homeValueIdx = headers.indexOf("B25077_001E");

  for (const row of rows) {
    const name = nameIdx >= 0 ? row[nameIdx] : "Unknown";
    const totalUnits = totalUnitsIdx >= 0 ? parseInt(row[totalUnitsIdx], 10) : NaN;
    const occupied = occupiedIdx >= 0 ? parseInt(row[occupiedIdx], 10) : NaN;
    const vacant = vacantIdx >= 0 ? parseInt(row[vacantIdx], 10) : NaN;
    const homeValue = homeValueIdx >= 0 ? parseInt(row[homeValueIdx], 10) : NaN;

    // Housing units (proxy for market size)
    if (!isNaN(totalUnits) && totalUnits > 0) {
      facts.push({
        source_id: source.id,
        fact_type: "other",
        value: {
          text: `${totalUnits}`,
          category: "housing_units",
        },
        confidence: 0.95,
        extracted_by: "rule",
        extraction_path: `$.B25001_001E[NAME=${name}]`,
        as_of_date: "2022-01-01",
      });
    }

    // Occupancy rate
    if (!isNaN(totalUnits) && totalUnits > 0 && !isNaN(occupied)) {
      const occupancyRate = (occupied / totalUnits) * 100;
      facts.push({
        source_id: source.id,
        fact_type: "other",
        value: {
          text: `${occupancyRate.toFixed(1)}`,
          category: "housing_occupancy_rate",
        },
        confidence: 0.9,
        extracted_by: "rule",
        extraction_path: `$.occupancy_calc[NAME=${name}]`,
        as_of_date: "2022-01-01",
      });
    }

    // Median home value
    if (!isNaN(homeValue) && homeValue > 0) {
      facts.push({
        source_id: source.id,
        fact_type: "other",
        value: {
          text: `${homeValue}`,
          category: "median_home_value",
        },
        confidence: 0.95,
        extracted_by: "rule",
        extraction_path: `$.B25077_001E[NAME=${name}]`,
        as_of_date: "2022-01-01",
      });
    }
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
  } else if (sourceName.includes("bls") || (sourceName.includes("employment") && !sourceName.includes("census"))) {
    facts = extractBlsEmploymentFacts(source);
  } else if (sourceName.includes("edgar") || sourceName.includes("sec")) {
    facts = extractEdgarCompanyFacts(source);
  } else if (sourceName.includes("census") && sourceName.includes("economic")) {
    facts = extractCensusEconomicFacts(source);
  } else if (sourceName.includes("census") && sourceName.includes("population") && sourceName.includes("estimate")) {
    facts = extractCensusPopulationEstimateFacts(source);
  } else if (sourceName.includes("census") && sourceName.includes("education")) {
    facts = extractCensusEducationEmploymentFacts(source);
  } else if (sourceName.includes("census") && sourceName.includes("housing")) {
    facts = extractCensusHousingFacts(source);
  } else if (sourceName.includes("census") && sourceName.includes("acs")) {
    // Generic ACS extractor for population, income, demographics
    facts = extractCensusAcsFacts(source);
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
