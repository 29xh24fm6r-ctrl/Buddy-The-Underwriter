/**
 * Credit Memo PDF — Credit Analysis / Story Section
 */

import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { styles } from "../styles";
import type { StoryPanel, StoryElement, CovenantSuggestion } from "../../spreadOutput/types";

const SEVERITY_BADGE: Record<string, (typeof styles)[keyof typeof styles]> = {
  critical: styles.badgeRed,
  elevated: styles.badgeAmber,
  watch: styles.badgeBlue,
};

const FREQ_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

export function StorySection({ story }: { story: StoryPanel }) {
  return (
    <View>
      <Text style={styles.h2}>CREDIT ANALYSIS</Text>

      {/* Final narrative — prominent */}
      <View style={{ backgroundColor: "#f9fafb", padding: 10, borderRadius: 4, marginBottom: 12 }}>
        <Text style={{ ...styles.bodyText, lineHeight: 1.6 }}>{story.final_narrative}</Text>
      </View>

      {/* Key Risks */}
      {story.top_risks.length > 0 && (
        <View style={{ marginBottom: 10 }}>
          <Text style={styles.h3}>Key Risks</Text>
          {story.top_risks.map((risk, i) => (
            <StoryElementBlock key={i} element={risk} />
          ))}
        </View>
      )}

      {/* Key Strengths */}
      {story.top_strengths.length > 0 && (
        <View style={{ marginBottom: 10 }}>
          <Text style={styles.h3}>Key Strengths</Text>
          {story.top_strengths.map((strength, i) => (
            <StoryElementBlock key={i} element={strength} />
          ))}
        </View>
      )}

      {/* Global Analysis */}
      {story.resolution_narrative && (
        <View style={{ marginBottom: 10 }}>
          <Text style={styles.h3}>Global Analysis</Text>
          <Text style={styles.bodyText}>{story.resolution_narrative}</Text>
        </View>
      )}

      {/* Covenant Structure */}
      {story.covenant_suggestions.length > 0 && (
        <View style={{ marginBottom: 10 }}>
          <Text style={styles.h3}>Recommended Covenant Structure</Text>
          {story.covenant_suggestions.map((cov, i) => (
            <CovenantBlock key={i} covenant={cov} />
          ))}
        </View>
      )}
    </View>
  );
}

function StoryElementBlock({ element }: { element: StoryElement }) {
  const sevBadge = element.severity ? SEVERITY_BADGE[element.severity] : null;

  return (
    <View style={{ marginBottom: 6, paddingLeft: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
        {sevBadge && (
          <Text style={{ ...styles.badge, ...sevBadge, marginRight: 6 }}>
            {element.severity}
          </Text>
        )}
        <Text style={{ fontSize: 9, fontWeight: "bold" }}>{element.title}</Text>
      </View>
      <Text style={{ ...styles.smallText, paddingLeft: 4, lineHeight: 1.4 }}>
        {element.narrative}
      </Text>
    </View>
  );
}

function CovenantBlock({ covenant }: { covenant: CovenantSuggestion }) {
  return (
    <View style={{ marginBottom: 6, paddingLeft: 8, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", paddingBottom: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
        <Text style={{ fontSize: 9, fontWeight: "bold" }}>{covenant.covenant_type}</Text>
        <Text style={{ ...styles.badge, ...styles.badgeBlue, marginLeft: 6 }}>
          {FREQ_LABELS[covenant.frequency] ?? covenant.frequency}
        </Text>
      </View>
      <Text style={styles.bodyText}>{covenant.description}</Text>
      <Text style={{ ...styles.smallText, color: "#6b7280", marginTop: 2 }}>
        {covenant.rationale}
      </Text>
    </View>
  );
}
