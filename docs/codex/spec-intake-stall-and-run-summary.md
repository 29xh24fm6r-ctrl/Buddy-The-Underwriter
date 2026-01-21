# Spec: Fix Intake Processing Stall + Exploration Run Summary + GCP WIF/GCS Verification

## Context / Observed
User created deal and uploaded documents. UI shows **"Intake init failed"** and nothing progresses.
Buddy Exploration Run Summary shows only:
- `page.ready · flightRecorder.route`

Yet the left timeline shows multiple events (user actions, sign uploads, etc.). The "Copy debug" JSON lacks a `runId`, so the summary cannot query a run-specific timeline.

A debug probe JSON exists (from UI "Copy debug") for deal:
- `dealId = 82b3c93b-9e06-4383-94a9-f64da65a23ea`
- `ctxStatus = 200`
- `pipelineOk = true`
- `stage = "intake"`
- `borrower.name = "Deal - 1/21/2026"`
- completeness zeros even after upload → suggests uploads not associated, or reconcile/auto-seed failed.

We recently updated GCP IAM/WIF principals/roles and Vercel env vars. Need explicit verification that prod runtime can:
- impersonate via WIF (no JSON key)
- access GCS bucket
- call Vertex/Gemini model
- and that Buddy backend handles failures with actionable errors.

## Objectives
A) Intake pipeline: uploaded docs are associated with deal, reconciled, checklist seeded, and stage advances (or at least shows progress with errors).
B) Exploration runs: timeline events are properly tagged with `runId`; Run Summary returns full timeline for that run.
C) Verification tooling: add a single command to validate end-to-end in production preview/prod.

## Non-goals
- UI redesign
- New doc classification model
- Changing auth providers

---

# A) Intake Processing Stall — Root Cause + Fix

## A1) Add a dedicated "intake status" endpoint with structured error
Create `GET /api/deals/:dealId/intake/status` returning:
- `ok: boolean`
- `dealId`
- `uploads`: counts (total, processed, pending)
- `checklist`: counts (required_total, received_required, missing_required)
- `stage`: current stage
- `lastError`: `{ code, message, at, meta } | null`
- `deps`: `{ gcs: ok|fail, vertex: ok|fail }` (best-effort lightweight)

Implementation notes:
- Pull latest ledger events for the deal to infer "lastError" and recent pipeline events.
- Ensure errors from GCS/Vertex are normalized (see A3).

## A2) Ensure upload → deal association is guaranteed
When user uploads docs from `/deals/new`:
- Confirm backend writes upload rows with `deal_id = dealId` (not null, not pending).
- Add guard: if upload row missing deal_id, fix and emit ledger event:
  - `deal.uploads.repaired` with count.

## A3) Normalize GCS/Vertex errors into actionable codes
Create `src/lib/google/errors.ts` mapping:
- GCS 403 => `GCS_PERMISSION_DENIED`
- GCS 404 bucket/object => `GCS_NOT_FOUND`
- ADC/WIF failure => `GOOGLE_AUTH_FAILED`
- Vertex 403 => `VERTEX_PERMISSION_DENIED`
- Vertex quota => `VERTEX_QUOTA`
- Default => `GOOGLE_UNKNOWN`

Ensure any intake failure stores:
- ledger event `deal.intake.failed` with normalized error and raw message (truncated).

## A4) Make auto-seed and reconcile endpoints emit spans + ledger events
On these endpoints (if present; otherwise add):
- `POST /api/deals/:dealId/auto-seed`
- `POST /api/deals/:dealId/uploads/reconcile`
- `POST /api/deals/:dealId/checklist/reconcile`

Guarantee each emits:
- trace span names: `auto-seed.POST`, `uploads.reconcile.POST`, `checklist.reconcile.POST`
- ledger events:
  - `deal.checklist.seeded`
  - `deal.uploads.reconciled`
  - `deal.checklist.reconciled`
  - `deal.intake.advanced` OR `deal.intake.failed`

## A5) Fix "Intake init failed" UX signal path
Wherever the UI reads/derives `intake init failed`:
- Must be backed by ledger `deal.intake.failed` or intake status endpoint.
- Add a "Retry intake" button in cockpit (dev-only ok) that calls:
  - `POST /api/deals/:dealId/auto-seed` then reconcile endpoints.
- Show returned normalized error if retry fails.

### Acceptance (A)
- New deal upload flow results in:
  - uploads count > 0
  - checklist seeded
  - stage remains intake but shows processing OR advances to next stage if designed
- If GCS/Vertex/IAM misconfigured, UI shows **explicit** error code (not "unexpected_error")
- `GET /api/deals/:dealId/intake/status` returns consistent JSON.

---

# B) Buddy Exploration Run Summary — Fix runId plumbing

## B1) Persist runId in Buddy session store
When user clicks "Start run":
- generate `runId = run_<epoch_ms>` (existing pattern ok)
- store in `buddySessionStore` and set as "active run"
- include `runId` in Buddy panel header and in "Copy findings" / "Copy debug" payload

## B2) Tag every flight recorder event with runId
All emitted events must include:
- `runId`
- `dealId` (if present)
- `route`
- `ts`
- `kind` (page.ready, user.action, api.result, pipeline.status, etc.)

If no active run, still emit events but with `runId: null`.

## B3) Run Summary must query by runId
Implement (or fix) endpoint used by "Run summary":
- `GET /api/_buddy/runs/:runId/summary`
It should return:
- `runId`
- `startedAt`
- `events[]` ordered by ts
- `counts` by kind
- `notes` (optional)

## B4) Copy debug payload must include runId
"Copy debug" in the UI must include:
- `runId`
- `dealId`
- `ctxStatus`
- `pipelineOk`
- `probe` payload

### Acceptance (B)
- Start run → click around → run summary includes:
  - page.ready
  - user actions
  - route changes
  - any api/pipeline status events
- Run summary never shows only page.ready unless literally no other events occurred.

---

# C) Add deterministic verification: prod can access GCS + Vertex via WIF

## C1) Add server-side diag endpoint (protected by builder token)
Create:
- `GET /api/_builder/verify/google`
Requires builder verify token (existing pattern).
Returns:
- `auth`: ok/fail
- `adc`: ok/fail (resolved credentials type)
- `gcs`: ok/fail (bucket list/read test)
- `vertex`: ok/fail (lightweight model call)
- `errors[]` normalized

Do NOT leak secrets; only return booleans and error codes.

## C2) Update scripts/verify-underwrite.mjs to include google verify
Add step:
- call `/api/_builder/verify/google`
- fail CI if any check is false

### Acceptance (C)
- Running verify script on preview/prod prints:
  - google verify ok
  - underwrite verify ok

---

# Implementation Checklist
- [ ] Add intake status endpoint
- [ ] Ensure upload association with dealId
- [ ] Normalize Google errors + ledger failure event
- [ ] Instrument auto-seed/reconcile with spans + ledger events
- [ ] Wire cockpit retry + surface normalized errors
- [ ] Add runId to Buddy session + event emitter
- [ ] Run summary endpoint queries by runId
- [ ] Copy debug includes runId
- [ ] Add builder google verify endpoint
- [ ] Extend verify scripts

---

# Tests
## Unit
- runId tagging: event payload contains runId after Start run
- summary endpoint returns ordered events for runId
- error normalization mapping cases

## Integration (local)
- create deal, upload docs, call auto-seed, reconcile → intake status reflects progress

## Prod smoke
- `/api/_builder/verify/google` returns all ok
- New deal upload progresses (no "intake init failed")
