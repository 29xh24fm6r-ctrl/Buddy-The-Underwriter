/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 17: Portfolio Intelligence Layer.
 *
 * Rolls loan-level intelligence into portfolio intelligence: concentration
 * (industry / geography / officer / guarantor / collateral), risk & watchlist
 * migration, criticized/classified exposure, vintage analysis, and CECL input
 * hooks. Pure calculations only — no dashboard, no writes, no flags.
 */

export type Classification = "pass" | "special_mention" | "substandard" | "doubtful" | "loss";

export type LoanRecord = {
  loanId: string;
  exposure: number;
  industrySector?: string;
  geography?: string;
  officer?: string;
  guarantorId?: string;
  collateralType?: string;
  /** Numeric risk grade (lower = better; e.g. 1..9). */
  riskRating?: number;
  priorRiskRating?: number;
  watchlist?: boolean;
  priorWatchlist?: boolean;
  classification?: Classification;
  /** Origination year, e.g. "2024". */
  vintage?: string;
};

export type ConcentrationBucket = {
  key: string;
  exposure: number;
  pct: number;
  count: number;
};

export type ConcentrationReport = {
  total: number;
  buckets: ConcentrationBucket[];
  /** Herfindahl-Hirschman Index of exposure shares (0..1). */
  hhi: number;
  /** Largest single bucket share. */
  top: number;
};

function concentrationBy(loans: LoanRecord[], keyFn: (l: LoanRecord) => string | undefined): ConcentrationReport {
  const total = loans.reduce((s, l) => s + l.exposure, 0);
  const byKey = new Map<string, { exposure: number; count: number }>();
  for (const l of loans) {
    const key = keyFn(l) ?? "UNKNOWN";
    const cur = byKey.get(key) ?? { exposure: 0, count: 0 };
    cur.exposure += l.exposure;
    cur.count += 1;
    byKey.set(key, cur);
  }
  const buckets: ConcentrationBucket[] = [...byKey.entries()]
    .map(([key, v]) => ({ key, exposure: v.exposure, count: v.count, pct: total > 0 ? v.exposure / total : 0 }))
    .sort((a, b) => b.exposure - a.exposure);
  const hhi = buckets.reduce((s, b) => s + b.pct * b.pct, 0);
  return { total, buckets, hhi, top: buckets[0]?.pct ?? 0 };
}

export const industryConcentration = (loans: LoanRecord[]) => concentrationBy(loans, (l) => l.industrySector);
export const geographyConcentration = (loans: LoanRecord[]) => concentrationBy(loans, (l) => l.geography);
export const officerConcentration = (loans: LoanRecord[]) => concentrationBy(loans, (l) => l.officer);
export const guarantorConcentration = (loans: LoanRecord[]) => concentrationBy(loans, (l) => l.guarantorId);
export const collateralConcentration = (loans: LoanRecord[]) => concentrationBy(loans, (l) => l.collateralType);

// ── Migration ─────────────────────────────────────────────────────────────────

export type RiskMigration = {
  upgraded: number;
  downgraded: number;
  stable: number;
  /** Exposure that moved to a worse grade. */
  downgradedExposure: number;
  /** Net rating change (sum of newRating − priorRating). Positive = deterioration. */
  netGradeChange: number;
};

export function riskMigration(loans: LoanRecord[]): RiskMigration {
  let upgraded = 0;
  let downgraded = 0;
  let stable = 0;
  let downgradedExposure = 0;
  let netGradeChange = 0;
  for (const l of loans) {
    if (l.riskRating == null || l.priorRiskRating == null) continue;
    const delta = l.riskRating - l.priorRiskRating;
    netGradeChange += delta;
    if (delta > 0) {
      downgraded += 1; // higher grade = worse
      downgradedExposure += l.exposure;
    } else if (delta < 0) {
      upgraded += 1;
    } else {
      stable += 1;
    }
  }
  return { upgraded, downgraded, stable, downgradedExposure, netGradeChange };
}

export type WatchlistMigration = {
  entered: number;
  exited: number;
  enteredExposure: number;
};

export function watchlistMigration(loans: LoanRecord[]): WatchlistMigration {
  let entered = 0;
  let exited = 0;
  let enteredExposure = 0;
  for (const l of loans) {
    if (l.watchlist === true && l.priorWatchlist === false) {
      entered += 1;
      enteredExposure += l.exposure;
    } else if (l.watchlist === false && l.priorWatchlist === true) {
      exited += 1;
    }
  }
  return { entered, exited, enteredExposure };
}

