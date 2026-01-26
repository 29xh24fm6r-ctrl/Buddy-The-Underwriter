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

// ============================================================================
// Regulatory Fact Extractors (Phase 3)
// ============================================================================

/**
 * Extract facts from Federal Register API data.
 * Expected format: Federal Register API response with documents array.
 */
function extractFederalRegisterFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as Record<string, unknown>;

  const results = content?.results as Array<Record<string, unknown>> | undefined;
  if (!results || !Array.isArray(results)) {
    return facts;
  }

  // Count rules by type (proposed vs final)
  let proposedRules = 0;
  let finalRules = 0;
  let notices = 0;

  for (const doc of results) {
    const docType = String(doc.type ?? "").toLowerCase();
    const agencies = doc.agencies as Array<Record<string, unknown>> | undefined;

    if (docType.includes("proposed rule")) {
      proposedRules++;
    } else if (docType.includes("rule")) {
      finalRules++;
    } else if (docType.includes("notice")) {
      notices++;
    }

    // Extract compliance requirements from significant rules
    const significant = doc.significant === true;
    const title = String(doc.title ?? "");
    const abstract = String(doc.abstract ?? "");

    if (significant && (title || abstract)) {
      facts.push({
        source_id: source.id,
        fact_type: "compliance_requirement",
        value: {
          text: title.slice(0, 200),
          category: "federal_rule",
        } as TextValue,
        confidence: 0.85,
        extracted_by: "rule",
        extraction_path: `$.results[document_number=${doc.document_number}]`,
        as_of_date: String(doc.publication_date ?? ""),
      });
    }
  }

  // Summarize regulatory activity level
  const totalRules = proposedRules + finalRules;
  if (totalRules > 0) {
    facts.push({
      source_id: source.id,
      fact_type: "federal_rule_count",
      value: {
        value: totalRules,
        unit: "rules (12mo)",
        year: new Date().getFullYear(),
      } as NumericValue,
      confidence: 0.9,
      extracted_by: "rule",
      extraction_path: "$.results.count",
    });
  }

  // Determine regulatory burden level based on activity
  let burdenLevel: "low" | "medium" | "high" = "low";
  if (totalRules > 20 || notices > 50) {
    burdenLevel = "high";
  } else if (totalRules > 5 || notices > 20) {
    burdenLevel = "medium";
  }

  facts.push({
    source_id: source.id,
    fact_type: "regulatory_burden_level",
    value: {
      text: burdenLevel,
      category: "federal_activity",
    } as TextValue,
    confidence: 0.75,
    extracted_by: "rule",
    extraction_path: "$.results.derived_burden",
  });

  return facts;
}

/**
 * Extract facts from OSHA enforcement data.
 */
function extractOshaEnforcementFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as Record<string, unknown>;

  // OSHA API returns enforcement data
  const data = content?.data as Array<Record<string, unknown>> | undefined;
  if (!data || !Array.isArray(data)) {
    // Try alternative format
    if (Array.isArray(content)) {
      return extractOshaEnforcementFactsFromArray(source, content);
    }
    return facts;
  }

  // Count violations and penalties
  let totalViolations = 0;
  let totalPenalty = 0;
  let seriousViolations = 0;

  for (const record of data.slice(0, 100)) {
    const violations = parseInt(String(record.total_violations ?? 0), 10);
    const penalty = parseFloat(String(record.total_penalty ?? 0));
    const serious = parseInt(String(record.serious_violations ?? 0), 10);

    if (!isNaN(violations)) totalViolations += violations;
    if (!isNaN(penalty)) totalPenalty += penalty;
    if (!isNaN(serious)) seriousViolations += serious;
  }

  if (totalViolations > 0) {
    facts.push({
      source_id: source.id,
      fact_type: "enforcement_action_count",
      value: {
        value: totalViolations,
        unit: "violations",
      } as NumericValue,
      confidence: 0.85,
      extracted_by: "rule",
      extraction_path: "$.data.total_violations",
    });
  }

  // Derive compliance cost indicator from penalties
  if (totalPenalty > 0) {
    let costIndicator: "low" | "medium" | "high" = "low";
    const avgPenalty = totalPenalty / Math.max(data.length, 1);
    if (avgPenalty > 50000) {
      costIndicator = "high";
    } else if (avgPenalty > 10000) {
      costIndicator = "medium";
    }

    facts.push({
      source_id: source.id,
      fact_type: "compliance_cost_indicator",
      value: {
        text: costIndicator,
        category: "osha_penalty_avg",
      } as TextValue,
      confidence: 0.7,
      extracted_by: "rule",
      extraction_path: "$.data.derived_cost",
    });
  }

  return facts;
}

