/**
 * Industry Intelligence — Official Data Layer
 *
 * Provides structured industry data from official Census/SBA sources.
 * Reads from static generated JSON files (no DB required).
 * Supplements the existing IndustryProfile system with source-cited data.
 *
 * ⚠ SERVER-SIDE ONLY — Do not import this module from client components
 * ("use client" files, CanonicalMemoTemplate.tsx, etc). The underlying
 * JSON data files are ~1MB combined and must not be bundled into client JS.
 * Use server-built memo fields (industry_risk_positioning, etc.) instead.
 *
 * CI test imports are safe (node:test runs server-side).
 *
 * Sources:
 *   - Census NAICS Reference (2022)
 *   - Census County Business Patterns (2021)
 *   - SBA Table of Size Standards (March 2023)
 */

// ─── Types ─────────────────────────────────────────────────────────────────

type NaicsRefEntry = {
  code: string;
  title: string;
  level: string;
  sector_code: string;
  sector_title: string;
};

type CbpRefEntry = {
  naics: string;
  establishments: number | null;
  employment: number | null;
  annual_payroll_thousands: number | null;
  avg_payroll_per_employee: number | null;
};

type SbaRefEntry = {
  naics_code: string;
  naics_title: string;
  size_standard: string;
  size_standard_type: "revenue" | "employees" | "other";
  size_standard_value: number | null;
  size_standard_unit: string;
};

type DataFile<T> = {
  source_name: string;
  source_url: string;
  source_vintage: string;
  row_count: number;
  entries: T[];
};

// ─── Lazy-load + index ─────────────────────────────────────────────────────

let _naicsIdx: Map<string, NaicsRefEntry> | null = null;
let _cbpIdx: Map<string, CbpRefEntry> | null = null;
let _sbaIdx: Map<string, SbaRefEntry> | null = null;
let _naicsMeta: { source_vintage: string } | null = null;
let _cbpMeta: { source_vintage: string } | null = null;
let _sbaMeta: { source_vintage: string } | null = null;

function loadIndex<T>(
  path: string,
  keyFn: (e: T) => string,
): { idx: Map<string, T>; meta: { source_vintage: string } } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const data: DataFile<T> = require(path);
    return {
      idx: new Map(data.entries.map((e) => [keyFn(e), e])),
      meta: { source_vintage: data.source_vintage },
    };
  } catch {
    return { idx: new Map(), meta: { source_vintage: "unavailable" } };
  }
}

function naicsIndex() {
  if (!_naicsIdx) {
    const r = loadIndex<NaicsRefEntry>("../../../data/industry-intelligence/naics-reference.json", (e) => e.code);
    _naicsIdx = r.idx;
    _naicsMeta = r.meta;
  }
  return _naicsIdx;
}

function cbpIndex() {
  if (!_cbpIdx) {
    const r = loadIndex<CbpRefEntry>("../../../data/industry-intelligence/cbp-national.json", (e) => e.naics);
    _cbpIdx = r.idx;
    _cbpMeta = r.meta;
  }
  return _cbpIdx;
}

function sbaIndex() {
  if (!_sbaIdx) {
    try {
      const data: DataFile<SbaRefEntry> = require("../../../data/industry-intelligence/sba-size-standards.json");
      // Prefer entries with actual size_standard values over empty duplicates
      const idx = new Map<string, SbaRefEntry>();
      for (const entry of data.entries) {
        const existing = idx.get(entry.naics_code);
        if (!existing || (entry.size_standard_value !== null && existing.size_standard_value === null)) {
          idx.set(entry.naics_code, entry);
        }
      }
      _sbaIdx = idx;
      _sbaMeta = { source_vintage: data.source_vintage };
    } catch {
      _sbaIdx = new Map();
      _sbaMeta = { source_vintage: "unavailable" };
    }
  }
  return _sbaIdx;
}

// ─── Public API ────────────────────────────────────────────────────────────

export type NaicsProfile = {
  code: string;
  title: string;
  sector: string;
  sector_code: string;
  source: string;
};