// ── Criticized / classified ───────────────────────────────────────────────────

const CRITICIZED: ReadonlySet<Classification> = new Set(["special_mention", "substandard", "doubtful", "loss"]);
const CLASSIFIED: ReadonlySet<Classification> = new Set(["substandard", "doubtful", "loss"]);

export type CriticizedClassifiedReport = {
  total: number;
  criticizedExposure: number;
  classifiedExposure: number;
  criticizedPct: number;
  classifiedPct: number;
  byClassification: Record<Classification, number>;
};

export function criticizedClassifiedExposure(loans: LoanRecord[]): CriticizedClassifiedReport {
  const total = loans.reduce((s, l) => s + l.exposure, 0);
  const byClassification: Record<Classification, number> = {
    pass: 0,
    special_mention: 0,
    substandard: 0,
    doubtful: 0,
    loss: 0,
  };
  let criticizedExposure = 0;
  let classifiedExposure = 0;
  for (const l of loans) {
    const c = l.classification ?? "pass";
    byClassification[c] += l.exposure;
    if (CRITICIZED.has(c)) criticizedExposure += l.exposure;
    if (CLASSIFIED.has(c)) classifiedExposure += l.exposure;
  }
  return {
    total,
    criticizedExposure,
    classifiedExposure,
    criticizedPct: total > 0 ? criticizedExposure / total : 0,
    classifiedPct: total > 0 ? classifiedExposure / total : 0,
    byClassification,
  };
}

// ── Vintage + CECL hooks ──────────────────────────────────────────────────────

export type VintageBucket = { vintage: string; exposure: number; criticizedExposure: number; criticizedPct: number };

export function vintageAnalysis(loans: LoanRecord[]): VintageBucket[] {
  const byVintage = new Map<string, { exposure: number; criticized: number }>();
  for (const l of loans) {
    const v = l.vintage ?? "UNKNOWN";
    const cur = byVintage.get(v) ?? { exposure: 0, criticized: 0 };
    cur.exposure += l.exposure;
    if (l.classification && CRITICIZED.has(l.classification)) cur.criticized += l.exposure;
    byVintage.set(v, cur);
  }
  return [...byVintage.entries()]
    .map(([vintage, v]) => ({
      vintage,
      exposure: v.exposure,
      criticizedExposure: v.criticized,
      criticizedPct: v.exposure > 0 ? v.criticized / v.exposure : 0,
    }))
    .sort((a, b) => a.vintage.localeCompare(b.vintage));
}

export type CeclSegmentInput = {
  segment: string;
  exposure: number;
  /** Exposure-weighted average risk rating for the segment. */
  weightedRiskRating: number | null;
  loanCount: number;
};

/** CECL input hook: segments portfolio by industry with exposure + weighted risk. */
export function ceclInputs(loans: LoanRecord[]): CeclSegmentInput[] {
  const bySegment = new Map<string, { exposure: number; weighted: number; ratedExposure: number; count: number }>();
  for (const l of loans) {
    const seg = l.industrySector ?? "UNSEGMENTED";
    const cur = bySegment.get(seg) ?? { exposure: 0, weighted: 0, ratedExposure: 0, count: 0 };
    cur.exposure += l.exposure;
    cur.count += 1;
    if (l.riskRating != null) {
      cur.weighted += l.riskRating * l.exposure;
      cur.ratedExposure += l.exposure;
    }
    bySegment.set(seg, cur);
  }
  return [...bySegment.entries()].map(([segment, v]) => ({
    segment,
    exposure: v.exposure,
    weightedRiskRating: v.ratedExposure > 0 ? v.weighted / v.ratedExposure : null,
    loanCount: v.count,
  }));
}

// ── Summary ───────────────────────────────────────────────────────────────────

export type PortfolioSummary = {
  totalExposure: number;
  loanCount: number;
  industry: ConcentrationReport;
  criticized: CriticizedClassifiedReport;
  riskMigration: RiskMigration;
  watchlistMigration: WatchlistMigration;
};

export function summarizePortfolio(loans: LoanRecord[]): PortfolioSummary {
  return {
    totalExposure: loans.reduce((s, l) => s + l.exposure, 0),
    loanCount: loans.length,
    industry: industryConcentration(loans),
    criticized: criticizedClassifiedExposure(loans),
    riskMigration: riskMigration(loans),
    watchlistMigration: watchlistMigration(loans),
  };
}
