# AAR — Phase 84 T-07 — Narrow Omega fallback on `/underwrite/state`

**Date:** 2026-04-20
**Ticket:** T-07 (Wave 3 — Restore advisory + governance)
**Completion event:** `buddy_system_events` id `073741c6-3fee-4536-9a45-d4595567e82d`
**Commit:** `123039f3`

---

## 1. Pre-work findings

### 1a. Pulse failure rate = 100% (every resource)

7-day breakdown from `buddy_signal_ledger`:

| Resource | Invokes | Failures | Rate |
|---|---|---|---|
| `omega://confidence/evaluate` | 12 | 12 | 100% |
| `omega://state/underwriting_case/*` | 7 | 7 | 100% |
| `omega://traces/*` | 7 | 7 | 100% |
| `omega://events/write` | 4 | 4 | 100% |
| `omega://advisory/deal-focus` | 3 | 3 | 100% |

Every call gets `omega_rpc_error: Method not found`. The `invokeOmega` chokepoint is healthy (ledgers everything, returns `{ ok: false }` cleanly). Pulse just doesn't implement the methods. T-07 takes this as given — adding Pulse-side handlers is T-07-B in Phase 84.1.

### 1b. Shape mismatch between the two routes (the real spec trap)

The v2 spec phrasing was "extend the fallback to `/underwrite/state`," implying shape compatibility. There is none:

| Route | Adapter path | `omegaAdvisory` shape |
|---|---|---|
| `/api/deals/[dealId]/state` | `OmegaAdvisoryAdapter.getOmegaAdvisoryState()` → `synthesizeAdvisoryFromRisk()` fallback | `OmegaAdvisoryState`: `{ confidence, advisory, riskEmphasis, traceRef, stale, staleReason }` (camelCase) |
| `/api/deals/[dealId]/underwrite/state` | direct `invokeOmega({ resource: "omega://advisory/deal-focus" })` | 4-field domain: `{ confidence, risk_emphasis, recommended_focus, advisory_grade }` (snake_case) |

**Naive assignment `omegaAdvisory = synthesizeAdvisoryFromRisk(...)` would have silently broken the contract.** The route declares `advisory_grade` and `recommended_focus`, neither of which exist in `OmegaAdvisoryState`. Translation is required.

### 1c. Zero UI consumers of `omegaAdvisory`

Grep across `src/components/` and `src/app/` for `omegaAdvisory\|advisory_grade\|recommended_focus\|risk_emphasis` (excluding tests):

```
src/app/api/deals/[dealId]/underwrite/state/route.ts:136,138,139,140,149,150,151,165,187
```

All 9 hits are inside the route file itself. No UI reads the field today.

This means the shape translation is **forward-looking** — there's no current UI regression risk. But it's still the right call: whoever eventually consumes `omegaAdvisory` on AnalystWorkbench will be pinned to the shape we set here. Setting it correctly now is cheaper than migrating later.

### 1d. Canary deal identified

Only 2 rows in `ai_risk_runs` total; both for deal `0279ed32-c25c-4919-b231-5790050331dd` (= ChatGPT Fix 15, a known test deal from T-10B). Latest result: `grade = "BB-"`, 4 factors, 2 negative. Shape matches `AiRiskResult` exactly.

Coincidentally helpful that the canary is a test deal — exercising the fallback doesn't affect any real underwriting case.

---

## 2. Implementation delta

Single file changed: `src/app/api/deals/[dealId]/underwrite/state/route.ts`.

- Existing `try { invokeOmega... if (omegaResult.ok) omegaAdvisory = omegaResult.data }` preserved unchanged.
- New `else` branch: dynamic-import `synthesizeAdvisoryFromRisk`, read latest `ai_risk_runs` row for the deal, synthesize, translate to the 4-field shape.
- Best-effort fail-open: missing `ai_risk_runs` → `omegaAdvisory` stays null. Synthesis or DB error → warn-log + null.

Translation mapping:

```
synthesized.confidence    → omegaAdvisory.confidence         (number, -1 sentinel if no factors)
synthesized.riskEmphasis  → omegaAdvisory.risk_emphasis      (array of negative-factor labels)
synthesized.advisory      → omegaAdvisory.recommended_focus  (human-readable summary; null if empty)
risk.grade ?? null        → omegaAdvisory.advisory_grade     (sourced directly from result_json.grade)
```

---

## 3. Acceptance (SQL proxy)

Live HTTP round-trip acceptance (curl with Clerk session cookie) is not executable from the MCP/CLI environment — same constraint as T-01, T-06. Substituted an SQL-proxy simulation that computes exactly what the TypeScript translation will produce.

