# SPEC-12.1-IMPL — Committee Risk Scoring & Advisor Trust Language (Implementation)

**Status:** Ready for Claude Code (~3-5 days)
**Branch:** `feat/spec-12.1-trust-language` off `main`
**Source spec:** `specs/banker-journey-fluidity/SPEC-12.1-committee-risk-scoring-trust-language.md`
**Type:** First visible UX win after substrate arc.

## Summary

Replaces raw confidence percentages ("85%") with trust-language labels ("High confidence") in the advisor panel. Migrates committee_failure_risk from trigger-based to graduated risk score model. Adds client-side signal throttling.

## New files

- `src/lib/journey/advisor/buildRiskScore.ts` — pure score function
- `src/lib/journey/advisor/confidenceLabel.ts` — label mapping
- `src/components/journey/stageViews/_shared/useAdvisorSignalThrottle.ts` — client throttle hook
- `src/components/journey/__tests__/spec12-1-committee-risk-scoring.test.ts` — 18 tests

## Modified files

- `src/lib/journey/advisor/buildCockpitAdvisorSignals.ts` — committee_failure_risk migration + type extension
- `src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx` — label rendering + throttle + below-threshold filter

Full implementation details in the spec body committed alongside this file.
