/**
 * Credit Memo PDF — Stylesheet
 */

import { StyleSheet } from "@react-pdf/renderer";

export const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: "Helvetica", fontSize: 10, color: "#111827" },
  coverPage: { flex: 1, justifyContent: "center", alignItems: "center" },
  h1: { fontSize: 22, fontWeight: "bold", marginBottom: 8 },
  h2: { fontSize: 15, fontWeight: "bold", marginBottom: 6, marginTop: 16, color: "#1e40af" },
  h3: { fontSize: 11, fontWeight: "bold", marginBottom: 4, marginTop: 10 },
  sectionDivider: { borderBottomWidth: 1, borderBottomColor: "#e5e7eb", marginVertical: 10 },
  bodyText: { fontSize: 10, lineHeight: 1.5, color: "#374151" },
  smallText: { fontSize: 8, color: "#6b7280" },
  table: { width: "100%", marginVertical: 8 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", paddingVertical: 4 },
  tableRowHeader: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#374151", paddingVertical: 4, backgroundColor: "#f9fafb" },
  tableCell: { flex: 1, fontSize: 9 },
  tableCellRight: { flex: 1, fontSize: 9, textAlign: "right" },
  tableCellLabel: { flex: 2, fontSize: 9 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontSize: 8 },
  badgeGreen: { backgroundColor: "#dcfce7", color: "#166534" },
  badgeRed: { backgroundColor: "#fee2e2", color: "#991b1b" },
  badgeAmber: { backgroundColor: "#fef3c7", color: "#92400e" },
  badgeBlue: { backgroundColor: "#dbeafe", color: "#1e40af" },
  badgeGray: { backgroundColor: "#f3f4f6", color: "#374151" },
  recommendationBannerStrong: { backgroundColor: "#166534", color: "#ffffff", padding: 12, marginBottom: 16, borderRadius: 4 },
  recommendationBannerAdequate: { backgroundColor: "#1e40af", color: "#ffffff", padding: 12, marginBottom: 16, borderRadius: 4 },
  recommendationBannerMarginal: { backgroundColor: "#b45309", color: "#ffffff", padding: 12, marginBottom: 16, borderRadius: 4 },
  recommendationBannerInsufficient: { backgroundColor: "#991b1b", color: "#ffffff", padding: 12, marginBottom: 16, borderRadius: 4 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: "#9ca3af" },
});

export const REC_BANNERS: Record<string, (typeof styles)[keyof typeof styles]> = {
  strong: styles.recommendationBannerStrong,
  adequate: styles.recommendationBannerAdequate,
  marginal: styles.recommendationBannerMarginal,
  insufficient: styles.recommendationBannerInsufficient,
};
