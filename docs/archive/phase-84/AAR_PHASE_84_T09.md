# AAR — Phase 84 T-09 — Env + Roadmap reconciliation

**Date:** 2026-04-20
**Ticket:** T-09 (Wave 4 housekeeping)
**Commit:** `8265b3ee`
**Completion event:** `buddy_system_events` id `23426063-b24d-4563-bb47-44b953807dee`

## 1. Scope

Reconcile `.env.example` + `BUDDY_PROJECT_ROADMAP.md` against current Vercel env state and post-T-10A repo structure. "Reconcile, not rewrite" — surgical edits preserving all still-accurate content.

## 2. Vercel env audit (names only, presence/absence)

**Limitation:** CLI environment does not have Vercel dashboard credentials. I did not run `vercel env ls`. What follows is the local-state audit (repo `.env.example` + local `.env.local` + local `.env`) cross-referenced against `process.env.*` greps in `src/`. The Vercel production-state check is queued for human verification as 5 open questions in Section 5 below.

### Local-state audit (source of ground truth for `.env.example`)

Pre-work grep against `src/lib/pulseMcp/`, `src/lib/omega/`, `src/lib/pulse/forwardLedgerCore.ts`, `src/app/api/pulse/ingest/route.ts`, `src/lib/mcp/server.ts`, and `scripts/gcp/worker-*.sh` revealed **five distinct subsystems** where the v2 spec assumed fewer:

| Group | Purpose | Env vars | Code location |
|---|---|---|---|
| A | Inbound MCP — Buddy-as-server for Claude Desktop | `BUDDY_MCP_API_KEY` | `src/lib/mcp/server.ts` |
| B | Outbound Omega — advisory invocation (Phase 79) | `OMEGA_MCP_ENABLED`, `OMEGA_MCP_KILL_SWITCH`, `OMEGA_MCP_URL`, `OMEGA_MCP_API_KEY`, `OMEGA_MCP_TIMEOUT_MS` | `src/lib/omega/invokeOmega.ts` |
| C | Outbound Pulse MCP — Next.js side | `PULSE_MCP_ENABLED`, `PULSE_MCP_URL`, `PULSE_MCP_API_KEY`, `PULSE_MCP_TIMEOUT_MS`, `PULSE_MCP_STRICT` | `src/lib/pulseMcp/config.ts`, `src/app/api/pulse/ingest/route.ts` |
| D | Outbound Pulse MCP — Cloud Run worker side | `PULSE_MCP_URL`, `PULSE_MCP_KEY` (note: `_KEY`, not `_API_KEY`) | `scripts/gcp/worker-deploy.sh`, `worker-preflight.sh` |
| E | Telemetry forwarder — Next.js → Cloud Run direct, Bearer-authed | `PULSE_BUDDY_INGEST_URL`, `PULSE_INGEST_TOKEN` (Bearer), `PULSE_TELEMETRY_ENABLED` kill switch | `src/lib/pulse/forwardLedgerCore.ts` |
| F | Telemetry receiver — HMAC-signed inbound events | `PULSE_BUDDY_INGEST_SECRET` (HMAC), `PULSE_MCP_URL` | `src/app/api/pulse/ingest/route.ts` |

Group D's deliberate `PULSE_MCP_KEY` vs Group C's `PULSE_MCP_API_KEY` is enforced by a test at `src/lib/pulseMcp/__tests__/connection.test.ts` ("Must NOT use `PULSE_MCP_API_KEY` (canonical name is `PULSE_MCP_KEY`)" — test-asserted drift). Phase 84.1 follow-up: decide whether to consolidate.

## 3. `.env.example` changes applied

### Added
- `CLERK_JWT_KEY=` block with explanatory comment — zero-round-trip Clerk session verification, eliminates cold-start 504 risk
- `OMEGA_MCP_*` block (5 vars: ENABLED, KILL_SWITCH, URL, API_KEY, TIMEOUT_MS) — outbound Omega advisory invocation
- `PULSE_TELEMETRY_ENABLED` + `PULSE_INGEST_TOKEN` — Bearer-authed telemetry forwarder (Group E)
- Architectural comment block at the top of the MCP section documenting all 5 subsystems and their code locations, so future readers don't re-derive the taxonomy

### Removed
- `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`, `OPENAI_REALTIME_TRANSCRIBE_MODEL` (Phase 51 moved voice fully to Gemini Live on Fly.io; these vars have not been read by `src/` since)
- Duplicate TWILIO block (second copy at the end of the file; kept the first block at ~line 62 with context)

### Changed
- `USE_GEMINI_OCR=false` → `USE_GEMINI_OCR=true` (default flipped — production has had `true` for months; spec drift)
- `GEMINI_OCR_MODEL=gemini-2.0-flash-exp` → pointer comment referencing `src/lib/gatekeeper/geminiClassifier.ts` + commented-out blank (the model string auto-evolves; hardcoding in an `.env.example` ages poorly)
- `GEMINI_MODEL=gemini-1.5-flash` → `GEMINI_MODEL=gemini-3-flash-preview`
- `OPENAI_API_KEY` comment reframed: "chatAboutDeal only (Phase 51 moved voice to Gemini). If you removed OPENAI_REALTIME_* here, that's intentional — do not re-add."

