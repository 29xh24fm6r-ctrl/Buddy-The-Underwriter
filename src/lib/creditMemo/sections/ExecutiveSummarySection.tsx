/**
 * Credit Memo PDF — Executive Summary Section
 */

import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { styles, REC_BANNERS } from "../styles";
import type { ExecutiveSummary } from "../../spreadOutput/types";

export function ExecutiveSummarySection({ summary }: { summary: ExecutiveSummary }) {
  const bannerStyle = REC_BANNERS[summary.recommendation_level] ?? REC_BANNERS.adequate;

  return (
    <View>
      <Text style={styles.h2}>EXECUTIVE SUMMARY</Text>

      {/* Recommendation banner */}
      <View style={bannerStyle}>
        <Text style={{ fontSize: 11, fontWeight: "bold", color: "#ffffff" }}>
          Credit Recommendation: {summary.recommendation_level.charAt(0).toUpperCase() + summary.recommendation_level.slice(1)}
        </Text>
        <Text style={{ fontSize: 9, color: "#ffffff", marginTop: 4 }}>
          {summary.recommendation_language}
        </Text>
      </View>

      {/* Content blocks */}
      <LabeledParagraph label="Business Overview" text={summary.business_overview} />
      <LabeledParagraph label="Financial Snapshot" text={summary.financial_snapshot} />
      <LabeledParagraph label="Coverage & Debt Service" text={summary.coverage_summary} />
      <LabeledParagraph label="Collateral Position" text={summary.collateral_summary} />

      {/* Risk flags */}
      {summary.risk_flags_summary &&
        !summary.risk_flags_summary.includes("No material risk flags") && (
          <View style={{ borderWidth: 1, borderColor: "#fbbf24", backgroundColor: "#fffbeb", padding: 8, marginTop: 8, borderRadius: 4 }}>
            <Text style={{ ...styles.h3, color: "#92400e" }}>Risk Flags</Text>
            <Text style={styles.bodyText}>{summary.risk_flags_summary}</Text>
          </View>
        )}
    </View>
  );
}

function LabeledParagraph({ label, text }: { label: string; text: string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={styles.h3}>{label}</Text>
      <Text style={styles.bodyText}>{text}</Text>
    </View>
  );
}
