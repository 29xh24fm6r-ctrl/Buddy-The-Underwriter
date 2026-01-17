import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export type PortfolioDealRow = {
  deal_id: string;
  snapshot: DealFinancialSnapshotV1;
  decision: { stress?: any; sba?: any } | null;
  score: { score: number; grade: string } | null;
  deal: { deal_type?: string | null; geography?: string | null } | null;
};

export type PortfolioSummary = {
  totalDeals: number;
  totalExposure: number;
  weightedAvgDscr: number | null;
  stressSurvivalRate: number | null;
  gradeDistribution: Record<string, number>;
  sbaEligibilityRate: number | null;
  concentrationByAssetType: Record<string, number>;
  concentrationByGeography: Record<string, number>;
};

function toNum(v: any): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function extractMinStress(stress: any): number | null {
  const values = [
    stress?.stresses?.vacancyUp?.dscr,
    stress?.stresses?.rentDown?.dscr,
    stress?.stresses?.rateUp?.dscr,
  ].filter((v) => typeof v === "number");

  if (!values.length) return null;
  return Math.min(...(values as number[]));
}

export function buildPortfolioSummary(rows: PortfolioDealRow[]): PortfolioSummary {
  let totalExposure = 0;
  let dscrWeightedSum = 0;
  let dscrWeight = 0;
  let stressCount = 0;
  let stressPass = 0;
  let sbaEligible = 0;

  const gradeDistribution: Record<string, number> = {};
  const concentrationByAssetType: Record<string, number> = {};
  const concentrationByGeography: Record<string, number> = {};

  for (const row of rows) {
    const exposure =
      toNum(row.snapshot.bank_loan_total?.value_num) ??
      toNum(row.snapshot.total_project_cost?.value_num) ??
      0;

    totalExposure += exposure;

    const dscr = toNum(row.snapshot.dscr?.value_num);
    if (dscr !== null && exposure > 0) {
      dscrWeightedSum += dscr * exposure;
      dscrWeight += exposure;
    }

    const minStress = extractMinStress(row.decision?.stress);
    if (minStress !== null) {
      stressCount += 1;
      if (minStress >= 1.0) stressPass += 1;
    }

    const sbaStatus = String(row.decision?.sba?.status ?? "").toLowerCase();
    if (sbaStatus === "eligible") sbaEligible += 1;

    const grade = row.score?.grade ?? "unknown";
    gradeDistribution[grade] = (gradeDistribution[grade] ?? 0) + 1;

    const assetType = row.deal?.deal_type ?? "unknown";
    concentrationByAssetType[assetType] = (concentrationByAssetType[assetType] ?? 0) + 1;

    const geo = row.deal?.geography ?? "unknown";
    concentrationByGeography[geo] = (concentrationByGeography[geo] ?? 0) + 1;
  }

  const weightedAvgDscr = dscrWeight > 0 ? dscrWeightedSum / dscrWeight : null;
  const stressSurvivalRate = stressCount > 0 ? Math.round((stressPass / stressCount) * 1000) / 10 : null;
  const sbaEligibilityRate = rows.length ? Math.round((sbaEligible / rows.length) * 1000) / 10 : null;

  return {
    totalDeals: rows.length,
    totalExposure,
    weightedAvgDscr: weightedAvgDscr ? Math.round(weightedAvgDscr * 100) / 100 : null,
    stressSurvivalRate,
    gradeDistribution,
    sbaEligibilityRate,
    concentrationByAssetType,
    concentrationByGeography,
  };
}
