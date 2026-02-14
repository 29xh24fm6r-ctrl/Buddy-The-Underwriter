# Phase 11 — Decommission V1 Rendering Path (Keep Archival/Replay)

Owner: Buddy Core
Status: PLANNED
Depends on: Phase 10 complete (9fa0762)

## Objective
Remove all user-facing usage of Model Engine V1 for:
- spreads rendering (standard spread viewModel)
- underwriting metrics powering UI panels
- credit memo computed metric inputs

Keep V1 only for:
- archival rendering/replay for examiner/audit
- parity comparison (optional, internal only)
- controlled debug tools (admin-only)

## Flags
- MODEL_ENGINE_MODE=v2_primary (already exists; Phase 10)
- V1_RENDERER_DISABLED=true (new)
- V1_AUDIT_REPLAY_ENABLED=true (new, default true)
- V1_COMPARE_ENABLED=false|true (new; default false in prod post-Phase 11)

## Entry Criteria
- Phase 10 live with v2_primary via allowlists / global mode
- /api/deals/:dealId/underwrite is canonical and stable
- Smoke tests passing in prod
- No high-severity parity blocks on allowlisted real deals (or formally accepted)

## Exit Criteria (Phase 11 DONE)
- No user-facing route returns V1-rendered spreads or V1-derived metrics
- Any V1 execution is gated behind explicit audit/admin endpoints
- V1 renderer code path is unreachable from standard UI navigation
- CI check prevents reintroducing V1 user-facing imports/calls
- Production health remains green; smoke test asserts V1 not used

---

# 1) Define "User-Facing" Surfaces (Must Be V2 Only)
These must never invoke V1 once Phase 11 ships:
- /api/deals/[dealId]/spreads/standard (spreads render)
- cockpit metrics panels
- pricing/risk panels that read DSCR/LTV/debt service totals
- credit memo generation path (computed metrics + spreads summaries)
- readiness blockers that display computed underwriting numbers

Implementation rule:
- All surfaces must source computations from:
  GET /api/deals/[dealId]/underwrite
- No direct calls to V1 compute modules in UI routes/components.

---

# 2) Disable V1 In Standard Spread Route
In `standard/route.ts`:
- If V1_RENDERER_DISABLED=true:
  - forbid v1 or v2_shadow primary=v1 responses
  - require modeSelector resolves to v2_primary for user session routes
  - return 409 with structured error:
    { ok:false, error_code:"V1_RENDERER_DISABLED", message:"V1 rendering disabled; use V2 primary." }

Allow exceptions:
- If request is audit/admin replay endpoint only (separate route; see section 4)

Also emit event:
- MODEL_V1_RENDER_ATTEMPT_BLOCKED

---

# 3) Remove V1 Navigation + UI Hooks
- Remove any "view legacy spreads" links
- Ensure lifecycle nextAction / blockers never route to V1 pages
- If any "focus=spreads" or similar deep links exist, they must land on V2 page

Add a lightweight guard:
- When page loads, if MODE != v2_primary and V1_RENDERER_DISABLED=true:
  - show an internal error banner prompting support (should not happen)

---

# 4) Add Audit/Replay Only Endpoint (Explicitly Non-User-Facing)
Create:
- GET /api/admin/deals/[dealId]/underwrite/replay?v=1|2&snapshot_id=...

Constraints:
- Requires admin auth (bank staff role or internal)
- V1_AUDIT_REPLAY_ENABLED must be true
- Returns a "replay bundle":
  - outputs (spreads/metrics)
  - snapshot metadata
  - registry version/hash references
  - traceId

This endpoint is the ONLY allowed place to run V1 after Phase 11.

Emit events:
- MODEL_V1_AUDIT_REPLAY_SERVED
- MODEL_V2_AUDIT_REPLAY_SERVED

---

# 5) CI Guardrails (Prevent Regression)
Add a test/lint step that fails if user-facing routes import V1 renderer:
- disallow imports from `src/lib/model-engine/v1/**` in:
  - src/app/(app)/**
  - src/app/api/deals/** (except admin replay route)
  - src/components/deals/**

Implementation options:
- simple grep-based script in CI:
  - scripts/check-no-v1-user-facing.sh
- or eslint rule (heavier)

---

# 6) Observability Updates
Health endpoint enhancements:
- report:
  - v1_renderer_disabled: boolean
  - v1_invocations_last_24h (count)
  - v1_render_attempts_blocked_last_24h (count)
  - audit_replay_invocations (count)

Add event codes if needed:
- MODEL_V1_RENDER_ATTEMPT_BLOCKED
- MODEL_V1_USER_FACING_CALL_DETECTED (if guard trips)

---

# 7) Tests
- unit: mode selector respects V1_RENDERER_DISABLED (cannot resolve to user-facing v1)
- integration: standard spread route returns 409 when attempting v1 path
- integration: admin replay endpoint works (v1 allowed only there)
- CI script test: ensure it fails when a forbidden import is added

---

# 8) Rollout Plan
1) Deploy Phase 11 with V1_RENDERER_DISABLED=false initially
2) Flip V1_RENDERER_DISABLED=true in staging
3) Run smoke suite:
   - underwrite endpoint
   - standard spread render
   - verify no v1 used
4) Flip in prod:
   - V1_RENDERER_DISABLED=true
   - keep V1_AUDIT_REPLAY_ENABLED=true
   - set V1_COMPARE_ENABLED=false (optional)

---

# 9) Acceptance Checklist
- [ ] No user-facing V1 code path reachable
- [ ] Standard spread route blocks V1 when disabled
- [ ] Admin replay endpoint exists and is gated
- [ ] CI guard prevents reintroduction
- [ ] Health endpoint shows v1 disabled + counts
- [ ] Smoke tests pass in prod on 3 deals