### Preserved unchanged
- Full `PULSE_MCP_*` block (Group C) — `.env.example` already had this block correctly; pre-work initially misdiagnosed it as orphan, grep proved otherwise
- `PULSE_BUDDY_INGEST_URL` + `PULSE_BUDDY_INGEST_SECRET` — HMAC receiver (Group F), still in active use
- `BUDDY_MCP_API_KEY` — inbound MCP (Group A)
- `OPENAI_API_KEY` (Group: still used for chatAboutDeal per roadmap "OpenAI is now used for one workload only")
- All Supabase, Clerk (except new JWT_KEY addition), Google Cloud, Twilio (dedupe only), Sentry, Honeycomb vars

## 4. `BUDDY_PROJECT_ROADMAP.md` changes applied

Surgical edits per spec. No wholesale rewrite.

1. **Header block updated** — "Last Updated: April 20, 2026" + "Phase 84 closing (9 of 10 tickets complete)" + pointer to `docs/archive/phase-84/` and post-T-10A `docs/archive/phase-pre-84/`.
2. **Phase 84 narrative block added** before the Progress Tracker — documents 10-ticket scope, meta-finding (zero non-test deals → T-08-G), and Wave 1 lesson (T-02/T-03/T-06 all had partial existing-state fixes).
3. **Progress Tracker rows appended** for phases that shipped after 58A — Phase 65A (Omega panel), Phase 68-70, Phase 71-75 (agent group + governance), Phase 78-83 (memo/joint-filer/proof-of-truth/classification/ignite), Phase 84 (🟡 closing).
4. **Samaritus line struck through** — "DELETED from prod during pre-Phase-84 cleanup. New canonical test deal TBD. See Phase 84.1 backlog (T-08-G production-activity baseline)."
5. **Next Phases list reordered** — Phase 84.1 backlog (gated on T-08-G) added at position 1, existing 5 priorities shifted to 2-6.

### Preserved unchanged per spec
- Vision + Accuracy Philosophy sections
- Intelligence Stack diagram
- Build Principles list
- Technical Stack table
- AI Provider Inventory
- Mid-document operational/lesson sections

## 5. Open questions surfaced (pending human verification from Vercel dashboard)

1. **`OMEGA_MCP_ENABLED` set in Vercel prod?** If not "1", every Omega advisory call at `/api/deals/[dealId]/underwrite/state` returns `{ok:false, error:"disabled"}` silently and the T-07 fallback path runs unconditionally — which is the behavior we want until Pulse implements `omega://*` methods natively, but worth confirming.
2. **`PULSE_TELEMETRY_ENABLED` set in Vercel prod?** If not "true", `forwardLedgerCore.ts` skips forwarding — `deal_pipeline_ledger` rows land locally but never reach Cloud Run.
3. **`CLERK_JWT_KEY` set in Vercel prod?** userMemories suggests yes; verify. Missing key would force Clerk BAPI round-trip on every auth check.
4. **`PULSE_INGEST_TOKEN` (Bearer, Group E) AND `PULSE_BUDDY_INGEST_SECRET` (HMAC, Group F) both set?** Both are required for the two distinct telemetry paths; neither is a fallback for the other.
5. **Any `PULSE_MCP_*` vars currently set?** If absent, the Next.js-side Pulse MCP client (Group C) is inert. If the worker uses `PULSE_MCP_KEY` and Vercel has only `PULSE_MCP_API_KEY`, the Cloud Run worker would 401 — confirm split is honored in Vercel config.

## 6. Spec deviations

1. **v2 T-09 said "add OMEGA_MCP_*" AND "spec drift uses PULSE_MCP_*"** — misleading framing. Reality: both systems coexist, they serve different purposes (outbound Omega advisory vs outbound Pulse MCP tools), and removing either would break real code paths. Spec corrected via the 5-subsystem taxonomy documented in the `.env.example` architectural comment block.

2. **v2 did not mention Groups E + F telemetry distinctness** — `PULSE_BUDDY_INGEST_SECRET` (HMAC receiver) is a different auth shape than `PULSE_INGEST_TOKEN` (Bearer forwarder). Pre-work almost deleted the HMAC secret as "misnamed"; actually both are needed for opposite directions. Documented in the taxonomy block.

3. **Canonical naming for worker-side Pulse MCP** — `PULSE_MCP_KEY` (worker, Cloud Run) vs `PULSE_MCP_API_KEY` (Next.js, Vercel). Deliberate split, enforced by `connection.test.ts`. Noted in the comment block; Phase 84.1 follow-up to decide permanence.

4. **Progress Tracker gap** — v2 spec expected AAR paths to be cited by specific SHA. Reality: many pre-84 AARs are now at `docs/archive/phase-pre-84/` after T-10A. Cited by path, not SHA. SHAs are recoverable via `git log --follow` against the new path.

5. **Vercel env audit not performed from CLI** — no Vercel credentials available in the execution environment. Local `.env.local` + `.env` used as proxies. Queued 5 questions for human verification in Section 5 above. Does not block T-09 closure because the diff is against `.env.example` (a repo artifact), not against Vercel itself.

## 7. Phase 84.1 follow-ups

1. **Verify `OMEGA_MCP_ENABLED` is "1" in Vercel prod.** If not, every Omega advisory call returns `{ok:false, error:"disabled"}` silently.
2. **Investigate whether the `PULSE_MCP_KEY` / `PULSE_MCP_API_KEY` naming split (worker vs app) is intentional permanence or accumulated drift.** The test file enforces it, but test-enforced drift is still drift worth revisiting.
3. **Clarify whether `forwardLedgerCore.ts` (Bearer → Cloud Run direct) and `/api/pulse/ingest/route.ts` (HMAC receiver) are meant to coexist long-term or one supersedes the other.** Current state wires both paths; a future consolidation could reduce surface area.
