/**
 * Credit Memo PDF — Ratio Scorecard Section
 */

import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { styles } from "../styles";
import type { RatioScorecardReport, RatioGroup, RatioScorecardItem } from "../../spreadOutput/types";

const ASSESSMENT_BADGE: Record<string, (typeof styles)[keyof typeof styles]> = {
  strong: styles.badgeGreen,
  adequate: styles.badgeBlue,
  weak: styles.badgeAmber,
  concerning: styles.badgeRed,
};

export function RatioScorecardSection({ scorecard }: { scorecard: RatioScorecardReport }) {
  return (
    <View>
      <Text style={styles.h2}>RATIO ANALYSIS</Text>

      {/* Overall assessment */}
      <View style={{ marginBottom: 10 }}>
        <Text style={styles.bodyText}>
          Overall Assessment:{" "}
          <Text style={{ fontWeight: "bold" }}>
            {scorecard.overall_assessment.charAt(0).toUpperCase() + scorecard.overall_assessment.slice(1)}
          </Text>
        </Text>
      </View>

      {/* Ratio groups */}
      {scorecard.groups.map((group) => (
        <RatioGroupBlock key={group.group_name} group={group} />
      ))}
    </View>
  );
}

function RatioGroupBlock({ group }: { group: RatioGroup }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.h3}>{group.group_name}</Text>

      {/* Table header */}
      <View style={styles.tableRowHeader}>
        <Text style={{ ...styles.tableCellLabel, fontWeight: "bold", fontSize: 8 }}>Ratio</Text>
        <Text style={{ ...styles.tableCellRight, fontWeight: "bold", fontSize: 8 }}>Value</Text>
        <Text style={{ ...styles.tableCellRight, fontWeight: "bold", fontSize: 8 }}>Percentile</Text>
        <Text style={{ ...styles.tableCell, fontWeight: "bold", fontSize: 8 }}>Assessment</Text>
        <Text style={{ ...styles.tableCellRight, fontWeight: "bold", fontSize: 8 }}>Policy</Text>
        <Text style={{ ...styles.tableCell, fontWeight: "bold", fontSize: 8 }}>Status</Text>
      </View>

      {/* Ratio rows */}
      {group.ratios.map((ratio) => (
        <RatioRow key={ratio.canonical_key} ratio={ratio} />
      ))}
    </View>
  );
}

function RatioRow({ ratio }: { ratio: RatioScorecardItem }) {
  const assessBadge = ratio.assessment ? ASSESSMENT_BADGE[ratio.assessment] : null;
  const policyLabel = ratio.policy_minimum != null
    ? `Min ${ratio.policy_minimum}`
    : ratio.policy_maximum != null
      ? `Max ${ratio.policy_maximum}`
      : "\u2014";

  return (
    <View wrap={false}>
      <View style={styles.tableRow}>
        <Text style={{ ...styles.tableCellLabel, fontSize: 8 }}>{ratio.label}</Text>
        <Text style={{ ...styles.tableCellRight, fontSize: 8, fontWeight: "bold" }}>
          {ratio.formatted_value}
        </Text>
        <Text style={{ ...styles.tableCellRight, fontSize: 8 }}>
          {ratio.percentile !== null ? `P${Math.round(ratio.percentile)}` : "\u2014"}
        </Text>
        <View style={{ flex: 1 }}>
          {assessBadge ? (
            <Text style={{ ...styles.badge, ...assessBadge }}>
              {ratio.assessment}
            </Text>
          ) : (
            <Text style={{ fontSize: 8 }}>{"\u2014"}</Text>
          )}
        </View>
        <Text style={{ ...styles.tableCellRight, fontSize: 8 }}>{policyLabel}</Text>
        <View style={{ flex: 1 }}>
          {ratio.passes_policy !== null ? (
            <Text style={{ ...styles.badge, ...(ratio.passes_policy ? styles.badgeGreen : styles.badgeRed) }}>
              {ratio.passes_policy ? "Pass" : "Fail"}
            </Text>
          ) : (
            <Text style={{ fontSize: 8 }}>{"\u2014"}</Text>
          )}
        </View>
      </View>

      {/* Narrative */}
      {ratio.narrative && (
        <View style={{ paddingLeft: 16, paddingBottom: 4 }}>
          <Text style={{ ...styles.smallText, lineHeight: 1.4 }}>{ratio.narrative}</Text>
        </View>
      )}
    </View>
  );
}
