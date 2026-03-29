import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { rankPortfolioRelationships } from "./rankPortfolioRelationships";
import { derivePortfolioSignals } from "./derivePortfolioSignals";
import { buildPortfolioSummary } from "./buildPortfolioSummary";
import { buildPortfolioActionability } from "./buildPortfolioActionability";
import type {
  PortfolioScope,
  PortfolioIntelligencePack,
  PortfolioRelationshipInput,
} from "./types";
import type { SystemTier } from "../relationship-decision/types";

export const PORTFOLIO_VERSION = "portfolio_v1";

/**
 * Resolve full portfolio intelligence pack.
 * Reads from relationship surface snapshots (65L) and distress rollups (65M).
 * Never throws — returns degraded pack on failure.
 */
export async function resolvePortfolioIntelligencePack(
  scope: PortfolioScope,
): Promise<PortfolioIntelligencePack> {
  const nowIso = new Date().toISOString();

  const emptyPack: PortfolioIntelligencePack = {
    scope,
    generatedAt: nowIso,
    orderedRelationships: [],
    signals: [],
    summary: {
      totalRelationships: 0,
      distressCounts: { watchlist: 0, workout: 0 },
      upcomingDeadlines: 0,
      borrowerBlocked: 0,
      protectionExposure: 0,
      growthOpportunities: 0,
      topRisks: [],
    },
    actions: [],
    diagnostics: {
      version: PORTFOLIO_VERSION,
      inputSources: [],
      degraded: true,
    },
  };

  try {
    const sb = supabaseAdmin();

    // Fetch relationship surface snapshots
    const { data: snapshots } = await sb
      .from("relationship_surface_snapshots")
      .select("relationship_id, priority_bucket, priority_score, primary_reason_code, primary_action_code, changed_since_viewed, surface_payload")
      .eq("bank_id", scope.bankId)
      .order("priority_score", { ascending: false })
      .limit(500);

    if (!snapshots || snapshots.length === 0) {
      return { ...emptyPack, diagnostics: { ...emptyPack.diagnostics, degraded: false } };
    }

    // Fetch distress rollups
    const { data: distressRollups } = await sb
      .from("relationship_distress_rollups")
      .select("relationship_id, highest_state, highest_severity, active_watchlist_count, active_workout_count")
      .eq("bank_id", scope.bankId);

    const distressMap = new Map<string, Record<string, unknown>>();
    for (const r of (distressRollups ?? []) as Array<Record<string, unknown>>) {
      distressMap.set(r.relationship_id as string, r);
    }

    // Build ranking inputs from surface snapshots
    const tierMap: Record<string, SystemTier> = {
      critical: "critical_distress",
      urgent: "time_bound_work",
      watch: "protection",
      healthy: "informational",
    };

    const inputs: PortfolioRelationshipInput[] = snapshots.map((s) => {
      const distress = distressMap.get(s.relationship_id);
      const payload = s.surface_payload as Record<string, unknown> | null;
      const hasDistress = (Number(distress?.active_watchlist_count ?? 0)) > 0 || (Number(distress?.active_workout_count ?? 0)) > 0;
      const reason = s.primary_reason_code ?? "";

      return {
        relationshipId: s.relationship_id,
        systemTier: tierMap[s.priority_bucket] ?? "informational",
        primaryAction: s.primary_action_code
          ? { code: s.primary_action_code as any, targetType: "relationship" as const, targetId: s.relationship_id, label: s.primary_action_code, tier: tierMap[s.priority_bucket] ?? "informational" }
          : null,
        severityWeight: s.priority_score > 800 ? 100 : s.priority_score > 500 ? 60 : 20,
        deadlineWeight: reason.includes("overdue") || reason.includes("renewal") ? 80 : 0,
        exposureWeight: 0,
        evidenceWeight: 0,
        policyWeight: reason.includes("integrity") || reason.includes("liquidation") ? 80 : 0,
        ageWeight: 0,
        hasDistress,
        hasDeadline: reason.includes("overdue") || reason.includes("renewal") || reason.includes("annual"),
        hasBorrowerBlock: reason.includes("borrower"),
        hasProtection: reason.includes("protection") || reason.includes("runoff"),
        hasGrowth: reason.includes("growth") || reason.includes("expansion") || reason.includes("profitability"),
        hasHighValue: false,
        whyNow: (payload as any)?.explanationLines?.[0] ?? reason,
      };
    });

    // Run pure functions
    const ranked = rankPortfolioRelationships(inputs);

    const signalInputs = inputs.map((i) => ({
      relationshipId: i.relationshipId,
      systemTier: i.systemTier,
      queueReasons: [] as string[],
      hasDepositRunoff: false, // would come from treasury layer
      hasRenewalDue: i.hasDeadline,
      industryCode: null as string | null,
      hasTreasuryStall: false,
      hasGrowthOpportunity: i.hasGrowth,
      evidenceIds: [] as string[],
    }));

    const signals = derivePortfolioSignals({ relationships: signalInputs, nowIso });
    const summary = buildPortfolioSummary(ranked, signals);
    const actions = buildPortfolioActionability(scope, ranked, signals);

    // Persist current scores (non-blocking)
    persistScores(scope.bankId, ranked).catch(() => {});

    return {
      scope,
      generatedAt: nowIso,
      orderedRelationships: ranked,
      signals,
      summary,
      actions,
      diagnostics: {
        version: PORTFOLIO_VERSION,
        inputSources: ["relationship_surface_snapshots", "relationship_distress_rollups"],
        degraded: false,
      },
    };
  } catch (err) {
    console.error("[resolvePortfolioIntelligencePack] error:", err);
    return emptyPack;
  }
}

async function persistScores(bankId: string, ranked: Array<{ relationshipId: string; systemTier: string; rankPosition: number; explanation: string; drivers: Record<string, boolean>; primaryAction: unknown }>) {
  try {
    const sb = supabaseAdmin();

    // Upsert current scores
    for (const r of ranked.slice(0, 100)) {
      await sb
        .from("relationship_portfolio_scores")
        .upsert({
          relationship_id: r.relationshipId,
          bank_id: bankId,
          system_tier: r.systemTier,
          rank_position: r.rankPosition,
          total_score: 1000 - r.rankPosition,
          primary_action_code: (r.primaryAction as any)?.code ?? null,
          explanation: r.explanation,
          drivers: r.drivers,
          computed_at: new Date().toISOString(),
        }, { onConflict: "relationship_id" });
    }

    // Append snapshot history
    const snapshotRows = ranked.slice(0, 100).map((r) => ({
      relationship_id: r.relationshipId,
      bank_id: bankId,
      system_tier: r.systemTier,
      rank_position: r.rankPosition,
      total_score: 1000 - r.rankPosition,
      primary_action_code: (r.primaryAction as any)?.code ?? null,
      drivers: r.drivers,
    }));

    if (snapshotRows.length > 0) {
      await sb.from("relationship_portfolio_score_snapshots").insert(snapshotRows);
    }
  } catch (err) {
    console.error("[persistScores] error:", err);
  }
}
