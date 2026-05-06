// Pure risk-delta engine.
//
// Reads canonical metric values from the Florida Armory snapshot's
// section.data subtree (NOT a separate `metrics` map — the 20-section
// schema embeds metrics inside data). Compares before/after across four
// load-bearing factors and produces an overall direction, materiality,
// and per-driver explanation.

import type {
  IntelligenceSnapshotRow,
  RiskDeltaAnalysis,
  RiskDeltaDirection,
  RiskDeltaDriver,
  RiskImpact,
} from "./types";

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[$,%]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function get(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  return path
    .split(".")
    .reduce<unknown>((acc, key) => {
      if (acc === null || acc === undefined) return undefined;
      if (typeof acc !== "object") return undefined;
      return (acc as Record<string, unknown>)[key];
    }, obj);
}

function direction(before: number | null, after: number | null): RiskDeltaDirection {
  if (before === null && after === null) return "unchanged";
  if (before === null && after !== null) return "added";
  if (before !== null && after === null) return "removed";
  if (after! > before!) return "up";
  if (after! < before!) return "down";
  return "unchanged";
}

function impactFor(dir: RiskDeltaDirection, higherIsBetter: boolean): RiskImpact {
  if (dir === "unchanged") return "neutral";
  if (dir === "added" || dir === "removed") return "neutral";
  if (higherIsBetter) return dir === "up" ? "positive" : "negative";
  return dir === "up" ? "negative" : "positive";
}

function driver(args: {
  factor: string;
  before: number | null;
  after: number | null;
  higherIsBetter: boolean;
  explanation: string;
}): RiskDeltaDriver {
  const dir = direction(args.before, args.after);
  return {
    factor: args.factor,
    before: args.before,
    after: args.after,
    direction: dir,
    impact: impactFor(dir, args.higherIsBetter),
    explanation: args.explanation,
  };
}

function readMemo(row: IntelligenceSnapshotRow): unknown {
  const m = row.memo_output_json;
  return m && typeof m === "object" ? m : {};
}

// Path resolvers map factors to where they live inside a Florida Armory
// snapshot. Section data wraps the canonical memo subtrees, so each
// metric value sits under data.<canonical_path>.value or .length.
type FactorResolver = {
  factor: string;
  higherIsBetter: boolean;
  explanation: string;
  read: (memo: unknown) => number | null;
};

const FACTOR_RESOLVERS: readonly FactorResolver[] = [
  {
    factor: "DSCR",
    higherIsBetter: true,
    explanation: "Higher DSCR generally improves repayment capacity.",
    read: (memo) => num(get(memo, "sections.debt_coverage.data.financial_analysis.dscr.value")),
  },
  {
    factor: "Global DSCR",
    higherIsBetter: true,
    explanation: "Higher global DSCR improves combined repayment support.",
    read: (memo) => num(get(memo, "sections.global_cash_flow.data.global_cash_flow.global_dscr.value")),
  },
  {
    factor: "Collateral coverage",
    higherIsBetter: true,
    explanation: "Higher collateral coverage improves secondary repayment support.",
    read: (memo) => num(get(memo, "sections.collateral.data.collateral.collateral_coverage.value")),
  },
  {
    factor: "Policy exceptions",
    higherIsBetter: false,
    explanation: "Fewer policy exceptions generally improves credit quality.",
    read: (memo) => {
      const exceptions = get(memo, "sections.policy_exceptions.data.exceptions");
      return Array.isArray(exceptions) ? exceptions.length : null;
    },
  },
];

export function computeRiskDelta(
  beforeSnapshot: IntelligenceSnapshotRow,
  afterSnapshot: IntelligenceSnapshotRow,
): RiskDeltaAnalysis {
  const before = readMemo(beforeSnapshot);
  const after = readMemo(afterSnapshot);

  const drivers: RiskDeltaDriver[] = FACTOR_RESOLVERS.map((r) =>
    driver({
      factor: r.factor,
      before: r.read(before),
      after: r.read(after),
      higherIsBetter: r.higherIsBetter,
      explanation: r.explanation,
    }),
  );

  const positives = drivers.filter((d) => d.impact === "positive").length;
  const negatives = drivers.filter((d) => d.impact === "negative").length;

  const overall =
    positives > negatives
      ? "improving"
      : negatives > positives
        ? "deteriorating"
        : "neutral";

  return {
    from_snapshot_id: beforeSnapshot.id,
    to_snapshot_id: afterSnapshot.id,
    overall,
    materiality: Math.abs(positives - negatives) >= 2 ? "material" : "moderate",
    drivers,
    recommendation_shift:
      overall === "improving"
        ? "Credit profile strengthened versus prior submission."
        : overall === "deteriorating"
          ? "Credit profile weakened versus prior submission."
          : "Credit profile is broadly unchanged versus prior submission.",
  };
}
