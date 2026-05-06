# SPEC-12.1 — Committee Risk Scoring & Advisor Trust Language

**Status:** Ready for Claude Code
**Depends on:** SPEC-12 (predictive advisor + decision quality)
**Branches into:** SPEC-12.2 (momentum / aging / decision weighting / calibration / similar-situation language)

---

## Primary objective

Move from:

```text
trigger-based committee predictors with raw confidence decimals
```

to:

```text
graduated, score-driven committee risk + banker-readable trust language
```

Everything stays deterministic, pure, and testable. No ML. No black box.

---

## Out of scope (explicitly deferred to SPEC-12.2)

```text
risk momentum (delta-over-time)
closing condition aging
decision-quality weighted scoring
calibration analytics (action_rate / dismiss_rate per signal)
"seen in similar situations" language
```

---

## Scope

### 1. Generic risk score model (NOT committee-specific)

New pure module — reusable across committee, closing, and any future
risk surface:

```text
src/lib/journey/advisor/buildRiskScore.ts
```

Score formula (deterministic, integer):

```ts
buildRiskScore({
  overrides,                 // AdvisorOverrideRow[]
  memoGaps,                  // number
  blockers,                  // LifecycleBlocker[]
  readinessPct,              // 0..100
})
=>
total =
    (criticalOverrides   * 30)
  + (warningOverrides    * 15)
  + (memoGaps            * 10)
  + (blockerCount        * 25)
  + readinessPenalty
```

Where:

```text
criticalOverrides  = overrides.filter(severity in {CRITICAL, HIGH}).length
warningOverrides   = overrides.filter(severity == WARNING && requires_review).length
memoGaps           = caller-supplied count (memoSummary.missing_keys.length)
blockerCount       = blockers.length
readinessPenalty   = pct < 60 → 30
                     pct < 80 → 15
                     else      →  0
```

The function returns a structured result — not a tuple, not a severity:

```ts
export type RiskScore = {
  total: number;
  factors: {
    criticalOverrides: { count: number; points: number };
    warningOverrides:  { count: number; points: number };
    memoGaps:          { count: number; points: number };
    blockers:          { count: number; points: number };
    readinessPenalty:  { pct: number;   points: number };
  };
};

export function buildRiskScore(input: RiskScoreInput): RiskScore;
```

`buildRiskScore` is committee-agnostic. Closing / decision-quality
callers in SPEC-12.2 will reuse it with their own thresholds.

The factors map is the **single source of truth** for both severity
mapping and evidence rendering — no second derivation pass.

### 2. Score → severity mapping (external function)

Severity lives outside `buildRiskScore` so each surface picks its own
thresholds:

```ts
export type RiskSeverityThresholds = {
  critical: number;  // committee: 70
  warning:  number;  // committee: 40
};

export function mapScoreToSeverity(
  score: number,
  thresholds: RiskSeverityThresholds,
): "critical" | "warning" | "below_threshold";
```

Committee thresholds:

```text
score >= 70  → "critical"           (signal emitted, severity=critical)
score >= 40  → "warning"            (signal emitted, severity=warning)
score <  40  → "below_threshold"    (signal STILL emitted — see throttling/visibility below)
```

This replaces the SPEC-12 trigger union for `committee_failure_risk`.
`committee_delay_risk` (packet not ready + gating signals) keeps its
trigger logic; only the failure-risk path moves to scoring in this slice.

The emitted signal carries the score + factors as additional fields:

```ts
type CommitteeRiskWarning = CockpitAdvisorSignal & {
  predictionReason: "committee_failure_risk" | "committee_delay_risk";
  riskScore?: number;            // failure-risk only
  riskFactors?: RiskScore["factors"];
};
```

`evidence: AdvisorEvidence[]` is rewritten from the factors map: every
factor with `points > 0` becomes one evidence row, in canonical order.
Factors with `points == 0` are omitted.

