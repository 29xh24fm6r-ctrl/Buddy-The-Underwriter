import "server-only";

/**
 * Phase 66C — Guidance Effectiveness: Measures whether borrower guidance led to real behavior change.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface EffectivenessReport {
  totalGuidanceItems: number;
  actedOnCount: number;
  completedCount: number;
  ignoredCount: number;
  effectivenessRate: number;
  topEffectiveCategories: string[];
  topIgnoredCategories: string[];
}

interface RecRow {
  id: string;
  category: string;
  visibility: string;
}

interface ActionRow {
  action_key: string;
  status: string;
}

/**
 * Cross-references borrower-facing recommendations with actual borrower actions
 * to produce an effectiveness report.
 */
export async function measureGuidanceEffectiveness(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<EffectivenessReport> {
  const [recsRes, actionsRes] = await Promise.all([
    sb
      .from("buddy_action_recommendations")
      .select("id, category, visibility")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("visibility", "borrower"),
    sb
      .from("buddy_borrower_actions_taken")
      .select("action_key, status")
      .eq("deal_id", dealId),
  ]);

  const recs: RecRow[] = (recsRes.data ?? []) as RecRow[];
  const actions: ActionRow[] = (actionsRes.data ?? []) as ActionRow[];

  const totalGuidanceItems = recs.length;
  if (totalGuidanceItems === 0) {
    return {
      totalGuidanceItems: 0,
      actedOnCount: 0,
      completedCount: 0,
      ignoredCount: 0,
      effectivenessRate: 0,
      topEffectiveCategories: [],
      topIgnoredCategories: [],
    };
  }

  const actionKeys = new Set(actions.map((a) => a.action_key));
  const completedKeys = new Set(
    actions.filter((a) => a.status === "completed").map((a) => a.action_key),
  );

  // Match guidance recs to actions by category (action_key often maps to rec category)
  const actedOnCategories: string[] = [];
  const ignoredCategories: string[] = [];
  let actedOnCount = 0;
  let completedCount = 0;
  let ignoredCount = 0;

  for (const rec of recs) {
    if (completedKeys.has(rec.category)) {
      completedCount++;
      actedOnCount++;
      actedOnCategories.push(rec.category);
    } else if (actionKeys.has(rec.category)) {
      actedOnCount++;
      actedOnCategories.push(rec.category);
    } else {
      ignoredCount++;
      ignoredCategories.push(rec.category);
    }
  }

  // Rank categories by frequency
  const countByCategory = (cats: string[]): string[] => {
    const counts = new Map<string, number>();
    for (const c of cats) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat]) => cat);
  };

  const effectivenessRate =
    totalGuidanceItems > 0 ? actedOnCount / totalGuidanceItems : 0;

  return {
    totalGuidanceItems,
    actedOnCount,
    completedCount,
    ignoredCount,
    effectivenessRate,
    topEffectiveCategories: countByCategory(actedOnCategories),
    topIgnoredCategories: countByCategory(ignoredCategories),
  };
}
