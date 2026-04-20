// src/lib/sba/sbaAssumptionBenchmarks.ts
// Phase BPG — NAICS-benchmarked assumption validation.
// Pure function. Checks borrower assumptions (growth rates, COGS %, DSO,
// DPO, fixed cost escalation) against industry median benchmarks for the
// top SBA NAICS codes. Returns advisory warnings — never blocks generation.

import type { SBAAssumptions } from "./sbaReadinessTypes";

export type BenchmarkSeverity = "info" | "warning" | "concern";

export interface BenchmarkWarning {
  field: string;
  severity: BenchmarkSeverity;
  message: string;
  actual: number;
  benchmarkLow: number;
  benchmarkHigh: number;
  naicsCode?: string;
}

interface NAICSBenchmark {
  code: string;
  label: string;
  // All values as decimals (0.05 = 5%).
  revenueGrowthMedian: number;
  revenueGrowthMax: number; // above this = concern
  cogsMedian: number;
  cogsHigh: number; // above this = concern
  dsoMedian: number;
  dsoHigh: number; // above this = concern
  dpoMedian: number;
  fixedCostEscalationMedian: number;
  fixedCostEscalationHigh: number;
}

// Top 20-30 SBA NAICS benchmarks. Values are representative industry medians
// compiled from SBA SOP, RMA Annual Statement Studies, and public filings —
// not borrower-specific. Used for directional advisory only.
const BENCHMARKS: Record<string, NAICSBenchmark> = {
  "722511": { code: "722511", label: "Full-Service Restaurants", revenueGrowthMedian: 0.04, revenueGrowthMax: 0.20, cogsMedian: 0.32, cogsHigh: 0.40, dsoMedian: 2, dsoHigh: 10, dpoMedian: 14, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
  "722513": { code: "722513", label: "Limited-Service Restaurants", revenueGrowthMedian: 0.05, revenueGrowthMax: 0.25, cogsMedian: 0.30, cogsHigh: 0.38, dsoMedian: 1, dsoHigh: 7, dpoMedian: 10, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
  "722515": { code: "722515", label: "Snack & Non-Alcoholic Bev Bars", revenueGrowthMedian: 0.06, revenueGrowthMax: 0.30, cogsMedian: 0.28, cogsHigh: 0.36, dsoMedian: 1, dsoHigh: 5, dpoMedian: 10, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
  "236220": { code: "236220", label: "Commercial Building Construction", revenueGrowthMedian: 0.05, revenueGrowthMax: 0.30, cogsMedian: 0.72, cogsHigh: 0.82, dsoMedian: 55, dsoHigh: 90, dpoMedian: 45, fixedCostEscalationMedian: 0.04, fixedCostEscalationHigh: 0.08 },
  "236115": { code: "236115", label: "New Single-Family Housing Const", revenueGrowthMedian: 0.05, revenueGrowthMax: 0.30, cogsMedian: 0.75, cogsHigh: 0.85, dsoMedian: 45, dsoHigh: 80, dpoMedian: 40, fixedCostEscalationMedian: 0.04, fixedCostEscalationHigh: 0.08 },
  "236118": { code: "236118", label: "Residential Remodelers", revenueGrowthMedian: 0.05, revenueGrowthMax: 0.30, cogsMedian: 0.70, cogsHigh: 0.80, dsoMedian: 40, dsoHigh: 75, dpoMedian: 35, fixedCostEscalationMedian: 0.04, fixedCostEscalationHigh: 0.08 },
  "238220": { code: "238220", label: "Plumbing/Heating/AC Contractors", revenueGrowthMedian: 0.06, revenueGrowthMax: 0.30, cogsMedian: 0.58, cogsHigh: 0.70, dsoMedian: 45, dsoHigh: 75, dpoMedian: 40, fixedCostEscalationMedian: 0.04, fixedCostEscalationHigh: 0.07 },
  "238910": { code: "238910", label: "Site Preparation Contractors", revenueGrowthMedian: 0.04, revenueGrowthMax: 0.25, cogsMedian: 0.65, cogsHigh: 0.78, dsoMedian: 50, dsoHigh: 85, dpoMedian: 35, fixedCostEscalationMedian: 0.04, fixedCostEscalationHigh: 0.07 },
  "541511": { code: "541511", label: "Custom Computer Programming", revenueGrowthMedian: 0.10, revenueGrowthMax: 0.40, cogsMedian: 0.55, cogsHigh: 0.70, dsoMedian: 55, dsoHigh: 90, dpoMedian: 20, fixedCostEscalationMedian: 0.04, fixedCostEscalationHigh: 0.08 },
  "541330": { code: "541330", label: "Engineering Services", revenueGrowthMedian: 0.06, revenueGrowthMax: 0.30, cogsMedian: 0.58, cogsHigh: 0.72, dsoMedian: 60, dsoHigh: 90, dpoMedian: 25, fixedCostEscalationMedian: 0.04, fixedCostEscalationHigh: 0.07 },
  "531210": { code: "531210", label: "Real Estate Agents & Brokers", revenueGrowthMedian: 0.05, revenueGrowthMax: 0.25, cogsMedian: 0.40, cogsHigh: 0.55, dsoMedian: 10, dsoHigh: 30, dpoMedian: 15, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
  "621111": { code: "621111", label: "Offices of Physicians", revenueGrowthMedian: 0.04, revenueGrowthMax: 0.20, cogsMedian: 0.25, cogsHigh: 0.38, dsoMedian: 45, dsoHigh: 75, dpoMedian: 25, fixedCostEscalationMedian: 0.04, fixedCostEscalationHigh: 0.07 },
  "621210": { code: "621210", label: "Offices of Dentists", revenueGrowthMedian: 0.04, revenueGrowthMax: 0.22, cogsMedian: 0.18, cogsHigh: 0.30, dsoMedian: 25, dsoHigh: 55, dpoMedian: 20, fixedCostEscalationMedian: 0.04, fixedCostEscalationHigh: 0.07 },
  "524210": { code: "524210", label: "Insurance Agencies & Brokerages", revenueGrowthMedian: 0.05, revenueGrowthMax: 0.25, cogsMedian: 0.20, cogsHigh: 0.35, dsoMedian: 15, dsoHigh: 45, dpoMedian: 15, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
  "561730": { code: "561730", label: "Landscaping Services", revenueGrowthMedian: 0.05, revenueGrowthMax: 0.30, cogsMedian: 0.55, cogsHigh: 0.70, dsoMedian: 25, dsoHigh: 55, dpoMedian: 20, fixedCostEscalationMedian: 0.04, fixedCostEscalationHigh: 0.07 },
  "561320": { code: "561320", label: "Temporary Help Services", revenueGrowthMedian: 0.06, revenueGrowthMax: 0.30, cogsMedian: 0.78, cogsHigh: 0.88, dsoMedian: 45, dsoHigh: 75, dpoMedian: 15, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
  "811111": { code: "811111", label: "General Automotive Repair", revenueGrowthMedian: 0.03, revenueGrowthMax: 0.20, cogsMedian: 0.45, cogsHigh: 0.58, dsoMedian: 3, dsoHigh: 15, dpoMedian: 15, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
  "812111": { code: "812111", label: "Barber Shops", revenueGrowthMedian: 0.03, revenueGrowthMax: 0.18, cogsMedian: 0.15, cogsHigh: 0.25, dsoMedian: 0, dsoHigh: 5, dpoMedian: 10, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
  "453110": { code: "453110", label: "Florists", revenueGrowthMedian: 0.02, revenueGrowthMax: 0.18, cogsMedian: 0.52, cogsHigh: 0.65, dsoMedian: 3, dsoHigh: 12, dpoMedian: 15, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
  "448140": { code: "448140", label: "Family Clothing Stores", revenueGrowthMedian: 0.03, revenueGrowthMax: 0.20, cogsMedian: 0.55, cogsHigh: 0.68, dsoMedian: 1, dsoHigh: 5, dpoMedian: 20, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
  "423450": { code: "423450", label: "Medical Equip Wholesalers", revenueGrowthMedian: 0.05, revenueGrowthMax: 0.25, cogsMedian: 0.68, cogsHigh: 0.80, dsoMedian: 50, dsoHigh: 80, dpoMedian: 30, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
  "713940": { code: "713940", label: "Fitness & Recreational Sports", revenueGrowthMedian: 0.05, revenueGrowthMax: 0.28, cogsMedian: 0.30, cogsHigh: 0.45, dsoMedian: 1, dsoHigh: 5, dpoMedian: 15, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
  "445110": { code: "445110", label: "Supermarkets & Grocery Stores", revenueGrowthMedian: 0.03, revenueGrowthMax: 0.18, cogsMedian: 0.72, cogsHigh: 0.82, dsoMedian: 2, dsoHigh: 8, dpoMedian: 18, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
  "523930": { code: "523930", label: "Investment Advice", revenueGrowthMedian: 0.08, revenueGrowthMax: 0.35, cogsMedian: 0.15, cogsHigh: 0.30, dsoMedian: 20, dsoHigh: 50, dpoMedian: 15, fixedCostEscalationMedian: 0.04, fixedCostEscalationHigh: 0.07 },
  "532120": { code: "532120", label: "Truck/RV/Trailer Rental", revenueGrowthMedian: 0.05, revenueGrowthMax: 0.25, cogsMedian: 0.50, cogsHigh: 0.65, dsoMedian: 15, dsoHigh: 40, dpoMedian: 20, fixedCostEscalationMedian: 0.03, fixedCostEscalationHigh: 0.06 },
};

function findBenchmark(naics: string | null | undefined): NAICSBenchmark | null {
  if (!naics) return null;
  if (BENCHMARKS[naics]) return BENCHMARKS[naics];
  // Try 5-digit parent
  const five = naics.slice(0, 5);
  for (const code of Object.keys(BENCHMARKS)) {
    if (code.startsWith(five)) return BENCHMARKS[code];
  }
  return null;
}

export function validateAgainstBenchmarks(
  assumptions: SBAAssumptions,
  naicsCode: string | null | undefined,
): BenchmarkWarning[] {
  const warnings: BenchmarkWarning[] = [];
  const bench = findBenchmark(naicsCode);

  // Growth rates per-stream (year 1 used; year 2/3 flagged if >40% any year)
  for (const stream of assumptions.revenueStreams ?? []) {
    const growths = [
      { year: 1, val: stream.growthRateYear1 },
      { year: 2, val: stream.growthRateYear2 },
      { year: 3, val: stream.growthRateYear3 },
    ];
    for (const g of growths) {
      if (bench && g.val > bench.revenueGrowthMax) {
        warnings.push({
          field: `revenueStreams[${stream.id}].growthRateYear${g.year}`,
          severity: "concern",
          message: `${stream.name} year ${g.year} growth (${(g.val * 100).toFixed(0)}%) exceeds industry median (${(bench.revenueGrowthMedian * 100).toFixed(0)}%) and max (${(bench.revenueGrowthMax * 100).toFixed(0)}%) for NAICS ${bench.code} (${bench.label}).`,
          actual: g.val,
          benchmarkLow: 0,
          benchmarkHigh: bench.revenueGrowthMax,
          naicsCode: bench.code,
        });
      } else if (g.val > 0.4) {
        warnings.push({
          field: `revenueStreams[${stream.id}].growthRateYear${g.year}`,
          severity: "warning",
          message: `${stream.name} year ${g.year} growth of ${(g.val * 100).toFixed(0)}% is aggressive and may require additional justification.`,
          actual: g.val,
          benchmarkLow: 0,
          benchmarkHigh: 0.4,
        });
      }
    }
  }

  // COGS year 1
  const cogsY1 = assumptions.costAssumptions?.cogsPercentYear1 ?? 0;
  if (bench && cogsY1 > bench.cogsHigh) {
    warnings.push({
      field: "costAssumptions.cogsPercentYear1",
      severity: "concern",
      message: `Year 1 COGS of ${(cogsY1 * 100).toFixed(0)}% exceeds industry high of ${(bench.cogsHigh * 100).toFixed(0)}% for ${bench.label}. Margins may be underestimated.`,
      actual: cogsY1,
      benchmarkLow: 0,
      benchmarkHigh: bench.cogsHigh,
      naicsCode: bench.code,
    });
  } else if (cogsY1 > 0.85) {
    warnings.push({
      field: "costAssumptions.cogsPercentYear1",
      severity: "concern",
      message: `COGS at ${(cogsY1 * 100).toFixed(0)}% of revenue leaves very thin gross margin for debt service.`,
      actual: cogsY1,
      benchmarkLow: 0,
      benchmarkHigh: 0.85,
    });
  }

  // DSO
  const dso = assumptions.workingCapital?.targetDSO ?? 0;
  if (bench && dso > bench.dsoHigh) {
    warnings.push({
      field: "workingCapital.targetDSO",
      severity: "warning",
      message: `DSO of ${dso} days is above industry high of ${bench.dsoHigh} days for ${bench.label}. Consider tighter collection assumptions.`,
      actual: dso,
      benchmarkLow: 0,
      benchmarkHigh: bench.dsoHigh,
      naicsCode: bench.code,
    });
  } else if (dso > 90) {
    warnings.push({
      field: "workingCapital.targetDSO",
      severity: "warning",
      message: `DSO of ${dso} days exceeds 90 — receivables will tie up significant working capital.`,
      actual: dso,
      benchmarkLow: 0,
      benchmarkHigh: 90,
    });
  }

  // DPO sanity (very low or very high both interesting)
  const dpo = assumptions.workingCapital?.targetDPO ?? 0;
  if (bench && dpo < Math.max(5, bench.dpoMedian - 15)) {
    warnings.push({
      field: "workingCapital.targetDPO",
      severity: "info",
      message: `DPO of ${dpo} days is below typical ${bench.dpoMedian} days for ${bench.label}. Paying suppliers early uses cash that could support operations.`,
      actual: dpo,
      benchmarkLow: Math.max(5, bench.dpoMedian - 15),
      benchmarkHigh: bench.dpoMedian + 15,
      naicsCode: bench.code,
    });
  }

  // Fixed cost escalation
  for (const fc of assumptions.costAssumptions?.fixedCostCategories ?? []) {
    if (bench && fc.escalationPctPerYear > bench.fixedCostEscalationHigh) {
      warnings.push({
        field: `costAssumptions.fixedCostCategories[${fc.name}].escalationPctPerYear`,
        severity: "warning",
        message: `${fc.name} escalation of ${(fc.escalationPctPerYear * 100).toFixed(1)}%/yr exceeds industry high of ${(bench.fixedCostEscalationHigh * 100).toFixed(1)}%.`,
        actual: fc.escalationPctPerYear,
        benchmarkLow: 0,
        benchmarkHigh: bench.fixedCostEscalationHigh,
        naicsCode: bench.code,
      });
    }
  }

  return warnings;
}
