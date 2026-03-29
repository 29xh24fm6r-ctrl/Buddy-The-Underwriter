/**
 * Phase 56 — Borrower Financial Health Report Types
 */

import type { HealthScore } from "@/lib/ratios/healthScoring";
import type { AltmanResult } from "@/lib/ratios/altmanZScore";

export type BenchmarkComparison = {
  metricName: string;
  borrowerValue: number;
  industryMedian: number | null;
  percentile25: number | null;
  percentile75: number | null;
  interpretation: string;
};

export type StrengthItem = {
  title: string;
  detail: string;
  metric: string;
  value: number;
};

export type ImprovementItem = {
  title: string;
  detail: string;
  impact: string;
  recommendation: string;
};

export type BorrowerHealthReport = {
  dealId: string;
  generatedAt: string;
  naicsCode: string | null;
  healthScore: HealthScore;
  computedRatios: Record<string, number | null>;
  benchmarkComparisons: BenchmarkComparison[];
  strengths: StrengthItem[];
  improvementOpportunities: ImprovementItem[];
  altmanZScore: AltmanResult;
  snapshotHash: string | null;
};