export function getNaicsProfile(naicsCode: string): NaicsProfile | null {
  const entry = naicsIndex().get(naicsCode);
  if (!entry) return null;
  return {
    code: entry.code,
    title: entry.title,
    sector: entry.sector_title,
    sector_code: entry.sector_code,
    source: `Census NAICS ${_naicsMeta?.source_vintage ?? ""}`,
  };
}

export type OfficialSbaSizeStandard = {
  naics_code: string;
  title: string;
  size_standard_display: string;
  size_standard_value: number | null;
  size_standard_type: "revenue" | "employees" | "other";
  source: string;
};

export function getSbaSizeStandard(naicsCode: string): OfficialSbaSizeStandard | null {
  const entry = sbaIndex().get(naicsCode);
  if (!entry) return null;
  let display = entry.size_standard;
  if (entry.size_standard_type === "revenue" && entry.size_standard_value) {
    display = `$${(entry.size_standard_value / 1_000_000).toFixed(1)} million annual revenue`;
  } else if (entry.size_standard_type === "employees" && entry.size_standard_value) {
    display = `${entry.size_standard_value.toLocaleString()} employees`;
  }
  return {
    naics_code: entry.naics_code,
    title: entry.naics_title,
    size_standard_display: display,
    size_standard_value: entry.size_standard_value,
    size_standard_type: entry.size_standard_type,
    source: `SBA Size Standards ${_sbaMeta?.source_vintage ?? ""}`,
  };
}

export type IndustryFootprint = {
  naics_code: string;
  establishments: number | null;
  employment: number | null;
  annual_payroll_thousands: number | null;
  avg_payroll_per_employee: number | null;
  source: string;
};

export function getIndustryFootprint(naicsCode: string): IndustryFootprint | null {
  const entry = cbpIndex().get(naicsCode);
  if (!entry) return null;
  return {
    naics_code: entry.naics,
    establishments: entry.establishments,
    employment: entry.employment,
    annual_payroll_thousands: entry.annual_payroll_thousands,
    avg_payroll_per_employee: entry.avg_payroll_per_employee,
    source: `Census CBP ${_cbpMeta?.source_vintage ?? ""}`,
  };
}

// ─── Composite ─────────────────────────────────────────────────────────────

export type IndustryIntelligenceSummary = {
  naics: NaicsProfile | null;
  sba: OfficialSbaSizeStandard | null;
  footprint: IndustryFootprint | null;
  sources: string[];
};

export function buildIndustryIntelligenceSummary(naicsCode: string): IndustryIntelligenceSummary {
  const naics = getNaicsProfile(naicsCode);
  const sba = getSbaSizeStandard(naicsCode);
  const footprint = getIndustryFootprint(naicsCode);
  const sources: string[] = [];
  if (naics) sources.push(naics.source);
  if (sba?.size_standard_display) sources.push(sba.source);
  if (footprint) sources.push(footprint.source);
  return { naics, sba, footprint, sources };
}

/**
 * Build a human-readable industry context paragraph for credit memos.
 */
export function buildIndustryContextNarrative(naicsCode: string): string | null {
  const intel = buildIndustryIntelligenceSummary(naicsCode);
  if (!intel.naics) return null;

  const parts: string[] = [];
  parts.push(`NAICS ${intel.naics.code}: ${intel.naics.title}. Sector: ${intel.naics.sector}.`);

  if (intel.footprint) {
    const fp = intel.footprint;
    const segs: string[] = [];
    if (fp.establishments !== null) segs.push(`${fp.establishments.toLocaleString()} establishments`);
    if (fp.employment !== null) segs.push(`${fp.employment.toLocaleString()} employees`);
    if (fp.avg_payroll_per_employee !== null) segs.push(`avg payroll $${Math.round(fp.avg_payroll_per_employee / 1000)}K/employee`);
    if (segs.length > 0) parts.push(`National footprint: ${segs.join(", ")} (${fp.source}).`);
  }

  if (intel.sba?.size_standard_display) {
    parts.push(`SBA size standard: ${intel.sba.size_standard_display} (${intel.sba.source}).`);
  }

  return parts.join(" ");
}
