/**
 * Credit Memo PDF — Risk Flags & Audit Trail Section
 */

import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { styles } from "../styles";
import type { SpreadFlag } from "../../flagEngine/types";

const SEVERITY_BADGE: Record<string, (typeof styles)[keyof typeof styles]> = {
  critical: styles.badgeRed,
  elevated: styles.badgeAmber,
  watch: styles.badgeBlue,
  informational: styles.badgeGray,
};

const STATUS_BADGE: Record<string, (typeof styles)[keyof typeof styles]> = {
  open: styles.badgeAmber,
  banker_reviewed: styles.badgeBlue,
  sent_to_borrower: styles.badgeBlue,
  answered: styles.badgeGreen,
  resolved: styles.badgeGreen,
  waived: styles.badgeGray,
};

export function RiskFlagsSection({ flags }: { flags: SpreadFlag[] }) {
  if (flags.length === 0) {
    return (
      <View>
        <Text style={styles.h2}>RISK FLAGS & RESOLUTION</Text>
        <Text style={styles.bodyText}>No material risk flags were identified.</Text>
      </View>
    );
  }

  // Group by severity
  const grouped: Record<string, SpreadFlag[]> = {};
  for (const flag of flags) {
    const sev = flag.severity;
    if (!grouped[sev]) grouped[sev] = [];
    grouped[sev].push(flag);
  }

  const severityOrder = ["critical", "elevated", "watch", "informational"];

  return (
    <View>
      <Text style={styles.h2}>RISK FLAGS & RESOLUTION</Text>

      {severityOrder.map((sev) => {
        const group = grouped[sev];
        if (!group || group.length === 0) return null;
        return (
          <View key={sev} style={{ marginBottom: 10 }}>
            <Text style={styles.h3}>
              {sev.charAt(0).toUpperCase() + sev.slice(1)} ({group.length})
            </Text>
            {group.map((flag) => (
              <FlagEntry key={flag.flag_id} flag={flag} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function FlagEntry({ flag }: { flag: SpreadFlag }) {
  const sevBadge = SEVERITY_BADGE[flag.severity] ?? styles.badgeGray;
  const statusBadge = STATUS_BADGE[flag.status] ?? styles.badgeGray;

  return (
    <View wrap={false} style={{ marginBottom: 8, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", paddingBottom: 6 }}>
      {/* Header row */}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
        <Text style={{ ...styles.badge, ...sevBadge, marginRight: 6 }}>
          {flag.severity}
        </Text>
        <Text style={{ fontSize: 9, fontWeight: "bold", flex: 1 }}>
          {flag.banker_summary}
        </Text>
        <Text style={{ ...styles.badge, ...statusBadge }}>
          {flag.status.replace(/_/g, " ")}
        </Text>
      </View>

      {/* Detail */}
      <View style={{ paddingLeft: 10 }}>
        <Text style={{ ...styles.smallText, lineHeight: 1.4 }}>
          {flag.banker_detail}
        </Text>

        {/* Trigger info */}
        <Text style={{ ...styles.smallText, marginTop: 2 }}>
          Trigger: {flag.trigger_type}
          {flag.year_observed ? ` (${flag.year_observed})` : ""}
          {flag.observed_value !== null && flag.observed_value !== undefined
            ? ` — Observed: ${flag.observed_value}`
            : ""}
        </Text>

        {/* Waived reason */}
        {flag.status === "waived" && flag.waived_reason && (
          <Text style={{ ...styles.smallText, color: "#6b7280", marginTop: 2 }}>
            Waived: {flag.waived_reason}
          </Text>
        )}

        {/* Borrower question */}
        {flag.borrower_question && (
          <View style={{ marginTop: 3 }}>
            <Text style={{ ...styles.smallText, fontWeight: "bold" }}>
              Question sent{flag.borrower_question.sent_at ? ` ${flag.borrower_question.sent_at.split("T")[0]}` : ""}:
            </Text>
            <Text style={{ ...styles.smallText, paddingLeft: 8 }}>
              {flag.borrower_question.question_text.slice(0, 200)}
              {flag.borrower_question.question_text.length > 200 ? "..." : ""}
            </Text>

            {/* Borrower answer */}
            {flag.borrower_question.answer_text && (
              <View style={{ marginTop: 2 }}>
                <Text style={{ ...styles.smallText, fontWeight: "bold" }}>Borrower response:</Text>
                <Text style={{ ...styles.smallText, paddingLeft: 8 }}>
                  {flag.borrower_question.answer_text.slice(0, 300)}
                  {flag.borrower_question.answer_text.length > 300 ? "..." : ""}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}
