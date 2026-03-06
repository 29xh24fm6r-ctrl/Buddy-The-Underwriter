/**
 * Credit Memo PDF — Normalized Financial Spread Section
 */

import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { styles } from "../styles";
import type { NormalizedSpread, NormalizedLineItem, SpreadAdjustment } from "../../spreadOutput/types";

const TREND_ARROWS: Record<string, string> = {
  up: "\u2191",
  down: "\u2193",
  flat: "\u2192",
};

const CATEGORY_LABELS: Record<string, string> = {
  revenue: "Revenue",
  cogs: "Cost of Goods Sold",
  expense: "Operating Expenses",
  ebitda: "EBITDA / Cash Flow",
  debt_service: "Debt Service",
  ratio: "Key Ratios",
  balance_sheet: "Balance Sheet",
};

function fmtNum(val: number | null): string {
  if (val === null || val === undefined) return "\u2014";
  if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  if (Math.abs(val) < 10 && val !== 0) return val.toFixed(2);
  return `$${Math.round(val).toLocaleString("en-US")}`;
}

export function NormalizedSpreadSection({ spread }: { spread: NormalizedSpread }) {
  const hasAnyAdjustments = spread.line_items.some((item) =>
    spread.years.some((y) => item.values[y]?.adjustments?.length > 0),
  );

  // Collect all footnotes
  const footnotes: Array<{ marker: number; label: string; amount: number; source: string }> = [];
  let footnoteIdx = 1;

  // Group by category
  const grouped = groupByCategory(spread.line_items);

  return (
    <View>
      <Text style={styles.h2}>NORMALIZED FINANCIAL SPREAD</Text>

      <View style={styles.table}>
        {/* Header row */}
        <View style={styles.tableRowHeader}>
          <Text style={{ ...styles.tableCellLabel, fontSize: 8, fontWeight: "bold" }}>Line Item</Text>
          {spread.years.map((year) =>
            hasAnyAdjustments ? (
              <React.Fragment key={year}>
                <Text style={{ ...styles.tableCellRight, fontSize: 8, fontWeight: "bold" }}>
                  {year} Rep.
                </Text>
                <Text style={{ ...styles.tableCellRight, fontSize: 8, fontWeight: "bold" }}>
                  {year} Norm.
                </Text>
              </React.Fragment>
            ) : (
              <Text key={year} style={{ ...styles.tableCellRight, fontSize: 8, fontWeight: "bold" }}>
                {year}
              </Text>
            ),
          )}
          <Text style={{ ...styles.tableCellRight, fontSize: 8, fontWeight: "bold" }}>Trend</Text>
        </View>

        {/* Data rows by category */}
        {grouped.map(([category, items]) => (
          <React.Fragment key={category}>
            {/* Category header */}
            <View style={{ ...styles.tableRow, backgroundColor: "#f3f4f6" }}>
              <Text style={{ ...styles.tableCellLabel, fontSize: 8, fontWeight: "bold" }}>
                {CATEGORY_LABELS[category] ?? category}
              </Text>
            </View>

            {/* Line items */}
            {items.map((item) => {
              const lastYear = spread.years[spread.years.length - 1];
              const trend = item.values[lastYear]?.trend;
              const trendArrow = trend ? TREND_ARROWS[trend] ?? "" : "";

              return (
                <View key={item.canonical_key} style={styles.tableRow}>
                  <Text style={{ ...styles.tableCellLabel, fontSize: 8 }}>{item.label}</Text>
                  {spread.years.map((year) => {
                    const cell = item.values[year];
                    if (!cell) {
                      return hasAnyAdjustments ? (
                        <React.Fragment key={year}>
                          <Text style={{ ...styles.tableCellRight, fontSize: 8 }}>{"\u2014"}</Text>
                          <Text style={{ ...styles.tableCellRight, fontSize: 8 }}>{"\u2014"}</Text>
                        </React.Fragment>
                      ) : (
                        <Text key={year} style={{ ...styles.tableCellRight, fontSize: 8 }}>{"\u2014"}</Text>
                      );
                    }

                    const hasAdj = cell.adjustments?.length > 0;
                    let marker = "";
                    if (hasAdj && cell.reported !== cell.normalized) {
                      for (const adj of cell.adjustments) {
                        footnotes.push({ marker: footnoteIdx, label: adj.label, amount: adj.amount, source: adj.source });
                      }
                      marker = ` *${footnoteIdx}`;
                      footnoteIdx++;
                    }

                    return hasAnyAdjustments ? (
                      <React.Fragment key={year}>
                        <Text style={{ ...styles.tableCellRight, fontSize: 8 }}>
                          {fmtNum(cell.reported)}
                        </Text>
                        <Text style={{ ...styles.tableCellRight, fontSize: 8 }}>
                          {fmtNum(cell.normalized)}{marker}
                        </Text>
                      </React.Fragment>
                    ) : (
                      <Text key={year} style={{ ...styles.tableCellRight, fontSize: 8 }}>
                        {fmtNum(cell.reported)}
                      </Text>
                    );
                  })}
                  <Text style={{ ...styles.tableCellRight, fontSize: 8 }}>{trendArrow}</Text>
                </View>
              );
            })}
          </React.Fragment>
        ))}
      </View>

      {/* Footnotes */}
      {footnotes.length > 0 && (
        <View style={{ marginTop: 8 }}>
          <Text style={{ ...styles.smallText, fontWeight: "bold", marginBottom: 4 }}>
            Adjustment Notes:
          </Text>
          {footnotes.map((fn) => (
            <Text key={fn.marker} style={styles.smallText}>
              *{fn.marker}: {fn.label} ({fmtNum(fn.amount)}) — Source: {fn.source}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function groupByCategory(items: NormalizedLineItem[]): [string, NormalizedLineItem[]][] {
  const map = new Map<string, NormalizedLineItem[]>();
  for (const item of items) {
    const list = map.get(item.category) ?? [];
    list.push(item);
    map.set(item.category, list);
  }
  return Array.from(map.entries());
}
