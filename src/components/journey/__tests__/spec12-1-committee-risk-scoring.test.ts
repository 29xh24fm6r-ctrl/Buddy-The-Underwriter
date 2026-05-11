/**
 * SPEC-12.1 — Committee risk scoring + advisor trust language tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

// ── Pure module tests: buildRiskScore ──────────────────────────────────────

test("[spec12.1-1] buildRiskScore increases score with critical overrides", () => {
  const { buildRiskScore } = require("@/lib/journey/advisor/buildRiskScore");
  const base = buildRiskScore({ overrides: [], memoGaps: 0, blockers: [], readinessPct: 100 });
  const withOverride = buildRiskScore({
    overrides: [{ severity: "CRITICAL" }],
    memoGaps: 0, blockers: [], readinessPct: 100,
  });
  assert.ok(withOverride.total > base.total, "Critical overrides must increase score");
  assert.equal(withOverride.factors.criticalOverrides.count, 1);
  assert.equal(withOverride.factors.criticalOverrides.points, 30);
});

test("[spec12.1-2] buildRiskScore increases score with memo gaps", () => {
  const { buildRiskScore } = require("@/lib/journey/advisor/buildRiskScore");
  const score = buildRiskScore({ overrides: [], memoGaps: 4, blockers: [], readinessPct: 100 });
  assert.equal(score.factors.memoGaps.points, 40);
  assert.ok(score.total >= 40);
});

test("[spec12.1-3] buildRiskScore increases score with blockers", () => {
  const { buildRiskScore } = require("@/lib/journey/advisor/buildRiskScore");
  const score = buildRiskScore({ overrides: [], memoGaps: 0, blockers: [{}, {}], readinessPct: 100 });
  assert.equal(score.factors.blockers.points, 50);
});

test("[spec12.1-4] readiness penalty affects score below 80%", () => {
  const { buildRiskScore } = require("@/lib/journey/advisor/buildRiskScore");
  const at90 = buildRiskScore({ overrides: [], memoGaps: 0, blockers: [], readinessPct: 90 });
  const at70 = buildRiskScore({ overrides: [], memoGaps: 0, blockers: [], readinessPct: 70 });
  const at50 = buildRiskScore({ overrides: [], memoGaps: 0, blockers: [], readinessPct: 50 });
  assert.equal(at90.factors.readinessPenalty.points, 0);
  assert.equal(at70.factors.readinessPenalty.points, 15);
  assert.equal(at50.factors.readinessPenalty.points, 30);
});

test("[spec12.1-5] mapScoreToSeverity: score >= 70 → critical", () => {
  const { mapScoreToSeverity, COMMITTEE_RISK_THRESHOLDS } = require("@/lib/journey/advisor/buildRiskScore");
  assert.equal(mapScoreToSeverity(70, COMMITTEE_RISK_THRESHOLDS), "critical");
  assert.equal(mapScoreToSeverity(100, COMMITTEE_RISK_THRESHOLDS), "critical");
});

test("[spec12.1-6] mapScoreToSeverity: score >= 40 → warning", () => {
  const { mapScoreToSeverity, COMMITTEE_RISK_THRESHOLDS } = require("@/lib/journey/advisor/buildRiskScore");
  assert.equal(mapScoreToSeverity(40, COMMITTEE_RISK_THRESHOLDS), "warning");
  assert.equal(mapScoreToSeverity(69, COMMITTEE_RISK_THRESHOLDS), "warning");
});

test("[spec12.1-7] mapScoreToSeverity: score < 40 → below_threshold", () => {
  const { mapScoreToSeverity, COMMITTEE_RISK_THRESHOLDS } = require("@/lib/journey/advisor/buildRiskScore");
  assert.equal(mapScoreToSeverity(0, COMMITTEE_RISK_THRESHOLDS), "below_threshold");
  assert.equal(mapScoreToSeverity(39, COMMITTEE_RISK_THRESHOLDS), "below_threshold");
});

// ── Pure module tests: confidenceLabel ─────────────────────────────────────

test("[spec12.1-8] resolveConfidenceLabel uses score-based mapping when riskScore present", () => {
  const { resolveConfidenceLabel } = require("@/lib/journey/advisor/confidenceLabel");
  assert.equal(resolveConfidenceLabel({ riskScore: 75, decimalConfidence: 0.5 }), "Very high confidence");
  assert.equal(resolveConfidenceLabel({ riskScore: 55, decimalConfidence: 0.5 }), "High confidence");
});

test("[spec12.1-9] resolveConfidenceLabel falls back to decimal when no riskScore", () => {
  const { resolveConfidenceLabel } = require("@/lib/journey/advisor/confidenceLabel");
  assert.equal(resolveConfidenceLabel({ decimalConfidence: 0.95 }), "Very high confidence");
  assert.equal(resolveConfidenceLabel({ decimalConfidence: 0.85 }), "High confidence");
  assert.equal(resolveConfidenceLabel({ decimalConfidence: 0.75 }), "Moderate confidence");
  assert.equal(resolveConfidenceLabel({ decimalConfidence: 0.6 }), "Low confidence");
});

// ── Source-level guards ────────────────────────────────────────────────────

test("[spec12.1-10] buildCockpitAdvisorSignals type includes riskScore/riskFactors/belowThreshold", () => {
  const body = read("src/lib/journey/advisor/buildCockpitAdvisorSignals.ts");
  assert.match(body, /riskScore\?:\s*number/, "CockpitAdvisorSignal must have optional riskScore field");
  assert.match(body, /riskFactors\?/, "CockpitAdvisorSignal must have optional riskFactors field");
  assert.match(body, /belowThreshold\?:\s*boolean/, "CockpitAdvisorSignal must have optional belowThreshold field");
});

test("[spec12.1-11] committee_failure_risk uses buildRiskScore (score-based, not trigger-based)", () => {
  const body = read("src/lib/journey/advisor/buildCockpitAdvisorSignals.ts");
  assert.match(body, /buildRiskScore\(/, "committee_failure_risk must use buildRiskScore");
  assert.match(body, /mapScoreToSeverity\(/, "committee_failure_risk must use mapScoreToSeverity");
  assert.match(body, /_riskScore:/, "committee_failure_risk must pass _riskScore to withRanking");
  assert.match(body, /_riskFactors:/, "committee_failure_risk must pass _riskFactors to withRanking");
});

test("[spec12.1-12] CockpitAdvisorPanel renders trust-language labels (not percentages in header chip)", () => {
  const body = read("src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx");
  assert.match(body, /resolveConfidenceLabel/, "Panel must import and use resolveConfidenceLabel");
  assert.match(body, /confidenceLabel/, "Panel must compute confidenceLabel");
  assert.match(body, /data-advisor-confidence-label/, "Panel must set data-advisor-confidence-label attribute");
  // The header chip should render confidenceLabel, not confidencePct%
  const chipIdx = body.indexOf("data-advisor-confidence-label");
  const nearbyChip = body.slice(chipIdx - 200, chipIdx + 500);
  assert.ok(
    !nearbyChip.includes("{confidencePct}%") || nearbyChip.includes("{confidenceLabel}"),
    "Header chip area must render confidenceLabel, not confidencePct%",
  );
});

test("[spec12.1-13] debug block includes riskScore and riskFactors fields", () => {
  const body = read("src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx");
  const debugIdx = body.indexOf("advisor-debug-block");
  assert.ok(debugIdx > 0, "Debug block must exist");
  const debugBlock = body.slice(debugIdx, debugIdx + 1000);
  assert.match(debugBlock, /riskScore/, "Debug block must show riskScore");
  assert.match(debugBlock, /riskFactors/, "Debug block must show riskFactors");
  assert.match(debugBlock, /belowThreshold/, "Debug block must show belowThreshold");
});

test("[spec12.1-14] below-threshold signals are filtered from default mode", () => {
  const body = read("src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx");
  assert.match(
    body,
    /belowThreshold.*&&.*!debug.*continue/s,
    "annotated loop must skip belowThreshold signals when not in debug mode",
  );
});

test("[spec12.1-15] buildRiskScore is pure — no side effects", () => {
  const body = read("src/lib/journey/advisor/buildRiskScore.ts");
  // Strip comments before checking for side-effect patterns
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!stripped.includes("Date.now"), "buildRiskScore must not use Date.now()");
  assert.ok(!stripped.includes("fetch("), "buildRiskScore must not use fetch()");
  assert.ok(!stripped.includes("setTimeout"), "buildRiskScore must not use setTimeout");
  assert.ok(!stripped.includes("await "), "buildRiskScore must not be async");
});

test("[spec12.1-16] WhyBlock footer renders confidenceLabel (not percentage)", () => {
  const body = read("src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx");
  // Find the AdvisorWhyBlock component
  const whyIdx = body.indexOf("function AdvisorWhyBlock");
  assert.ok(whyIdx > 0, "AdvisorWhyBlock must exist");
  const whyBlock = body.slice(whyIdx, whyIdx + 1000);
  assert.match(whyBlock, /confidenceLabel/, "AdvisorWhyBlock must accept and render confidenceLabel");
});

test("[spec12.1-17] useAdvisorSignalThrottle exists and exports correctly", () => {
  const body = read("src/components/journey/stageViews/_shared/useAdvisorSignalThrottle.ts");
  assert.match(body, /export function useAdvisorSignalThrottle/, "Must export useAdvisorSignalThrottle");
  assert.match(body, /signalContentHash/, "Must implement signalContentHash");
  assert.match(body, /THROTTLE_MS/, "Must define THROTTLE_MS constant");
  assert.match(body, /filteredSignals/, "Must return filteredSignals");
  assert.match(body, /suppressedCount/, "Must return suppressedCount");
});

test("[spec12.1-18] signalContentHash produces stable hash", () => {
  const body = read("src/components/journey/stageViews/_shared/useAdvisorSignalThrottle.ts");
  assert.match(body, /export function signalContentHash/, "signalContentHash must be exported for testing");
});
