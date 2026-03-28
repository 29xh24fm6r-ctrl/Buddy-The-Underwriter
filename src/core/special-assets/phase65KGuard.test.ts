/**
 * Phase 65K — Special Assets Guard Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("Phase 65K — Special Assets Guards", () => {
  it("migration exists with all 6 tables", () => {
    const p = join(root, "supabase/migrations/20260513_watchlist_workout.sql");
    assert.ok(existsSync(p));
    const content = readFileSync(p, "utf-8");
    assert.ok(content.includes("deal_watchlist_cases"));
    assert.ok(content.includes("deal_watchlist_reasons"));
    assert.ok(content.includes("deal_watchlist_events"));
    assert.ok(content.includes("deal_workout_cases"));
    assert.ok(content.includes("deal_workout_action_items"));
    assert.ok(content.includes("deal_workout_events"));
  });

  it("partial unique index enforces single active case per deal", () => {
    const content = readFileSync(join(root, "supabase/migrations/20260513_watchlist_workout.sql"), "utf-8");
    assert.ok(content.includes("idx_dwc_deal_active"), "watchlist single active index");
    assert.ok(content.includes("idx_dwoc_deal_active"), "workout single active index");
  });

  it("no Omega imports in special-assets layer", () => {
    const files = [
      "types.ts", "openWatchlistCase.ts", "resolveWatchlistCase.ts",
      "escalateToWorkout.ts", "openWorkoutCase.ts", "updateWorkoutCase.ts",
      "workoutActionItems.ts", "getDealRiskOverlay.ts", "deriveOverlayRecommendation.ts",
    ];
    for (const file of files) {
      const p = join(root, "src/core/special-assets", file);
      if (!existsSync(p)) continue;
      const content = readFileSync(p, "utf-8");
      assert.ok(!content.includes("@/core/omega"), `${file} must not import Omega`);
    }
  });

  it("workout closure requires resolution outcome", () => {
    const content = readFileSync(join(root, "src/core/special-assets/updateWorkoutCase.ts"), "utf-8");
    assert.ok(content.includes("resolution_outcome"), "must set resolution_outcome");
    assert.ok(content.includes("resolved_at"), "must set resolved_at");
  });

  it("watchlist events are append-only", () => {
    const content = readFileSync(join(root, "supabase/migrations/20260513_watchlist_workout.sql"), "utf-8");
    assert.ok(content.includes("deal_watchlist_events"), "must have event table");
    assert.ok(content.includes("event_at"), "events must have event_at");
  });

  it("workout events are append-only", () => {
    const content = readFileSync(join(root, "supabase/migrations/20260513_watchlist_workout.sql"), "utf-8");
    assert.ok(content.includes("deal_workout_events"), "must have event table");
  });

  it("return-to-pass route exists", () => {
    const p = join(root, "src/app/api/deals/[dealId]/special-assets/workout/return-to-pass/route.ts");
    assert.ok(existsSync(p));
    const content = readFileSync(p, "utf-8");
    assert.ok(content.includes("returnDealToPass"));
  });

  it("overlay route exists", () => {
    const p = join(root, "src/app/api/deals/[dealId]/special-assets/overlay/route.ts");
    assert.ok(existsSync(p));
    assert.ok(readFileSync(p, "utf-8").includes("getDealRiskOverlay"));
  });

  it("65H queue reasons include watchlist/workout", () => {
    const content = readFileSync(join(root, "src/core/command-center/queueReasonCatalog.ts"), "utf-8");
    assert.ok(content.includes("watchlist_active"));
    assert.ok(content.includes("workout_active"));
    assert.ok(content.includes("workout_action_overdue"));
    assert.ok(content.includes("workout_stalled"));
  });

  it("Special Assets tab in DealShell", () => {
    const content = readFileSync(join(root, "src/app/(app)/deals/[dealId]/DealShell.tsx"), "utf-8");
    assert.ok(content.includes("Special Assets"));
    assert.ok(content.includes("/special-assets"));
  });

  it("key server actions exist", () => {
    const required = [
      "openWatchlistCase.ts", "resolveWatchlistCase.ts", "escalateToWorkout.ts",
      "openWorkoutCase.ts", "updateWorkoutCase.ts", "workoutActionItems.ts",
      "getDealRiskOverlay.ts", "deriveOverlayRecommendation.ts",
    ];
    for (const file of required) {
      assert.ok(existsSync(join(root, "src/core/special-assets", file)), `${file} must exist`);
    }
  });

  it("escalation marks watchlist as escalated_to_workout", () => {
    const content = readFileSync(join(root, "src/core/special-assets/escalateToWorkout.ts"), "utf-8");
    assert.ok(content.includes("escalated_to_workout"));
    assert.ok(content.includes("openWorkoutCase"));
  });
});
