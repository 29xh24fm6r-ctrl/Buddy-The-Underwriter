# SPEC-12 — Predictive Advisor & Decision Quality Layer

**Goal:** extend the advisor from “what is happening / what is wrong” into deterministic forward-looking guidance about committee risk, decision quality, and closing risk.

SPEC-11 hardened persistence, RLS, suppressions, blocker memory, and deterministic predictive warnings, with 453 journey tests passing.

---

## Primary objective

```text
predictive warning primitives
        ↓
decision-quality advisor with actionable risk explanations
```

---

## Scope

### 1. New advisor signal kinds

```ts
"decision_quality_warning"
"committee_risk_warning"
"closing_risk_warning"
"documentation_risk_warning"   // reserved for future doc-tier predictors
```

All deterministic.

### 2. Committee predictors

```text
committee_failure_risk:
  committeeRequired = true
  AND (
    critical overrides > 0
    OR memo gaps >= 3
    OR documentsReadinessPct < 80
    OR critical blockers exist
  )

committee_delay_risk:
  committeeRequired = true
  AND committeePacketReady = false
  AND (
    memo gaps > 0
    OR unresolved blockers > 0
    OR recent failed packet/memo action
  )
```

### 3. Closing predictor

```text
closing_delay_risk:
  stage in closing_in_progress / closed
  AND (
    open warning/critical conditions > 0
    OR documentsReady = false
    OR documentsReadinessPct < 90
  )
```

### 4. Decision-quality predictors

`buildDecisionQualitySignals.ts`:

```text
approval_without_conditions:
  approved decision
  AND no approval conditions recorded
  AND open risk/override warnings exist

override_without_rationale:
  override row exists
  AND reason missing AND justification missing

memo_mismatch_risk:
  memo gaps > 0
  AND stage in committee/decision

attestation_gap:
  decisionPresent = true
  AND attestationSatisfied = false
```

### 5. Evidence model

`evidence.ts` — every predictive / decision-quality signal carries:

```ts
type AdvisorEvidence = {
  source:
    | "lifecycle"
    | "blockers"
    | "conditions"
    | "overrides"
    | "memo"
    | "documents"
    | "telemetry"
    | "decision";
  label: string;
  value?: string | number | boolean;
  severity?: "info" | "warning" | "critical";
};
```

### 6. Why this matters

`CockpitAdvisorPanel`:

- Default mode now renders a `Why this matters` block with deterministic body, evidence rows, and a recommended-next-step line.
- Debug-only metadata (priority, predictionReason, signalKey, dismiss_count) stays inside `?advisor=debug`.

### 7. Optional LLM explanation layer — gated

`buildAdvisorExplanation.ts` exposes `buildDeterministicAdvisorExplanation` and `buildAdvisorExplanation`. The latter returns the deterministic body unconditionally today; an async LLM rewriter may be added later behind:

```text
NEXT_PUBLIC_ENABLE_ADVISOR_EXPLANATIONS=false
```

Guardrails:

- LLM cannot generate signal logic or invent facts.
- Source-of-truth is `signal.evidence` + `signal.predictionReason`.
- Any LLM failure falls back to the deterministic explanation.

---

## Files

### New

```text
src/lib/journey/advisor/evidence.ts
src/lib/journey/advisor/buildDecisionQualitySignals.ts
src/lib/journey/advisor/buildAdvisorExplanation.ts
src/components/journey/__tests__/spec12-predictive-decision-quality.test.ts
```

### Modified

```text
src/lib/journey/advisor/buildCockpitAdvisorSignals.ts
src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx
src/components/journey/stageViews/DecisionStageView.tsx
```

---

## Acceptance tests

28 deterministic tests covering:

```text
1.  committee_failure_risk emits with critical overrides
2.  committee_failure_risk emits when memo gaps >= 3
3.  committee_failure_risk emits when readiness < 80
4.  committee_delay_risk emits when packet not ready and blockers remain
5.  closing_delay_risk emits with open warning/critical conditions
6.  closing_delay_risk emits when documentsReadinessPct < 90
7.  approval_without_conditions emits for risky approval with no conditions
8.  override_without_rationale emits for missing reason+justification
9.  memo_mismatch_risk emits in committee/decision stage with memo gaps
10. attestation_gap emits when decision made but attestation not satisfied
11. Predictive signals include predictionReason
12. Predictive signals include evidence array
13. Evidence sources are limited to approved enum
14. Recommended actions reuse CockpitAction shape
15. Predictive signals rank below blockers, above recent_change
16. decision_quality_warning ranks above readiness_warning
17. Why this matters renders in default mode
18. Debug-only metadata stays out of default Why block
19. Debug mode shows priority/confidence/rankReason/signalKey/dismiss_count
20. LLM explanation flag is OFF by default
21. Deterministic explanation always renders, even with flag off
22. Builder + decision-quality + explanation modules remain pure (no fetch)
23. SPEC-01 through SPEC-11 journey tests remain green (481 total)
```
