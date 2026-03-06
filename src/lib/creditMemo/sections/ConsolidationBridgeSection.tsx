/**
 * Credit Memo PDF — Multi-Entity Consolidation Bridge Section
 */

import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { styles } from "../styles";
import type { ConsolidationBridge, BridgeLineItem } from "../../consolidation/consolidationBridge";

function fmtCurrency(val: number): string {
  if (val === 0) return "\u2014";
  const sign = val < 0 ? "(" : "";
  const end = val < 0 ? ")" : "";
  return `${sign}$${Math.abs(val).toLocaleString("en-US", { maximumFractionDigits: 0 })}${end}`;
}

export function ConsolidationBridgeSection({ bridge }: { bridge: ConsolidationBridge | undefined }) {
  if (!bridge) return null;

  return (
    <View>
      <Text style={styles.h2}>MULTI-ENTITY CONSOLIDATION BRIDGE</Text>

      <View style={styles.table}>
        {/* Header row */}
        <View style={styles.tableRowHeader}>
          <Text style={{ ...styles.tableCellLabel, fontSize: 7, fontWeight: "bold" }}>Line Item</Text>
          {bridge.entityNames.map((name) => (
            <Text key={name} style={{ ...styles.tableCellRight, fontSize: 7, fontWeight: "bold" }}>
              {name}
            </Text>
          ))}
          <Text style={{ ...styles.tableCellRight, fontSize: 7, fontWeight: "bold" }}>Eliminations</Text>
          <Text style={{ ...styles.tableCellRight, fontSize: 7, fontWeight: "bold" }}>Consolidated</Text>
        </View>

        {/* Data rows */}
        {bridge.lineItems.map((item) => (
          <BridgeRow key={item.canonicalKey} item={item} entityNames={bridge.entityNames} />
        ))}
      </View>

      {/* Footer note */}
      <View style={{ marginTop: 8 }}>
        <Text style={styles.smallText}>
          Intercompany transactions eliminated per consolidation engine.
        </Text>
      </View>
    </View>
  );
}

function BridgeRow({ item, entityNames }: { item: BridgeLineItem; entityNames: string[] }) {
  const labelStyle = item.isSubtotal
    ? { ...styles.tableCellLabel, fontSize: 7, fontWeight: "bold" as const }
    : { ...styles.tableCellLabel, fontSize: 7 };

  const valStyle = item.isSubtotal
    ? { ...styles.tableCellRight, fontSize: 7, fontWeight: "bold" as const }
    : { ...styles.tableCellRight, fontSize: 7 };

  return (
    <View style={styles.tableRow}>
      <Text style={labelStyle}>{item.label}</Text>
      {entityNames.map((name) => {
        const val = item.entities[name] ?? 0;
        return (
          <Text key={name} style={valStyle}>
            {item.isRatio ? `${val.toFixed(2)}x` : fmtCurrency(val)}
          </Text>
        );
      })}
      <Text style={valStyle}>
        {item.eliminations !== 0
          ? item.isRatio ? "\u2014" : fmtCurrency(item.eliminations)
          : "\u2014"}
      </Text>
      <Text style={{ ...valStyle, fontWeight: "bold" }}>
        {item.isRatio ? `${item.consolidatedTotal.toFixed(2)}x` : fmtCurrency(item.consolidatedTotal)}
      </Text>
    </View>
  );
}
