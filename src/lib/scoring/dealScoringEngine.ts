import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export type DealScoreGrade = "A" | "B" | "C" | "D";

export type DealScoreDrivers = {
  positive: string[];
  negative: string[];
};

export type DealScoreResult = {
  score: number;
  grade: DealScoreGrade;
  drivers: DealScoreDrivers;
  confidence: number; // 0..1
};

export type DealScoreInput = {
  snapshot: DealFinancialSnapshotV1;
  decision: {
    stress?: any;
    sba?: { status?: string | null } | null;
  } | null;
  metadata: {
    assetType?: string | null;
    vintage?: number | null;
    leverage?: number | null;
  };
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function gradeFromScore(score: number): DealScoreGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
}

function dscrScore(dscr: number | null): number {
  if (dscr === null || !Number.isFinite(dscr)) return 0;
  if (dscr >= 1.5) return 44;
  if (dscr >= 1.4) return 40;
  if (dscr >= 1.3) return 34;
  if (dscr >= 1.15) return 26;
  if (dscr >= 1.0) return 18;
  return 8;
}

function stressScore(minStress: number | null): number {
  if (minStress === null || !Number.isFinite(minStress)) return 0;
  if (minStress >= 1.2) return 30;
  if (minStress >= 1.1) return 24;
  if (minStress >= 1.0) return 20;
  if (minStress >= 0.9) return 10;
  return 0;
}

function sbaBoost(status: string | null | undefined): number {
  const s = String(status ?? "").toLowerCase();
  if (s === "eligible") return 15;
  if (s === "conditional") return 5;
  if (s === "ineligible") return -10;
  return 0;
}

function volatilityPenalty(base: number | null, minStress: number | null): number {
  if (base === null || minStress === null) return 0;
  const delta = base - minStress;
  if (delta >= 0.4) return 6;
  if (delta >= 0.25) return 4;
  if (delta >= 0.15) return 2;
  return 0;
}

function extractMinStress(stress: any): number | null {
  const list: number[] = [];
  const add = (v: any) => {
    if (typeof v === "number" && Number.isFinite(v)) list.push(v);
  };

  add(stress?.stresses?.vacancyUp?.dscr);
  add(stress?.stresses?.rentDown?.dscr);
  add(stress?.stresses?.rateUp?.dscr);

  if (!list.length) return null;
  return Math.min(...list);
}

export function computeDealScore(input: DealScoreInput): DealScoreResult {
  const dscr = input.snapshot.dscr?.value_num ?? null;
  const minStress = extractMinStress(input.decision?.stress);
  const sbaStatus = input.decision?.sba?.status ?? null;

  const drivers: DealScoreDrivers = { positive: [], negative: [] };

  const dscrPts = dscrScore(dscr);
  if (dscr !== null) {
    if (dscr >= 1.2) drivers.positive.push(`DSCR ${dscr.toFixed(2)} is strong.`);
    else drivers.negative.push(`DSCR ${dscr.toFixed(2)} is below target.`);
  } else {
    drivers.negative.push("DSCR missing.");
  }

  const stressPts = stressScore(minStress);
  if (minStress !== null) {
    if (minStress >= 1.0) drivers.positive.push(`Stress DSCR floor ${minStress.toFixed(2)}.`);
    else drivers.negative.push(`Stress DSCR floor ${minStress.toFixed(2)} is weak.`);
  } else {
    drivers.negative.push("Stress results missing.");
  }

  const sbaPts = sbaBoost(sbaStatus);
  if (sbaStatus) {
    if (String(sbaStatus).toLowerCase() === "eligible") drivers.positive.push("SBA eligible.");
    if (String(sbaStatus).toLowerCase() === "ineligible") drivers.negative.push("SBA ineligible.");
  }

  const penalty = volatilityPenalty(dscr, minStress);
  if (penalty > 0) {
    drivers.negative.push("Cash flow volatility under stress.");
  }

  const raw = dscrPts + stressPts + sbaPts - penalty;
  const score = clamp(raw, 0, 100);
  const grade = gradeFromScore(score);

  const confidenceBase = input.snapshot.completeness_pct ?? 0;
  const stressConfidence = minStress !== null ? 0.2 : 0;
  const confidence = Math.max(0.1, Math.min(1, confidenceBase / 100 + stressConfidence));

  return {
    score,
    grade,
    drivers,
    confidence,
  };
}
