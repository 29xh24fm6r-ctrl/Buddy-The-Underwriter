/**
 * Credit Memo PDF — Cover Page
 */

import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { styles, REC_BANNERS } from "../styles";
import type { CreditMemoInput } from "../types";

function fmtCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toLocaleString("en-US")}`;
}

export function CoverPage({ input }: { input: CreditMemoInput }) {
  const recLevel = input.spread_report.executive_summary.recommendation_level;
  const bannerStyle = REC_BANNERS[recLevel] ?? REC_BANNERS.adequate;

  return (
    <View style={styles.coverPage}>
      <Text style={styles.smallText}>{input.bank_name}</Text>
      <View style={{ marginVertical: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: "bold", textAlign: "center" }}>
          CREDIT MEMORANDUM
        </Text>
      </View>
      <Text style={{ fontSize: 18, fontWeight: "bold", marginBottom: 12, textAlign: "center" }}>
        {input.borrower_name}
      </Text>
      <Text style={{ fontSize: 14, marginBottom: 8, textAlign: "center" }}>
        {fmtCurrency(input.loan_amount)}
      </Text>
      <Text style={{ ...styles.bodyText, textAlign: "center", marginBottom: 20 }}>
        {input.loan_purpose}
      </Text>

      <View style={{ ...bannerStyle, width: 200, alignItems: "center" }}>
        <Text style={{ fontSize: 10, fontWeight: "bold", color: "#ffffff" }}>
          {recLevel.charAt(0).toUpperCase() + recLevel.slice(1)}
        </Text>
      </View>

      <View style={{ marginTop: 32 }}>
        <Text style={styles.smallText}>
          Prepared by: {input.prepared_by}
        </Text>
        <Text style={styles.smallText}>
          Date: {input.prepared_at}
        </Text>
      </View>

      <View style={{ position: "absolute", bottom: 48 }}>
        <Text style={{ fontSize: 8, color: "#9ca3af", textAlign: "center" }}>
          CONFIDENTIAL — FOR INTERNAL USE ONLY
        </Text>
      </View>
    </View>
  );
}
