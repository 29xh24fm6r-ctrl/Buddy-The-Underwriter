// Pure function. No DB. No side effects. No network.
import type { SignalDetectionInput, PortfolioSignal, PortfolioSignalType } from "./types";

const MIN_CLUSTER_SIZE = 3;

/**
 * Detect cross-relationship portfolio signals.
 * Each signal must meet minimum evidence thresholds.
 *
 * HARD RULE: No signal without >= minimum relationships and >= 1 evidence per relationship.
 */
export function derivePortfolioSignals(
  input: SignalDetectionInput,
): PortfolioSignal[] {
  const signals: PortfolioSignal[] = [];
  let signalCounter = 0;

  // Deposit runoff cluster
  const depositRunoffRels = input.relationships.filter((r) => r.hasDepositRunoff);
  if (depositRunoffRels.length >= MIN_CLUSTER_SIZE) {
    const allHaveEvidence = depositRunoffRels.every((r) => r.evidenceIds.length > 0);
    if (allHaveEvidence) {
      signals.push({
        signalId: `sig_${++signalCounter}`,
        type: "deposit_runoff_cluster",
        severity: depositRunoffRels.length >= 5 ? "high" : "moderate",
        relationshipIds: depositRunoffRels.map((r) => r.relationshipId),
        explanation: `${depositRunoffRels.length} relationships show deposit runoff patterns within the observation window.`,
        evidenceIds: depositRunoffRels.flatMap((r) => r.evidenceIds),
        detectedAt: input.nowIso,
      });
    }
  }

  // Renewal wave
  const renewalDueRels = input.relationships.filter((r) => r.hasRenewalDue);
  if (renewalDueRels.length >= MIN_CLUSTER_SIZE) {
    signals.push({
      signalId: `sig_${++signalCounter}`,
      type: "renewal_wave",
      severity: renewalDueRels.length >= 8 ? "high" : "moderate",
      relationshipIds: renewalDueRels.map((r) => r.relationshipId),
      explanation: `${renewalDueRels.length} relationships have renewals due within the upcoming window.`,
      evidenceIds: renewalDueRels.flatMap((r) => r.evidenceIds),
      detectedAt: input.nowIso,
    });
  }

  // Industry stress cluster
  const industryGroups = new Map<string, typeof input.relationships>();
  for (const r of input.relationships) {
    if (!r.industryCode) continue;
    if (r.systemTier !== "critical_distress" && r.systemTier !== "protection") continue;
    const existing = industryGroups.get(r.industryCode) ?? [];
    existing.push(r);
    industryGroups.set(r.industryCode, existing);
  }
  for (const [industry, rels] of industryGroups) {
    if (rels.length >= MIN_CLUSTER_SIZE) {
      const allHaveEvidence = rels.every((r) => r.evidenceIds.length > 0);
      if (allHaveEvidence) {
        signals.push({
          signalId: `sig_${++signalCounter}`,
          type: "industry_stress_cluster",
          severity: rels.length >= 5 ? "critical" : "high",
          relationshipIds: rels.map((r) => r.relationshipId),
          explanation: `${rels.length} relationships in industry ${industry} show stress patterns.`,
          evidenceIds: rels.flatMap((r) => r.evidenceIds),
          detectedAt: input.nowIso,
        });
      }
    }
  }

  // Treasury stall cluster
  const treasuryStallRels = input.relationships.filter((r) => r.hasTreasuryStall);
  if (treasuryStallRels.length >= MIN_CLUSTER_SIZE) {
    signals.push({
      signalId: `sig_${++signalCounter}`,
      type: "treasury_stall_cluster",
      severity: "moderate",
      relationshipIds: treasuryStallRels.map((r) => r.relationshipId),
      explanation: `${treasuryStallRels.length} relationships have stalled treasury onboarding.`,
      evidenceIds: treasuryStallRels.flatMap((r) => r.evidenceIds),
      detectedAt: input.nowIso,
    });
  }

  // Growth opportunity cluster
  const growthRels = input.relationships.filter((r) => r.hasGrowthOpportunity);
  if (growthRels.length >= MIN_CLUSTER_SIZE) {
    signals.push({
      signalId: `sig_${++signalCounter}`,
      type: "growth_opportunity_cluster",
      severity: "low",
      relationshipIds: growthRels.map((r) => r.relationshipId),
      explanation: `${growthRels.length} relationships have identified growth opportunities.`,
      evidenceIds: growthRels.flatMap((r) => r.evidenceIds),
      detectedAt: input.nowIso,
    });
  }

  return signals;
}