function extractOshaEnforcementFactsFromArray(source: ResearchSource, content: unknown[]): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  // If it's an array of inspection records
  if (content.length > 0) {
    facts.push({
      source_id: source.id,
      fact_type: "enforcement_action_count",
      value: {
        value: content.length,
        unit: "inspections",
      } as NumericValue,
      confidence: 0.8,
      extracted_by: "rule",
      extraction_path: "$.length",
    });
  }

  return facts;
}

/**
 * Extract facts from EPA ECHO data.
 */
function extractEpaEchoFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as Record<string, unknown>;

  const results = content?.Results as Record<string, unknown>;
  const facilities = results?.Facilities as Array<Record<string, unknown>> | undefined;

  if (!facilities || !Array.isArray(facilities)) {
    return facts;
  }

  // Analyze compliance status across facilities
  let inViolation = 0;
  let significantViolations = 0;

  for (const facility of facilities.slice(0, 100)) {
    const compStatus = String(facility.CurrViolFlag ?? "N");
    const qatrStatus = String(facility.QtrsInNC ?? "0");

    if (compStatus === "Y") inViolation++;
    if (parseInt(qatrStatus, 10) >= 4) significantViolations++;
  }

  if (facilities.length > 0) {
    const violationRate = (inViolation / facilities.length) * 100;

    facts.push({
      source_id: source.id,
      fact_type: "compliance_requirement",
      value: {
        text: `${violationRate.toFixed(1)}% industry violation rate`,
        category: "epa_compliance",
      } as TextValue,
      confidence: 0.8,
      extracted_by: "rule",
      extraction_path: "$.Results.Facilities.violation_rate",
    });

    // Regulatory burden from EPA
    let epaRisk: "low" | "medium" | "high" = "low";
    if (violationRate > 20 || significantViolations > 10) {
      epaRisk = "high";
    } else if (violationRate > 10 || significantViolations > 5) {
      epaRisk = "medium";
    }

    facts.push({
      source_id: source.id,
      fact_type: "regulatory_burden_level",
      value: {
        text: epaRisk,
        category: "epa_enforcement",
      } as TextValue,
      confidence: 0.75,
      extracted_by: "rule",
      extraction_path: "$.Results.Facilities.derived_risk",
    });
  }

  return facts;
}

/**
 * Extract facts from SBA size standards data.
 */
function extractSbaSizeStandardsFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as Record<string, unknown>;

  // SBA data varies by format - try to extract relevant info
  const result = content?.result as Record<string, unknown> | undefined;
  const data = result?.records as Array<Record<string, unknown>> | undefined;

  if (!data || !Array.isArray(data)) {
    return facts;
  }

  for (const record of data.slice(0, 10)) {
    const naics = String(record.NAICS ?? record.naics_code ?? "");
    const sizeStandard = String(record.size_standard ?? record.SizeStandard ?? "");

    if (naics && sizeStandard) {
      facts.push({
        source_id: source.id,
        fact_type: "compliance_requirement",
        value: {
          text: `SBA size standard: ${sizeStandard}`,
          category: "sba_size",
        } as TextValue,
        confidence: 0.9,
        extracted_by: "rule",
        extraction_path: `$.result.records[NAICS=${naics}]`,
      });
    }
  }

  return facts;
}

/**
 * Extract facts indicating licensing requirements from state sources.
 */
function extractStateLicensingFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  // State licensing pages are typically HTML - we note that licensing is required
  // The actual license status would need to be checked manually
  const sourceName = source.source_name;
  const stateMatch = sourceName.match(/^([A-Z]{2})\s+State/);
  const stateCode = stateMatch?.[1];

  if (stateCode) {
    facts.push({
      source_id: source.id,
      fact_type: "licensing_required",
      value: {
        text: "yes",
        category: `${stateCode}_state_licensing`,
      } as TextValue,
      confidence: 0.7,
      extracted_by: "rule",
      extraction_path: "$.derived_from_source_type",
    });

    facts.push({
      source_id: source.id,
      fact_type: "state_specific_constraint",
      value: {
        text: `State licensing required in ${stateCode}`,
        category: "licensing",
      } as TextValue,
      confidence: 0.7,
      extracted_by: "rule",
      extraction_path: "$.derived_from_source_type",
    });
  }

  return facts;
}

// ============================================================================
// Management Background Fact Extractors (Phase 4)
// ============================================================================

/**
 * Extract management facts from SEC EDGAR filings.
 */
function extractEdgarManagementFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as Record<string, unknown>;

  const hits = (content?.hits as Record<string, unknown>)?.hits as Array<Record<string, unknown>> | undefined;

  if (!hits || !Array.isArray(hits)) {
    return facts;
  }

  for (const hit of hits.slice(0, 10)) {
    const src = hit._source as Record<string, unknown> | undefined;
    if (!src) continue;

    const companyName = String(src.entity ?? src.company ?? "");
    const filingDate = String(src.file_date ?? src.filing_date ?? "");
    const formType = String(src.form ?? "");

    if (!companyName) continue;

    // Proxy statements (DEF 14A) contain management info
    if (formType.includes("DEF") || formType.includes("14A")) {
      facts.push({
        source_id: source.id,
        fact_type: "prior_entity",
        value: {
          text: companyName,
          category: "sec_filing",
        } as TextValue,
        confidence: 0.85,
        extracted_by: "rule",
        extraction_path: `$.hits.hits[entity=${companyName}]`,
        as_of_date: filingDate,
      });
    }

    // 10-K filings indicate operating history
    if (formType === "10-K") {
      facts.push({
        source_id: source.id,
        fact_type: "role_history",
        value: {
          text: `Public company executive: ${companyName}`,
          category: "sec_10k",
        } as TextValue,
        confidence: 0.8,
        extracted_by: "rule",
        extraction_path: `$.hits.hits[form=10-K]`,
        as_of_date: filingDate,
      });
    }
  }

  return facts;
}

/**
 * Extract facts from OFAC sanctions list.
 */
function extractOfacSanctionsFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content;

  // OFAC data is CSV - if we got it successfully, note the screening
  if (content) {
    // The presence of data means we can perform screening
    // Actual matches would require name comparison
    facts.push({
      source_id: source.id,
      fact_type: "sanctions_status",
      value: {
        text: "screening_available",
        category: "ofac",
      } as TextValue,
      confidence: 0.6,
      extracted_by: "rule",
      extraction_path: "$.derived_from_source",
    });
  }

  return facts;
}

/**
 * Extract facts from SAM.gov exclusions data.
 */
function extractSamExclusionsFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as Record<string, unknown>;

  // SAM.gov API returns organization data
  const orgs = content?.orglist as Array<Record<string, unknown>> | undefined;

  if (orgs && Array.isArray(orgs) && orgs.length > 0) {
    // Note that debarment data is available
    facts.push({
      source_id: source.id,
      fact_type: "adverse_event",
      value: {
        text: "debarment_screening_available",
        category: "sam_gov",
      } as TextValue,
      confidence: 0.6,
      extracted_by: "rule",
      extraction_path: "$.orglist.derived",
    });
  }

  return facts;
}

/**
 * Extract facts from CourtListener/RECAP court records.
 */
function extractCourtRecordsFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as Record<string, unknown>;

  const results = content?.results as Array<Record<string, unknown>> | undefined;

  if (!results || !Array.isArray(results)) {
    return facts;
  }

  // Count cases by type
  let bankruptcyCases = 0;
  let civilCases = 0;

  for (const docket of results.slice(0, 50)) {
    const court = String(docket.court ?? "").toLowerCase();
    const caseName = String(docket.case_name ?? "");

    if (court.includes("bankr")) {
      bankruptcyCases++;

      facts.push({
        source_id: source.id,
        fact_type: "bankruptcy_history",
        value: {
          text: caseName.slice(0, 100),
          category: "court_record",
        } as TextValue,
        confidence: 0.75,
        extracted_by: "rule",
        extraction_path: `$.results[court=${court}]`,
        as_of_date: String(docket.date_filed ?? ""),
      });
    } else {
      civilCases++;
    }
  }

  // Litigation history summary
  if (civilCases > 0) {
    facts.push({
      source_id: source.id,
      fact_type: "litigation_history",
      value: {
        value: civilCases,
        unit: "cases",
      } as NumericValue,
      confidence: 0.7,
      extracted_by: "rule",
      extraction_path: "$.results.civil_count",
    });
  }

  return facts;
}

/**
 * Extract facts from state corporate registry data.
 */
function extractCorporateRegistryFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as Record<string, unknown>;

  // Corporate registry formats vary by state
  // Look for common fields
  const entities = (content?.results ?? content?.entities) as Array<Record<string, unknown>> | undefined;

  if (!entities || !Array.isArray(entities)) {
    return facts;
  }

  for (const entity of entities.slice(0, 10)) {
    const entityName = String(entity.name ?? entity.entityName ?? entity.business_name ?? "");
    const status = String(entity.status ?? entity.entityStatus ?? "");
    const formed = String(entity.formation_date ?? entity.dateFormed ?? entity.date_of_formation ?? "");

    if (!entityName) continue;

    facts.push({
      source_id: source.id,
      fact_type: "prior_entity",
      value: {
        text: entityName,
        category: `corp_registry_${status.toLowerCase().replace(/\s+/g, "_")}`,
      } as TextValue,
      confidence: 0.8,
      extracted_by: "rule",
      extraction_path: `$.results[name=${entityName}]`,
      as_of_date: formed || undefined,
    });

    // Calculate years of operation for active entities
    if (status.toLowerCase().includes("active") && formed) {
      const formDate = new Date(formed);
      if (!isNaN(formDate.getTime())) {
        const yearsOperating = Math.floor((Date.now() - formDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));

        facts.push({
          source_id: source.id,
          fact_type: "years_experience",
          value: {
            value: yearsOperating,
            unit: "years",
          } as NumericValue,
          confidence: 0.75,
          extracted_by: "rule",
          extraction_path: `$.results[name=${entityName}].derived_years`,
        });
      }
    }
  }

  return facts;
}

// ============================================================================
// Lender Fit Fact Extractors (Phase 6)
// ============================================================================

/**
 * Extract facts from SBA loan program data.
 */
function extractSbaLoanProgramFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const sourceName = source.source_name;

  // SBA 7(a) program facts
  if (sourceName.includes("7(a)")) {
    facts.push({
      source_id: source.id,
      fact_type: "lender_program",
      value: {
        text: "SBA 7(a) Loan Program",
        category: "federal_guarantee",
      } as TextValue,
      confidence: 0.9,
      extracted_by: "rule",
      extraction_path: "$.program_type",
    });

    facts.push({
      source_id: source.id,
      fact_type: "term_limit",
      value: {
        value: 25,
        unit: "years (max, real estate)",
      } as NumericValue,
      confidence: 0.85,
      extracted_by: "rule",
      extraction_path: "$.terms.max_term",
    });

    facts.push({
      source_id: source.id,
      fact_type: "size_standard_threshold",
      value: {
        text: "Must meet SBA size standards for industry",
        category: "eligibility",
      } as TextValue,
      confidence: 0.9,
      extracted_by: "rule",
      extraction_path: "$.eligibility.size",
    });
  }

  // SBA 504 program facts
  if (sourceName.includes("504")) {
    facts.push({
      source_id: source.id,
      fact_type: "lender_program",
      value: {
        text: "SBA 504 Loan Program",
        category: "fixed_asset_financing",
      } as TextValue,
      confidence: 0.9,
      extracted_by: "rule",
      extraction_path: "$.program_type",
    });

    facts.push({
      source_id: source.id,
      fact_type: "collateral_requirement",
      value: {
        text: "Fixed assets (real estate, equipment) - 10% equity injection typical",
        category: "sba_504",
      } as TextValue,
      confidence: 0.85,
      extracted_by: "rule",
      extraction_path: "$.collateral.requirements",
    });
  }

  // SBA Surety Bond program
  if (sourceName.includes("surety") || sourceName.includes("bond")) {
    facts.push({
      source_id: source.id,
      fact_type: "lender_program",
      value: {
        text: "SBA Surety Bond Guarantee Program",
        category: "construction_bonding",
      } as TextValue,
      confidence: 0.85,
      extracted_by: "rule",
      extraction_path: "$.program_type",
    });
  }

  return facts;
}

