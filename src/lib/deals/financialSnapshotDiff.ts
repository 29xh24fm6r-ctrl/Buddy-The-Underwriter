import type { DealFinancialSnapshotV1, SnapshotMetricName, SnapshotMetricValue } from "@/lib/deals/financialSnapshotCore";
import { SNAPSHOT_REQUIRED_METRICS_V1 } from "@/lib/deals/financialSnapshotCore";

export type SnapshotMetricDiff = {
  metric: SnapshotMetricName;
  from: SnapshotMetricValue;
  to: SnapshotMetricValue;
};

export type SnapshotDiffResult = {
  fromId: string;
  toId: string;
  diffs: SnapshotMetricDiff[];
};

function safeMetric(snapshot: DealFinancialSnapshotV1, key: SnapshotMetricName): SnapshotMetricValue {
  return snapshot[key];
}

function isSameValue(a: SnapshotMetricValue, b: SnapshotMetricValue): boolean {
  return a.value_num === b.value_num && a.value_text === b.value_text && a.as_of_date === b.as_of_date;
}

export function diffSnapshots(args: {
  fromId: string;
  toId: string;
  from: DealFinancialSnapshotV1;
  to: DealFinancialSnapshotV1;
}): SnapshotDiffResult {
  const metrics: SnapshotMetricName[] = Array.from(
    new Set([
      ...SNAPSHOT_REQUIRED_METRICS_V1,
      "walt_years",
    ])
  );

  const diffs: SnapshotMetricDiff[] = [];
  for (const metric of metrics) {
    const a = safeMetric(args.from, metric);
    const b = safeMetric(args.to, metric);
    if (!isSameValue(a, b)) {
      diffs.push({ metric, from: a, to: b });
    }
  }

  return {
    fromId: args.fromId,
    toId: args.toId,
    diffs,
  };
}
