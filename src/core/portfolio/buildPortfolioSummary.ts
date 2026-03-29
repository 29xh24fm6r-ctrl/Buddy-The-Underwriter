// Pure function. No DB. No side effects. No network.
import type { RankedRelationship, PortfolioSummary, PortfolioSignal } from "./types";

/**
 * Build portfolio summary from ranked relationships and signals.
 */
export function buildPortfolioSummary(
  ranked: RankedRelationship[],
  signals: PortfolioSignal[],
): PortfolioSummary {
  const topRisks: string[] = [];

  // Count by driver
  const distressCount = ranked.filter((r) => r.drivers.distress).length;
  const deadlineCount = ranked.filter((r) => r.drivers.deadline).length;
  const borrowerBlockCount = ranked.filter((r) => r.drivers.borrowerBlock).length;
  const protectionCount = ranked.filter((r) => r.drivers.protection).length;
  const growthCount = ranked.filter((r) => r.drivers.growth).length;

  // Watchlist/workout counts from tier
  const watchlistCount = ranked.filter(
    (r) => r.systemTier === "critical_distress" && !r.drivers.distress,
  ).length;
  const workoutCount = ranked.filter(
    (r) => r.systemTier === "critical_distress" && r.drivers.distress,
  ).length;

  // Top risks from critical signals
  for (const sig of signals) {
    if (sig.severity === "critical" || sig.severity === "high") {
      topRisks.push(sig.explanation);
    }
  }

  // Top risks from critical relationships
  for (const r of ranked.slice(0, 3)) {
    if (r.systemTier === "integrity" || r.systemTier === "critical_distress") {
      topRisks.push(r.explanation);
    }
  }

  return {
    totalRelationships: ranked.length,
    distressCounts: {
      watchlist: watchlistCount,
      workout: workoutCount,
    },
    upcomingDeadlines: deadlineCount,
    borrowerBlocked: borrowerBlockCount,
    protectionExposure: protectionCount,
    growthOpportunities: growthCount,
    topRisks: topRisks.slice(0, 5),
  };
}
