/* ------------------------------------------------------------------ */
/*  Root Cause Tree — pure computation, no DB, no IO                  */
/* ------------------------------------------------------------------ */

export type MetricSnapshot = Record<
  string,
  { value: number; threshold?: number; priorValue?: number }
>;

export type RootCauseNode = {
  metric: string;
  label: string;
  status: "healthy" | "concerning" | "critical";
  explanation: string;
  children: RootCauseNode[];
};

export type RootCauseTree = {
  roots: RootCauseNode[];
  summary: string;
};

/* ------------------------------------------------------------------ */
/*  Metric relationship graph (parent → children drivers)             */
/* ------------------------------------------------------------------ */

const METRIC_TREE: Record<
  string,
  { label: string; children: string[] }
> = {
  dscr: {
    label: "Debt Service Coverage Ratio",
    children: ["noi", "debt_service"],
  },
  noi: {
    label: "Net Operating Income",
    children: ["revenue", "operating_expenses"],
  },
  revenue: {
    label: "Revenue",
    children: ["occupancy", "rental_rates", "other_income"],
  },
  operating_expenses: {
    label: "Operating Expenses",
    children: ["staffing_costs", "rent_expense", "utilities", "insurance", "maintenance"],
  },
  debt_service: {
    label: "Debt Service",
    children: ["principal_payments", "interest_expense"],
  },
  ltv: {
    label: "Loan-to-Value",
    children: ["loan_amount", "property_value"],
  },
  current_ratio: {
    label: "Current Ratio",
    children: ["current_assets", "current_liabilities"],
  },
  leverage: {
    label: "Leverage Ratio",
    children: ["total_debt", "total_equity"],
  },
  gross_margin: {
    label: "Gross Margin",
    children: ["revenue", "cost_of_goods"],
  },
  net_margin: {
    label: "Net Margin",
    children: ["revenue", "total_expenses"],
  },
};

/* ------------------------------------------------------------------ */

function deriveStatus(
  value: number,
  threshold?: number,
  priorValue?: number,
): "healthy" | "concerning" | "critical" {
  if (threshold !== undefined) {
    // Ratio-style metrics: value below threshold is bad
    if (value < threshold * 0.8) return "critical";
    if (value < threshold) return "concerning";
    return "healthy";
  }
  if (priorValue !== undefined && priorValue !== 0) {
    const changePct = ((value - priorValue) / Math.abs(priorValue)) * 100;
    // For most metrics, declining is bad
    if (changePct < -20) return "critical";
    if (changePct < -5) return "concerning";
    return "healthy";
  }
  return "healthy";
}

function buildExplanation(
  metric: string,
  label: string,
  value: number,
  threshold?: number,
  priorValue?: number,
): string {
  const parts: string[] = [];
  parts.push(`${label} is currently ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

  if (threshold !== undefined) {
    if (value < threshold) {
      parts.push(
        `which is below the ${threshold.toLocaleString("en-US", { maximumFractionDigits: 2 })} threshold`,
      );
    } else {
      parts.push(
        `which meets the ${threshold.toLocaleString("en-US", { maximumFractionDigits: 2 })} threshold`,
      );
    }
  }

  if (priorValue !== undefined && priorValue !== 0) {
    const changePct = ((value - priorValue) / Math.abs(priorValue)) * 100;
    const direction = changePct >= 0 ? "up" : "down";
    parts.push(
      `${direction} ${Math.abs(changePct).toFixed(1)}% from prior period`,
    );
  }

  return parts.join(", ") + ".";
}

function buildNode(
  metric: string,
  metrics: MetricSnapshot,
  depth: number,
): RootCauseNode | null {
  const data = metrics[metric];
  if (!data) return null;

  const treeDef = METRIC_TREE[metric];
  const label = treeDef?.label ?? metric;
  const status = deriveStatus(data.value, data.threshold, data.priorValue);
  const explanation = buildExplanation(
    metric,
    label,
    data.value,
    data.threshold,
    data.priorValue,
  );

  const children: RootCauseNode[] = [];
  if (depth < 4 && treeDef) {
    for (const childMetric of treeDef.children) {
      const childNode = buildNode(childMetric, metrics, depth + 1);
      if (childNode) {
        children.push(childNode);
      }
    }
  }

  return { metric, label, status, explanation, children };
}

export function buildRootCauseTree(metrics: MetricSnapshot): RootCauseTree {
  // Identify root-level metrics (those that appear as top-level keys in the tree)
  const topLevelMetrics = ["dscr", "ltv", "current_ratio", "leverage", "gross_margin", "net_margin"];

  const roots: RootCauseNode[] = [];

  for (const metric of topLevelMetrics) {
    const node = buildNode(metric, metrics, 0);
    if (node) {
      roots.push(node);
    }
  }

  // Also add any metrics from the snapshot that aren't part of the tree
  for (const metric of Object.keys(metrics)) {
    if (!roots.some((r) => r.metric === metric) && !isChildMetric(metric)) {
      const data = metrics[metric];
      const status = deriveStatus(data.value, data.threshold, data.priorValue);
      roots.push({
        metric,
        label: METRIC_TREE[metric]?.label ?? metric,
        status,
        explanation: buildExplanation(
          metric,
          METRIC_TREE[metric]?.label ?? metric,
          data.value,
          data.threshold,
          data.priorValue,
        ),
        children: [],
      });
    }
  }

  const criticalCount = countByStatus(roots, "critical");
  const concerningCount = countByStatus(roots, "concerning");
  const summary =
    criticalCount > 0
      ? `${criticalCount} critical metric(s) identified requiring immediate attention.`
      : concerningCount > 0
        ? `${concerningCount} metric(s) trending in a concerning direction.`
        : "All tracked metrics are within healthy ranges.";

  return { roots, summary };
}

function isChildMetric(metric: string): boolean {
  for (const def of Object.values(METRIC_TREE)) {
    if (def.children.includes(metric)) return true;
  }
  return false;
}

function countByStatus(
  nodes: RootCauseNode[],
  status: "healthy" | "concerning" | "critical",
): number {
  let count = 0;
  for (const node of nodes) {
    if (node.status === status) count++;
    count += countByStatus(node.children, status);
  }
  return count;
}