/**
 * Extract facts from USDA Rural Development programs.
 */
function extractUsdaRuralFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  if (source.source_name.includes("Business & Industry") || source.source_name.includes("B&I")) {
    facts.push({
      source_id: source.id,
      fact_type: "lender_program",
      value: {
        text: "USDA Business & Industry Loan Guarantee",
        category: "rural_development",
      } as TextValue,
      confidence: 0.9,
      extracted_by: "rule",
      extraction_path: "$.program_type",
    });

    facts.push({
      source_id: source.id,
      fact_type: "geographic_restriction",
      value: {
        text: "Must be located in eligible rural area (population < 50,000)",
        category: "usda_rural",
      } as TextValue,
      confidence: 0.85,
      extracted_by: "rule",
      extraction_path: "$.eligibility.geography",
    });

    facts.push({
      source_id: source.id,
      fact_type: "term_limit",
      value: {
        value: 30,
        unit: "years (max, real estate)",
      } as NumericValue,
      confidence: 0.85,
      extracted_by: "rule",
      extraction_path: "$.terms.max_term",
    });
  }

  if (source.source_name.includes("Eligibility")) {
    facts.push({
      source_id: source.id,
      fact_type: "program_eligibility",
      value: {
        text: "USDA rural eligibility verification available",
        category: "geographic_check",
      } as TextValue,
      confidence: 0.7,
      extracted_by: "rule",
      extraction_path: "$.eligibility_check",
    });
  }

  return facts;
}

/**
 * Extract facts from CDFI Fund programs.
 */
function extractCdfiFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  facts.push({
    source_id: source.id,
    fact_type: "lender_program",
    value: {
      text: "CDFI Fund Programs",
      category: "community_development",
    } as TextValue,
    confidence: 0.85,
    extracted_by: "rule",
    extraction_path: "$.program_type",
  });

  facts.push({
    source_id: source.id,
    fact_type: "program_eligibility",
    value: {
      text: "Target underserved communities - low-income, rural, minority populations",
      category: "cdfi_mission",
    } as TextValue,
    confidence: 0.8,
    extracted_by: "rule",
    extraction_path: "$.eligibility.target_markets",
  });

  return facts;
}

/**
 * Extract facts from Treasury SSBCI program.
 */
function extractSsbciFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  facts.push({
    source_id: source.id,
    fact_type: "lender_program",
    value: {
      text: "State Small Business Credit Initiative (SSBCI)",
      category: "state_federal_partnership",
    } as TextValue,
    confidence: 0.85,
    extracted_by: "rule",
    extraction_path: "$.program_type",
  });

  facts.push({
    source_id: source.id,
    fact_type: "program_eligibility",
    value: {
      text: "State-administered programs - varies by state",
      category: "ssbci_structure",
    } as TextValue,
    confidence: 0.75,
    extracted_by: "rule",
    extraction_path: "$.structure",
  });

  return facts;
}

// ============================================================================
// Scenario Stress Fact Extractors (Phase 7)
// ============================================================================