### Canary (`0279ed32-...`, has ai_risk_runs)

SQL-simulated fallback output:

```
advisory_grade:       "BB-"
risk_emphasis:        ["Revenue Trend", "Interest Burden"]
confidence:           88
recommended_focus:    "Risk grade: BB-. Strengths: Profitability (Cash Flow), Asset Collateralization. Watch: Revenue Trend, Interest Burden."
```

All four fields populated ✓. Matches the route's declared contract exactly.

### Control (`7d76458d-...` canonical Ellmann, no ai_risk_runs)

```
EXISTS(ai_risk_runs) = false
```

Code path: `riskRow` is null → `if (riskRow?.result_json)` short-circuits → `omegaAdvisory` stays null. No crash ✓.

### Pulse observability unchanged

`omega.failed` events for `omega://advisory/deal-focus` still fire on every call (the fallback runs AFTER `invokeOmega` returns `!ok`, not instead of it). The canary deal has 3 existing failures in the 7-day ledger; any future call adds +1 `omega.failed` to that count per invocation. Observability is preserved — the fix doesn't silence the signal that Pulse is still broken.

### Regression check on `/state/route.ts`

**Not modified.** The user-facing route's Phase 65A fallback path is untouched. The `OmegaAdvisoryAdapter.getOmegaAdvisoryState()` call it makes, and the `synthesizeAdvisoryFromRisk()` fallback inside that adapter, are unchanged. No regression surface.

---

## 4. Spec deviations

### 1. Shape mismatch between the two routes (not flagged in v2)

The v2 spec template dumped `synthesizeAdvisoryFromRisk(...)` directly into `omegaAdvisory` — that would have silently broken the declared contract. Resolved with explicit translation in the fallback branch.

### 2. `recommended_focus` is a semantic compromise

`synthesized.advisory` is a human-readable summary ("Risk grade: BB-. Strengths: .... Watch: ...."). `recommended_focus`'s original intent was a banker-targeting focus hint (e.g., "verify 2024 T12 revenue decline"). Not a perfect match — but the closest signal available in `OmegaAdvisoryState`, and strictly better than `null`.

If this field ever gets a real UI consumer that depends on specific semantics, revisit — likely by expanding `OmegaAdvisoryState` to include a separate `recommendedFocus` field.

### 3. `advisory_grade` sourced from `risk.grade`, not from synthesizer

`synthesizeAdvisoryFromRisk` doesn't expose `grade` as a standalone field on `OmegaAdvisoryState` — it mentions it inside `advisory` text but doesn't return it structurally. The translation reads `result_json.grade` directly from the ai_risk_runs payload. Same source data, just bypasses the synthesizer for one field. Acceptable.

### 4. Zero current UI consumers

Every hit for the 4 field names is inside the route file. The declared contract has no active readers today. Flagged as an observation (not a deviation) — the translation is still correct, but the forward-looking nature of the fix matters for Phase 84.1 scoping (we can refactor more aggressively without UI migration debt).

### 5. Acceptance performed via SQL simulation, not live HTTP

Same CLI/Clerk limitation as T-01 / T-06. SQL query mirrors the TypeScript translation math exactly and produces a deterministic expected output. Live HTTP smoke should be confirmed once by a human with a browser session to close the acceptance loop — queued for human verification, not a blocker.

---

## 5. Phase 84.1 follow-ups

1. **Refactor `underwrite/state` to use `OmegaAdvisoryAdapter` pattern.** Eliminates the bespoke `invokeOmega` call + makes the fallback symmetric with `state/route.ts`. Larger scope than T-07 allowed; cleaner long-term shape. Trivial since no UI consumers exist yet.
2. **T-07-B — full Pulse adapter** (already in Phase 84.1 backlog). Once Pulse implements `omega://*` methods natively, the fallback goes dormant by design.
3. **Investigate `ai_risk_runs` sparsity.** Only 2 rows for 1 of 9 deals. Either the risk runner isn't firing broadly, or it only fires on specific lifecycle stages. Worth understanding before bankers rely on the advisory at scale.
4. **`recommended_focus` semantic upgrade.** If the field ever acquires a UI consumer, expose a distinct `recommendedFocus` on `OmegaAdvisoryState` so the synthesizer can emit a more targeted string rather than the full summary.
5. **Cleanup the dead field declarations** if no UI consumer materializes in Phase 84.1. Alternatively, wire the AnalystWorkbench to consume what the route already emits.

---

## Next

T-08 — Governance smoke test (deal_decisions, agent_approval_events, canonical_action_executions, draft_borrower_requests, borrower_request_campaigns must each gain at least one real row via `scripts/phase-84-governance-smoke.ts`).