Below-threshold visibility (check #7):

```text
score < 40   → severity tag "below_threshold"
            → builder STILL emits the signal
            → panel default mode hides it
            → panel ?advisor=debug mode shows it (so signal tuning is visible)
```

### 3. Human-language confidence labels — derived from SCORE, not legacy decimal

New pure module:

```text
src/lib/journey/advisor/confidenceLabel.ts
```

For risk-scored signals, the label is derived from the **score**, not
the legacy source-attribution `confidence` decimal. This keeps the
banner aligned with actual risk strength rather than provenance:

```ts
export function mapScoreToConfidence(score: number): {
  label: "Very high confidence" | "High confidence" | "Moderate confidence" | "Low confidence";
  numeric: number;  // 0..1, derived for back-compat sorting/debug
} {
  if (score >= 70) return { label: "Very high confidence", numeric: 0.95 };
  if (score >= 50) return { label: "High confidence",      numeric: 0.85 };
  if (score >= 30) return { label: "Moderate confidence",  numeric: 0.75 };
  return            { label: "Low confidence",             numeric: 0.6  };
}
```

For non-risk-scored signals (legacy SPEC-08 `confidence` decimals tied
to source provenance), the panel uses a fallback decimal-based mapper:

```ts
export function decimalToConfidenceLabel(c: number): string {
  if (c >= 0.9) return "Very high confidence";
  if (c >= 0.8) return "High confidence";
  if (c >= 0.7) return "Moderate confidence";
  return "Low confidence";
}
```

Panel rendering:

```text
default mode  → "High confidence" (label only, score-derived for risk signals)
debug mode    → numeric confidence + score (when present), as today
```

The confidence chip in the row header (currently `85%`) is replaced by
the label in default mode. The `?advisor=debug` block keeps the numeric
value alongside `priority`, `rankReason`, `riskScore`, etc.

### 4. Structured "Why this matters" block

`AdvisorWhyBlock` is upgraded from a flat evidence list to a 3-section
explanation:

```text
Why this matters
────────────────
This deal is likely to face committee pushback because:

• 2 critical overrides remain unresolved
• Credit memo has 3 missing canonical facts
• Document readiness is 65%
• 1 lifecycle blocker is open

If unresolved, this may delay approval or require rework.
```

Source of truth:

```text
bullets   ← signal.evidence (1 bullet per evidence row, label + value)
opener    ← deterministic per signal kind (table below)
closer    ← deterministic per severity (table below)
```

Opener table (deterministic):

```text
committee_risk_warning  → "This deal is likely to face committee pushback because:"
closing_risk_warning    → "Closing is likely to be delayed because:"
decision_quality_warning→ "Decision quality is at risk because:"
predictive_warning      → "We expect a problem soon because:"
```

Closer table (deterministic, severity-keyed):

```text
critical → "If unresolved, committee may defer or decline."
warning  → "If unresolved, this may delay approval or require rework."
info     → "Worth resolving before stage advance."
```

Debug-only fields (`priority`, `predictionReason`, `signalKey`,
`dismiss_count`, numeric `confidence`) remain inside the existing
`?advisor=debug` block — SPEC-12.1 does NOT move them.

### 5. Lightweight signal throttling — keyed on content hash

Goal: prevent flicker on rapid stage refreshes; never suppress an
escalation; never suppress a content change. Stays client-side to keep
the builder pure.

New hook:

```text
src/components/journey/stageViews/_shared/useAdvisorSignalThrottle.ts
```

Throttle key is a deterministic hash of the signal **content**, not
just its identity:

```ts
function signalContentHash(signal): string {
  return [
    signal.kind,
    signal.predictionReason ?? "",
    signal.severity,
    signal.riskScore ?? "",
    JSON.stringify((signal.evidence ?? []).map((e) => [e.source, e.label, e.value])),
  ].join("|");
}
```

State map is keyed by `signalKey` (identity) but stores the last
content hash so we can detect "same signal, new content":

```text
state: Map<signalKey, { lastShownAt, lastSeverity, lastContentHash }>
```

Behavior per signal:

```text
prev = state.get(signalKey)

if !prev
    → show, record now
if prev && severity escalated (info→warning, warning→critical, *→critical)
    → ALWAYS show (bypass throttle), update record
if prev && contentHash !== lastContentHash
    → ALWAYS show (content changed — bypass throttle), update record
if prev && now - lastShownAt < THROTTLE_MS && contentHash unchanged
    → SUPPRESS
else
    → show, update record

THROTTLE_MS = 5 * 60 * 1000  // 5 minutes
```

Severity rank (escalation is strictly one-way — never de-escalates):

```text
info(0) < warning(1) < critical(2)
```

Critical-severity signals are never throttled (escalation rule covers
this; pinned for clarity).

The hook returns `(filteredSignals, suppressedCount)` so the panel can
show "(N hidden)" under a group title in SPEC-12.2.

---

## New files

```text
src/lib/journey/advisor/buildRiskScore.ts
src/lib/journey/advisor/confidenceLabel.ts
src/components/journey/stageViews/_shared/useAdvisorSignalThrottle.ts
src/components/journey/__tests__/spec12-1-committee-risk-scoring.test.ts
specs/banker-journey-fluidity/SPEC-12.1-committee-risk-scoring-trust-language.md
```

## Modified files

```text
src/lib/journey/advisor/buildCockpitAdvisorSignals.ts
src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx
```

---

## Acceptance tests (15)

```text
1.  committee risk score increases with critical overrides
2.  committee risk score increases with memo gaps
3.  committee risk score increases with blockers
4.  readiness penalty affects score below threshold
5.  score >= 70 maps to critical
6.  score >= 40 maps to warning
7.  score < 40 suppresses signal
8.  committee risk signal includes score + scoring factors
9.  confidence renders as human label, not raw decimal, in default mode
10. debug mode still exposes numeric confidence
11. Why this matters renders grouped explanation bullets
12. Why this matters includes evidence rows
13. signal throttling suppresses repeated unchanged signal
14. severity escalation bypasses throttling
15. existing SPEC-01 through SPEC-12 tests remain green
```

---

## Recommended commit

```text
feat(journey): refine committee advisor risk scoring
```

---

## Non-negotiables

```text
1.  buildRiskScore is committee-agnostic, pure, takes generic factor inputs.
    No fetch, no setTimeout, no time-of-day branching.
2.  buildRiskScore returns { total, factors }. NEVER returns severity.
3.  Severity is decided by mapScoreToSeverity(score, thresholds) — external.
4.  Confidence label for risk-scored signals is derived from SCORE via
    mapScoreToConfidence(score). The legacy decimal stays for non-risk
    signals (decimalToConfidenceLabel) and for the debug overlay.
5.  Evidence rows are derived from RiskScore.factors. No second pass that
    re-checks overrides/memo/blockers/readiness.
6.  Throttling key is a content hash of (kind, predictionReason, severity,
    riskScore, evidence rows). Identity alone is not enough.
7.  Severity escalation is strictly one-way: only info→warning, warning→
    critical, info→critical bypass throttle. De-escalations do not.
8.  Below-threshold (score < 40) signals are still emitted by the builder
    (tagged "below_threshold") and visible in ?advisor=debug. Default
    panel mode hides them.
9.  Debug overlay surfaces priority / rankReason / signalKey / numeric
    confidence / predictionReason / dismiss_count / riskScore / factor
    breakdown.
10. Existing SPEC-12 predictive_warning, decision_quality_warning,
    closing_risk_warning kinds continue to emit unchanged. Only
    committee_failure_risk migrates to the score model in this slice.
11. Throttling lives in the hook (useAdvisorSignalThrottle), not the
    builder; the builder remains pure and deterministic.
```

**End of SPEC-12.1.**