/**
 * Extract facts from FRED economic data.
 */
function extractFredEconomicFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as Record<string, unknown>;

  const observations = content?.observations as Array<Record<string, unknown>> | undefined;

  if (!observations || !Array.isArray(observations) || observations.length === 0) {
    return facts;
  }

  // Get latest observation
  const sorted = [...observations].sort((a, b) => {
    const dateA = String(a.date ?? "");
    const dateB = String(b.date ?? "");
    return dateB.localeCompare(dateA);
  });

  const latest = sorted[0];
  const latestValue = parseFloat(String(latest.value ?? ""));
  const latestDate = String(latest.date ?? "");

  if (isNaN(latestValue)) return facts;

  // Determine what type of data this is based on source name
  const sourceName = source.source_name.toLowerCase();

  if (sourceName.includes("interest") || sourceName.includes("fed fund")) {
    facts.push({
      source_id: source.id,
      fact_type: "interest_rate_sensitivity",
      value: {
        value: latestValue,
        unit: "percent",
      } as NumericValue,
      confidence: 0.9,
      extracted_by: "rule",
      extraction_path: "$.observations[0].value",
      as_of_date: latestDate,
    });

    // Calculate 1-year change if we have enough data
    const oneYearAgo = sorted.find((obs) => {
      const obsDate = new Date(String(obs.date ?? ""));
      const latDate = new Date(latestDate);
      const diff = (latDate.getTime() - obsDate.getTime()) / (365 * 24 * 60 * 60 * 1000);
      return diff >= 0.9 && diff <= 1.1;
    });

    if (oneYearAgo) {
      const oldValue = parseFloat(String(oneYearAgo.value ?? ""));
      if (!isNaN(oldValue)) {
        const change = latestValue - oldValue;
        facts.push({
          source_id: source.id,
          fact_type: "interest_rate_sensitivity",
          value: {
            text: `${change >= 0 ? "+" : ""}${change.toFixed(2)} bps YoY change`,
            category: "rate_trend",
          } as TextValue,
          confidence: 0.85,
          extracted_by: "rule",
          extraction_path: "$.observations.yoy_calc",
        });
      }
    }
  }

  if (sourceName.includes("gdp")) {
    facts.push({
      source_id: source.id,
      fact_type: "revenue_sensitivity",
      value: {
        value: latestValue,
        unit: "percent (GDP growth)",
      } as NumericValue,
      confidence: 0.85,
      extracted_by: "rule",
      extraction_path: "$.observations[0].value",
      as_of_date: latestDate,
    });
  }

  if (sourceName.includes("unemployment") || sourceName.includes("unrate")) {
    facts.push({
      source_id: source.id,
      fact_type: "margin_sensitivity",
      value: {
        value: latestValue,
        unit: "percent (unemployment)",
      } as NumericValue,
      confidence: 0.85,
      extracted_by: "rule",
      extraction_path: "$.observations[0].value",
      as_of_date: latestDate,
    });
  }

  return facts;
}

/**
 * Extract facts from BLS industry productivity data.
 */
function extractBlsProductivityFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as Record<string, unknown>;

  const results = content?.Results as Record<string, unknown> | undefined;
  const series = results?.series as Array<Record<string, unknown>> | undefined;

  if (!series || !Array.isArray(series) || series.length === 0) {
    return facts;
  }

  const data = series[0]?.data as Array<Record<string, unknown>> | undefined;
  if (!data || !Array.isArray(data) || data.length === 0) {
    return facts;
  }

  // Get latest data point
  const sorted = [...data].sort((a, b) => {
    const yearA = parseInt(String(a.year ?? "0"), 10);
    const yearB = parseInt(String(b.year ?? "0"), 10);
    return yearB - yearA;
  });

  const latest = sorted[0];
  const latestValue = parseFloat(String(latest.value ?? ""));
  const latestYear = String(latest.year ?? "");

  if (!isNaN(latestValue)) {
    facts.push({
      source_id: source.id,
      fact_type: "margin_sensitivity",
      value: {
        value: latestValue,
        unit: "productivity index",
        year: parseInt(latestYear, 10),
      } as NumericValue,
      confidence: 0.8,
      extracted_by: "rule",
      extraction_path: "$.Results.series[0].data[0]",
      as_of_date: `${latestYear}-12-31`,
    });
  }

  return facts;
}

