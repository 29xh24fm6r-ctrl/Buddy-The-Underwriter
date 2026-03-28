/**
 * Phase 65K — Overlay Recommendation Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveOverlayRecommendation, type RecommendationInput } from "./deriveOverlayRecommendation";

const BASE: RecommendationInput = {
  hasActiveWatchlist: false,
  hasActiveWorkout: false,
  watchlistSeverity: null,
  openActionItemCount: 0,
};

describe("deriveOverlayRecommendation", () => {
  it("returns none when nothing active", () => {
    assert.equal(deriveOverlayRecommendation(BASE), "none");
  });

  it("returns none when in workout already", () => {
    assert.equal(
      deriveOverlayRecommendation({ ...BASE, hasActiveWorkout: true }),
      "none",
    );
  });

  it("returns escalate_to_workout for critical watchlist", () => {
    assert.equal(
      deriveOverlayRecommendation({ ...BASE, hasActiveWatchlist: true, watchlistSeverity: "critical" }),
      "escalate_to_workout",
    );
  });

  it("returns close_watchlist when no open items", () => {
    assert.equal(
      deriveOverlayRecommendation({ ...BASE, hasActiveWatchlist: true, watchlistSeverity: "low", openActionItemCount: 0 }),
      "close_watchlist",
    );
  });

  it("returns none for moderate watchlist with items", () => {
    assert.equal(
      deriveOverlayRecommendation({ ...BASE, hasActiveWatchlist: true, watchlistSeverity: "moderate", openActionItemCount: 3 }),
      "none",
    );
  });
});
