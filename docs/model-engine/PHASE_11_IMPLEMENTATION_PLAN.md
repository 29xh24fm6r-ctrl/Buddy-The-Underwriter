# Phase 11 — Implementation Plan (Post-Spec)

Spec commit: 5d81063

## 0) Production Validation Gate (Before Any V1 Blocking)
Goal: Prove Phase 10 stability on real deals using v2_primary allowlists.

Acceptance:
- >= 3 real deals run through:
  - /api/deals/:dealId/underwrite (primaryEngine=v2)
  - /api/deals/:dealId/spreads/standard (shadowMetadata present; v2_mode=v2_primary)
- No MODEL_V2_HARD_FAILURE events for allowlisted deals
- Parity: no repeated BLOCK on the same deal without explanation/acceptance
- Smoke test passes repeatedly over 24-48 hours (or agreed period)

Operational actions:
- Keep V1_RENDERER_DISABLED unset/false during this gate
- Allowlists:
  - V2_PRIMARY_DEAL_ALLOWLIST=<uuid,uuid,...>  OR
  - V2_PRIMARY_BANK_ALLOWLIST=<uuid,...>
  - (optional) MODEL_ENGINE_MODE=v2_primary for global later

Exit of Gate:
- Record a ledger event row in docs/PHASE_LEDGER.md: "Phase 10 validated on real deals"
- Then start PR1 of Phase 11

---

## 1) PR1 — V1_RENDERER_DISABLED Guard + Event (standard/route)
- Add flag V1_RENDERER_DISABLED=true/false
- If enabled:
  - block any attempt to serve V1-rendered output from the user-facing standard spread route
  - return structured 409:
    { ok:false, error_code:"V1_RENDERER_DISABLED", ... }
  - emit MODEL_V1_RENDER_ATTEMPT_BLOCKED

Notes:
- This guard must key off actual call paths:
  - direct calls to renderStandardSpreadWithValidation
  - any v1-mode selection from modeSelector

---

## 2) PR2 — Admin Replay Endpoint + Auth Gating
Add:
- GET /api/admin/deals/[dealId]/underwrite/replay?v=1|2&snapshot_id=...

Rules:
- Explicit admin auth required
- V1_AUDIT_REPLAY_ENABLED must be true
- V1 is allowed only here when V1_RENDERER_DISABLED=true

Emit:
- MODEL_V1_AUDIT_REPLAY_SERVED
- MODEL_V2_AUDIT_REPLAY_SERVED

---

## 3) PR3 — CI Guardrail (Target Real V1 Imports)
Replace the spec's placeholder path with reality:
- Block user-facing imports/usages of V1-rendering entrypoints:
  - renderStandardSpreadWithValidation (and any other V1-specific renderer helpers)
  - any v1-only builder functions for standard spread viewModel
- Scope:
  - src/app/(app)/**
  - src/app/api/deals/** (exclude admin replay route)
  - src/components/** (if applicable)

Implementation:
- scripts/check-no-v1-user-facing.sh (grep-based, deterministic)

---

## 4) PR4 — Health Counters + Smoke Assertions
Health:
- v1_renderer_disabled boolean
- count of blocked V1 attempts
- count of v1 audit replays
- underwrite endpoint mode summary (already partially exists)

Smoke:
- assert primaryEngine=v2
- assert no fallbackUsed unless intentionally simulated
- assert standard spread response indicates v2_primary

---

## Completion Criteria (Phase 11 "Implementation Done")
- Guard deployed and safe
- Admin replay exists and gated
- CI prevents reintroducing user-facing V1
- Health + smoke reflect V2-only user paths