/**
 * Extract facts from Census business formation statistics.
 */
function extractBusinessFormationFacts(source: ResearchSource): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const content = source.raw_content as unknown;

  if (!Array.isArray(content) || content.length < 2) {
    return facts;
  }

  const headers = content[0] as string[];
  const rows = content.slice(1) as string[][];

  // Find relevant columns
  const valueIdx = headers.indexOf("cell_value");
  const timeIdx = headers.indexOf("time_slot_id");
  const typeIdx = headers.indexOf("data_type_code");

  if (valueIdx < 0 || rows.length === 0) {
    return facts;
  }

  // Get the most recent business formation data
  const latestRow = rows[rows.length - 1];
  const value = parseFloat(latestRow[valueIdx] ?? "");

  if (!isNaN(value)) {
    facts.push({
      source_id: source.id,
      fact_type: "revenue_sensitivity",
      value: {
        text: `Business formation index: ${value}`,
        category: "economic_indicator",
      } as TextValue,
      confidence: 0.75,
      extracted_by: "rule",
      extraction_path: "$.cell_value",
    });
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
  } else if (sourceName.includes("edgar") && (sourceName.includes("management") || sourceName.includes("full-text"))) {
    // Management-focused EDGAR search
    facts = extractEdgarManagementFacts(source);
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
  // Regulatory extractors (Phase 3)
  else if (sourceName.includes("federal register")) {
    facts = extractFederalRegisterFacts(source);
  } else if (sourceName.includes("osha")) {
    facts = extractOshaEnforcementFacts(source);
  } else if (sourceName.includes("epa") && (sourceName.includes("enforcement") || sourceName.includes("echo"))) {
    facts = extractEpaEchoFacts(source);
  } else if (sourceName.includes("sba") && (sourceName.includes("size") || sourceName.includes("naics"))) {
    facts = extractSbaSizeStandardsFacts(source);
  } else if (sourceName.includes("state licensing")) {
    facts = extractStateLicensingFacts(source);
  }
  // Management extractors (Phase 4)
  else if (sourceName.includes("ofac") || sourceName.includes("sdn")) {
    facts = extractOfacSanctionsFacts(source);
  } else if (sourceName.includes("sam.gov") || sourceName.includes("exclusions")) {
    facts = extractSamExclusionsFacts(source);
  } else if (sourceName.includes("courtlistener") || sourceName.includes("recap")) {
    facts = extractCourtRecordsFacts(source);
  } else if (sourceName.includes("corporate registry") || sourceName.includes("ucc")) {
    facts = extractCorporateRegistryFacts(source);
  }
  // Lender fit extractors (Phase 6)
  else if (sourceName.includes("sba") && (sourceName.includes("7(a)") || sourceName.includes("504") || sourceName.includes("surety") || sourceName.includes("loan program"))) {
    facts = extractSbaLoanProgramFacts(source);
  } else if (sourceName.includes("usda") || sourceName.includes("rural")) {
    facts = extractUsdaRuralFacts(source);
  } else if (sourceName.includes("cdfi")) {
    facts = extractCdfiFacts(source);
  } else if (sourceName.includes("ssbci") || sourceName.includes("treasury") && sourceName.includes("small business")) {
    facts = extractSsbciFacts(source);
  }
  // Scenario stress extractors (Phase 7)
  else if (sourceName.includes("fred")) {
    facts = extractFredEconomicFacts(source);
  } else if (sourceName.includes("bls") && (sourceName.includes("productivity") || sourceName.includes("price index"))) {
    facts = extractBlsProductivityFacts(source);
  } else if (sourceName.includes("census") && sourceName.includes("business formation")) {
    facts = extractBusinessFormationFacts(source);
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
