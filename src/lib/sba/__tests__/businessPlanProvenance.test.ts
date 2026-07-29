import test from "node:test";
import assert from "node:assert/strict";
import { buildBusinessPlanProvenance } from "../businessPlanProvenance";
import type { BorrowerStory } from "../sbaBorrowerStory";

function fullStory(overrides: Partial<BorrowerStory> = {}): BorrowerStory {
  return {
    dealId: "deal-1",
    originStory: "Started as a food truck in 2015.",
    competitiveInsight: "Only local bakery using a wood-fired oven.",
    idealCustomer: "Busy professionals wanting artisan bread.",
    growthStrategy: "Add a second location downtown.",
    biggestRisk: "Flour cost volatility.",
    personalVision: "Build a regional bakery brand.",
    voiceFormality: "casual",
    voiceMetaphors: [],
    voiceValues: [],
    capturedVia: "chat",
    capturedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

test("returns null for every section when story is null", () => {
  const provenance = buildBusinessPlanProvenance(null);
  for (const key of Object.keys(provenance) as Array<keyof typeof provenance>) {
    assert.equal(provenance[key], null);
  }
});

test("returns null for a section whose mapped fields are all empty", () => {
  const story = fullStory({ competitiveInsight: null });
  const provenance = buildBusinessPlanProvenance(story);
  // swot_strengths is driven only by competitiveInsight
  assert.equal(provenance.swot_strengths, null);
});

test("swot_weaknesses has no mapped fields — always null regardless of story", () => {
  const provenance = buildBusinessPlanProvenance(fullStory());
  assert.equal(provenance.swot_weaknesses, null);
});

test("populates storyFields/capturedVia/capturedAt for a section with substance", () => {
  const story = fullStory();
  const provenance = buildBusinessPlanProvenance(story);
  assert.deepEqual(provenance.swot_strengths, {
    storyFields: ["competitiveInsight"],
    capturedVia: "chat",
    capturedAt: "2026-06-01T00:00:00.000Z",
  });
  assert.deepEqual(new Set(provenance.executive_summary?.storyFields), new Set([
    "originStory",
    "competitiveInsight",
    "idealCustomer",
    "growthStrategy",
    "biggestRisk",
    "personalVision",
  ]));
});

test("only includes fields that actually have substance, not the full section map", () => {
  const story = fullStory({ personalVision: "" });
  const provenance = buildBusinessPlanProvenance(story);
  assert.ok(!provenance.executive_summary?.storyFields.includes("personalVision"));
  assert.ok(provenance.executive_summary?.storyFields.includes("originStory"));
});
