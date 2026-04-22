# Pulse + Omega Prime Integration — Diagnostic Findings (2026-04-22)

**Scope:** Read-only execution of [specs/diagnostic-pulse-omega/SPEC.md](SPEC.md), all five tracks. No code, config, data, or signals were modified.
**Author:** Claude Code on behalf of Matt.
**Evidence:** Buddy production Supabase (via MCP), Buddy repo (main @ `96bef58f`), Vercel project `prj_cJ5hZ4lRRoVq5MqDTyP2fXVkbXlt`, live HTTP probes against `https://pulse-mcp-651478110010.us-central1.run.app`.

---

## Summary table

| Layer | State | Last success | Root cause | Design intent | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Pulse outbox → Pulse | DELIVERED (semantics uncertain) | 2026-04-22 12:18 (continuous) | `delivered_to='pulse'` is set on any 2xx; target URL almost certainly returns 200 regardless of body (Pulse MCP root endpoint is a discovery handler that returns 200 for any POST). 743 events in 7d, zero persisted in any observable downstream table. | Durable, async event forwarder → Pulse governance/observer ledger. PR #823 / commit `881ace13`. | **INVESTIGATE FURTHER** — Matt to confirm the actual `PULSE_BUDDY_INGEST_URL` value. If it's the MCP root, the path is effectively black-holing events. If it points elsewhere, verify the destination table. |
| Pulse fastlane MCP | 100% DISABLED (code works, env not set) | never (see §2) | `PULSE_MCP_ENABLED` not set in Vercel → `callTool()` early-returns `{ok:false, error:"pulse_mcp_disabled"}`. Additionally, the tool it calls — `buddy_event_ingest` — **does not exist** on the deployed Pulse MCP (40 tools listed, none by that name). Even if enabled, it would fail. | Low-latency in-request mirror of outbox events. Never mandatory; outbox is system of record. | **RETIRE** (both the fastlane code and the ambient `pulse.forwarding_failed` signal). The design assumed a tool name that was never deployed, and the canonical path (outbox) covers the use case. See §2 for details. |
| Omega MCP | 100% FAILING (53/53 in 7d, all paths, `Method not found`) | never (see §3) | **Client-side JSON-RPC contract error.** `invokeOmega.ts` sends `method: "omega://events/write"` etc. directly. Pulse MCP JSON-RPC only recognizes `tools/list` and `tools/call`. Proper form is `method: "tools/call", params: {name: "buddy_ledger_write", arguments: {...}}`. The entire `omega://` namespace is **client-side fiction** — zero Omega methods exist on the server. | Advisory state, confidence score, trace drawer for cockpit "Intelligence" tab (Phase 65A + Phase 79). Advisory-only, SR 11-7 wall — must never block pipeline. | **REPAIR** — rewrite `src/lib/omega/invokeOmega.ts` to speak MCP `tools/call` and map the five `omega://` resources to real Pulse tools (`buddy_ledger_write`, `state_inspect`, `state_confidence`, `observer_query`). Or **RETIRE** if the advisory surface is no longer a priority. UI already degrades silently — no user impact either way. |
| `pulse_*` schema tables | 37 base tables empty, 1 view working | never (37 tables); 2026-03-06 (view's source stopped) | Tables are Pulse's own schema co-tenanting Buddy's Supabase project. **Zero Buddy code reads or writes any of them.** Not created by Buddy migrations. `pulse_projects` has a single 2026-04-16 "Burn-In Test Project" row. | Schema for the separate Pulse runtime (missions, episodes, capture sessions, etc.). Not Buddy's concern. | **RETIRE (from Buddy's perspective)** — document the co-tenancy contract (Pulse owns `pulse_*`, Buddy owns `buddy_*`). No Buddy action required until/unless the Pulse team drops them. |

---

## Track 1 findings — Pulse Outbox / Batch Forwarder

### Code paths identified

Four independent forwarders exist; they use overlapping env vars but different auth schemes:

| Forwarder | Location | Auth | Source table | Target env var |
| --- | --- | --- | --- | --- |
| Vercel cron — pulse-outbox | [src/lib/workers/processPulseOutbox.ts:152](../../src/lib/workers/processPulseOutbox.ts#L152) + [src/app/api/workers/pulse-outbox/route.ts](../../src/app/api/workers/pulse-outbox/route.ts) | `Authorization: Bearer ${PULSE_INGEST_TOKEN}` | `buddy_outbox_events` | `PULSE_BUDDY_INGEST_URL` |
| Vercel cron — forward-ledger | [src/lib/pulse/forwardLedgerCore.ts:208](../../src/lib/pulse/forwardLedgerCore.ts#L208) | `Authorization: Bearer ${PULSE_INGEST_TOKEN}` | `deal_pipeline_ledger` | `PULSE_BUDDY_INGEST_URL` |
| Observer events | [src/lib/telemetry/observerEvents.ts:103](../../src/lib/telemetry/observerEvents.ts#L103) | HMAC `x-pulse-signature` w/ `PULSE_BUDDY_INGEST_SECRET` | (fired inline from error/degraded paths) | `PULSE_BUDDY_INGEST_URL` |
| Cloud Run daemon — buddy-core-worker | [services/buddy-core-worker/src/index.ts:88](../../services/buddy-core-worker/src/index.ts#L88) | `Authorization: Bearer ${PULSE_MCP_KEY}` + `x-pulse-mcp-key` | `buddy_outbox_events` | `PULSE_MCP_URL` (tool `buddy_event_ingest`) |
| `/api/pulse/ingest` (receiver) | [src/app/api/pulse/ingest/route.ts](../../src/app/api/pulse/ingest/route.ts) | HMAC `x-pulse-signature` | (N/A — receives) | Outbound to `PULSE_MCP_URL/mcp` via `tools/call buddy_ledger_write` |

Vercel cron schedule ([vercel.json](../../vercel.json)): `pulse-outbox` every 2 min, `cron-forward-ledger` every 2 min.

### Production state (Buddy Supabase, as of 2026-04-22 ~20:15 UTC)

`buddy_outbox_events` — 1448 rows total, grouped by outcome:

| `delivered_to` | count | first_created | last_created |
| --- | ---: | --- | --- |
| `pulse` | **743** | 2026-02-17 | 2026-04-22 12:17 |
| `doc_extraction_worker` | 204 | 2026-03-12 | 2026-04-22 |
| `intake_processor` | 137 | 2026-02-25 | 2026-04-22 |
| `skipped_already_terminal` | 28 | 2026-02-28 | 2026-03-12 |
| `NULL` (dead-letter, all `HTTP 401`) | **336** | 2026-01-30 | 2026-02-17 |

`deal_pipeline_ledger` — `pulse_forwarded_at` set on 2849 rows (all between 2026-04-15 and 2026-04-22). Zero dead-lettered, zero unsuccessful attempts. Implies the ledger forwarder ran for the first time on 2026-04-15 and has been consistently hitting 2xx since.

All 743 `delivered_to='pulse'` rows have `attempts=0, last_error=NULL, claim_owner=NULL` — i.e. first-try 2xx. The cron worker marks `claim_owner=null` on success (see [processPulseOutbox.ts:168-171](../../src/lib/workers/processPulseOutbox.ts#L168-L171)).

### Dead-letter cohort

336 dead-lettered rows, created 2026-01-30 → 2026-02-17, all with `last_error='HTTP 401'`. Zero rows since 2026-02-17. Conclusion: at some point on/around 2026-02-17 either (a) an env var was fixed, (b) the ingest endpoint was changed to permissively accept the request, or (c) the target URL was changed. The 336 events remain orphaned — none were retried after the "fix." SPEC.md §3 already flagged this.

### Where do deliveries actually land?

This is the most important question of Track 1 and the answer is **uncertain — possibly nowhere**.

- `PULSE_BUDDY_INGEST_URL` and `PULSE_INGEST_TOKEN` are not directly observable (I don't have Vercel env read access). Behavior-based inference:
  - Worker mints a `claim_owner='pulse-outbox-${Date.now()}'`, POSTs body `{event_code, deal_id, bank_id, actor_id, status, payload, emitted_at}` with `Authorization: Bearer`.
  - Two candidate hostnames appear in-repo: `pulse-mcp-651478110010.us-central1.run.app` (Omega/Pulse MCP) and Buddy's own `/api/pulse/ingest`.
  - **Neither candidate matches the outbox's auth+shape contract.** Buddy's `/api/pulse/ingest` and Pulse MCP's `/ingest/buddy` both require HMAC `x-pulse-signature`, not Bearer, and both expect different payload schemas (see `isValidLedgerPayload` / `isValidObserverPayload` in [services/pulse-mcp/src/routes/ingestBuddy.ts:22-42](../../services/pulse-mcp/src/routes/ingestBuddy.ts#L22-L42)).
  - Live probe of `pulse-mcp-651478110010.us-central1.run.app`:
    - `POST /` with arbitrary body → **HTTP 200 with tool-list JSON discovery response** (Content-Length ≈ 16 KB). The root endpoint is a discovery handler that ignores the body.
    - `POST /ingest/buddy` with no HMAC → **HTTP 401 `{"error":"unauthorized"}`**.
    - `POST /ingest`, `/events`, `/api/pulse/ingest` → 404.
- **Most likely hypothesis:** `PULSE_BUDDY_INGEST_URL` points at `https://pulse-mcp-651478110010.us-central1.run.app/` (the root). Every POST gets 200, `res.ok` is true, outbox marks the row `delivered_to='pulse'`. **Events are being black-holed at the root discovery handler.** The fact that `res.text()` on success is the 16 KB tool list and nothing parses it matches this theory.
- Supporting evidence: `buddy_ledger_events` (the logical downstream for a "ledger" tool call) contains **201 rows, all written in a single 8-minute window on 2026-03-06** (21:38-21:46 UTC). First event is `event_key='pulse.connectivity_test'`. This was a one-off wiring smoke test; no traffic since. If the outbox were actually driving `buddy_ledger_write` on Pulse MCP (which rolls back to this same table via shared Supabase), these counts would be in the thousands.

### Contradiction with spec's assumption

SPEC.md §3 Preliminary Finding #2 asserted that `buddy_ledger_events` was "Pulse's receiving table." This is **half true, half misleading**. `buddy_ledger_events` IS what Pulse MCP's `buddy_ledger_write` tool writes to (they share the Supabase instance via the `services/pulse-mcp` code path). But it is not what the *outbox* cron writes to, because the outbox never reaches the `tools/call` code path — the outbox goes direct-HTTP to `PULSE_BUDDY_INGEST_URL` with Bearer auth, not through the MCP JSON-RPC wire, not through `/api/pulse/ingest`.

The 2026-03-06 burst in `buddy_ledger_events` appears to have come from the `/api/pulse/ingest` HMAC path being exercised once, then never again. That branch is alive in code ([src/app/api/pulse/ingest/route.ts](../../src/app/api/pulse/ingest/route.ts)) but has no current caller emitting events in the expected HMAC shape at volume.

### Track 1 Unknown / verification needed

- Actual `PULSE_BUDDY_INGEST_URL` value (Matt can `vercel env pull`).
- Actual downstream outcome of a delivered event — if the hypothesis above is correct, nothing. If wrong, identify the real receiver.

---

## Track 2 findings — Pulse Fastlane MCP Client

### Surface area

- [src/lib/pulseMcp/client.ts](../../src/lib/pulseMcp/client.ts) — `PulseMcpClient` class + standalone `callTool()` / `listTools()`.
- [src/lib/pulseMcp/config.ts](../../src/lib/pulseMcp/config.ts) — reads `PULSE_MCP_ENABLED`, `PULSE_MCP_URL`, `PULSE_MCP_API_KEY`, `PULSE_MCP_TIMEOUT_MS`, `PULSE_MCP_STRICT`.
- [src/lib/pulseMcp/emitPipelineEvent.ts](../../src/lib/pulseMcp/emitPipelineEvent.ts) — writes to outbox (canonical) then fire-and-forgets to fastlane.
- [src/lib/outbox/tryForwardToPulse.ts:23](../../src/lib/outbox/tryForwardToPulse.ts#L23) — the fastlane itself; calls `callTool("buddy_event_ingest", {...})`.

### Call sites of `emitPipelineEvent` (the only consumer of the fastlane)

7 call sites emit 5 event kinds:

| Call site | Event kind |
| --- | --- |
| [src/lib/documents/ingestDocument.ts:162](../../src/lib/documents/ingestDocument.ts#L162) | `document_uploaded` |
| [src/lib/artifacts/processArtifact.ts:2153](../../src/lib/artifacts/processArtifact.ts#L2153) | `artifact_processed` |
| [src/lib/deals/readiness.ts:216](../../src/lib/deals/readiness.ts#L216) | `readiness_recomputed` |
| [src/app/api/deals/[dealId]/checklist/reconcile/route.ts:61](../../src/app/api/deals/[dealId]/checklist/reconcile/route.ts#L61) | `checklist_reconciled` |
| [src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts](../../src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts) | `checklist_reconciled` |
| [src/app/api/deals/[dealId]/intake/confirm/route.ts](../../src/app/api/deals/[dealId]/intake/confirm/route.ts) | `checklist_reconciled` |
| [src/app/api/deals/[dealId]/documents/[attachmentId]/checklist-key/route.ts](../../src/app/api/deals/[dealId]/documents/[attachmentId]/checklist-key/route.ts) | `manual_override` |

### Outbox vs fastlane overlap

Same `eventId` (UUID v7), same `kind`, same filtered `payload`. They are two wires for the same truck; the outbox is the canonical one. Explicit contract: "outbox always writes regardless of `PULSE_MCP_ENABLED`" ([src/lib/pulseMcp/__tests__/connection.test.ts:88-96](../../src/lib/pulseMcp/__tests__/connection.test.ts#L88-L96)).

### Why is it unconfigured?

`PULSE_MCP_ENABLED` is not set. Observable from the DB: 55 `pulse.forwarding_failed` signals in the last 7 days, 100% with `payload.error = 'pulse_mcp_disabled'` and `payload.source = 'fastlane'`. This error is only emitted when `callTool()` early-returns from [client.ts:99-101](../../src/lib/pulseMcp/client.ts#L99-L101).

Git history:
- `tryForwardToPulse.ts` introduced in **commit `ffdb504b` on 2026-01-30** ("feat: Buddy → Pulse Omega event bridging (fast lane + canonical worker)").
- `emitPipelineEvent.ts` introduced in **commit `8b3c5e47` on 2026-01-29** ("feat: durable outbox + always-on Cloud Run worker for Buddy→Pulse").
- No "disable fastlane" or "revert" commit exists. The fastlane was written and shipped without the env flag ever being flipped on in production.

### Second-order finding — the tool the fastlane calls does not exist

The fastlane's only consumer calls `callTool("buddy_event_ingest", ...)` ([tryForwardToPulse.ts:23](../../src/lib/outbox/tryForwardToPulse.ts#L23)).

I listed the 40 tools currently exposed by the deployed Pulse MCP via `POST / {"method":"tools/list"}`:

```
action_execute, action_propose, buddy_ledger_deal, buddy_ledger_flow_health,
buddy_ledger_list, buddy_ledger_write, context_current, decision_list,
decision_recent, decision_record, design_check_coherence, design_check_evolution,
design_history, design_propose_screen, design_refine_screen,
design_trends_rules_for_context, mcp_tick, memory_add, memory_list,
memory_recent, memory_search, observer_query, persona_calibrate,
persona_shape, plan_propose, plan_propose_patch, plan_simulate,
state_confidence, state_drafts, state_inspect, state_outcomes,
state_propose_patch, state_signals, system_schema_health,
system_smoke_test, trigger_upsert, triggers_list, trust_state,
trust_state_set, voice_trends_current
```

**There is no `buddy_event_ingest`.** The fastlane, if enabled today, would 200-but-fail-silently (Pulse MCP's `/call` returns success/error envelope — unknown tool is an `error`, which in Buddy's current code path becomes another `pulse.forwarding_failed` signal with a different error code).

The observably named equivalent is `buddy_ledger_write`, which expects `{event_type, deal_id, status, payload}`.

### Track 2 Unknown / verification needed

- Whether the buddy-core-worker Cloud Run service is deployed. It also calls `buddy_event_ingest` (see [services/buddy-core-worker/src/index.ts:271](../../services/buddy-core-worker/src/index.ts#L271)). If it is deployed and running, its heartbeat (`mcp_tick`) would succeed but its outbox forwarding would fail on the same tool-name mismatch. The zero-count of `claim_owner != null` rows in the outbox suggests this daemon is **not** currently draining rows — either not deployed, or its `PULSE_MCP_KEY` is wrong, or `PULSE_MCP_URL` is wrong.

---

## Track 3 findings — Omega Prime MCP (the `Method not found` mystery)

### Omega call sites in Buddy

Five distinct `omega://` resources are invoked by five files:

| Caller | Resource (JSON-RPC method) | Purpose |
| --- | --- | --- |
| [src/core/omega/OmegaAdvisoryAdapter.ts:29](../../src/core/omega/OmegaAdvisoryAdapter.ts#L29) | `omega://state/underwriting_case/{dealId}` | Fetch advisory state for cockpit |
| [src/core/omega/OmegaAdvisoryAdapter.ts:38](../../src/core/omega/OmegaAdvisoryAdapter.ts#L38) | `omega://confidence/evaluate` | Confidence score for badge |
| [src/core/omega/OmegaAdvisoryAdapter.ts:47](../../src/core/omega/OmegaAdvisoryAdapter.ts#L47) | `omega://traces/{sessionId}` | Trace drawer (builder mode) |
| [src/buddy/server/writeBuddySignal.ts](../../src/buddy/server/writeBuddySignal.ts) → [src/lib/omega/mirrorEventToOmega.ts:84](../../src/lib/omega/mirrorEventToOmega.ts#L84) | `omega://events/write` | Mirror all Buddy signals into Omega |
| [src/app/api/examiner/portal/deals/[dealId]/route.ts:125](../../src/app/api/examiner/portal/deals/[dealId]/route.ts#L125) | `omega://state/borrower/{id}` | Examiner portal (not yet observed firing in prod) |
| (observed once, source unknown) | `omega://advisory/deal-focus` | 3 ledger rows, all failed |

### Observed production activity, last 7 days (`buddy_signal_ledger`)

```
omega.invoked    53  (2026-04-15 20:50 → 2026-04-22 13:37)
omega.failed     53  (same window, all `omega_rpc_error: Method not found`)
omega.succeeded   0
omega.timed_out   0
omega.killed      0
```

Distribution by resource:

| resource | invoked | failed |
| --- | ---: | ---: |
| `omega://state/underwriting_case/<dealId>` | 15 | 15 |
| `omega://traces/<dealId>` | 15 | 15 |
| `omega://confidence/evaluate` | 15 | 15 |
| `omega://events/write` | 5 | 5 |
| `omega://advisory/deal-focus` | 3 | 3 |

Three distinct deal IDs are covered. **100% failure rate. Zero successes in Buddy's history.**

### Root cause (definitively identified)

Live introspection of the deployed server at `https://pulse-mcp-651478110010.us-central1.run.app`:

- `POST / {"method":"tools/list"}` → **200, returns 40 MCP tools.** Works without auth for discovery.
- `POST / {"method":"tools/call","params":{"name":"mcp_tick","arguments":{}}}` → 401 `{"code":-32600,"message":"Invalid or missing x-pulse-mcp-key"}`. Auth required, but the method is recognized.
- `POST / {"method":"omega://events/write","params":{}}` → **400 `{"code":-32601,"message":"Method not found"}`**.
- `POST / {"method":"resources/list"}` → 400 "Method not found". Server does not implement MCP Resources; only MCP Tools.

The server speaks MCP JSON-RPC with two recognized methods: `tools/list` and `tools/call`. Buddy's code in [src/lib/omega/invokeOmega.ts:144](../../src/lib/omega/invokeOmega.ts#L144) sends the resource URI as the JSON-RPC `method` directly:

```ts
const body = JSON.stringify({
  jsonrpc: "2.0",
  id: requestId,
  method: resource,   // e.g. "omega://events/write"
  params: payload ?? {},
});
```

This is simply **wrong**. The correct form is:

```ts
method: "tools/call",
params: { name: <tool name>, arguments: <payload> }
```

### Contract gap between Buddy's mapping and reality

[docs/omega/mapping.json](../../docs/omega/mapping.json) documents 18 `buddy.*` event types mapped to the single resource `omega://events/write`, 5 state view URIs, and 2 constraint URIs. **None of these exist as registered methods on the server.** The entire `omega://` namespace is client-side fiction.

Mapping proposed (if REPAIR is chosen):

| Buddy-side intent | Buddy's current call | Real Pulse MCP tool |
| --- | --- | --- |
| Mirror Buddy signal to Pulse | `omega://events/write` | `buddy_ledger_write` (args: `event_type, status, deal_id, payload`) |
| Read advisory state for a deal | `omega://state/underwriting_case/<id>` | `state_inspect` (args: optional `target_user_id`) — likely needs a new purpose-built tool |
| Confidence evaluation | `omega://confidence/evaluate` | `state_confidence` |
| Traces for a session | `omega://traces/<id>` | `observer_query` (args: `event_type, target_user_id, limit`) |

The `state_inspect` / `observer_query` shapes don't perfectly match what `OmegaAdvisoryAdapter.ts` consumes today — the REPAIR path would need a schema-mapping layer either in Buddy or a new thin tool on Pulse MCP.

### User-visible impact

`OmegaAdvisoryAdapter.ts` returns a sentinel `{ confidence: -1, advisory: "", riskEmphasis: [], stale: true, staleReason: "Omega returned no data" }` on failure. Three cockpit components consume this:

- [src/components/deal/OmegaConfidenceBadge.tsx](../../src/components/deal/OmegaConfidenceBadge.tsx) — renders `null` if `confidence < 0 && stale`. Invisible.
- [src/components/deal/OmegaAdvisoryPanel.tsx](../../src/components/deal/OmegaAdvisoryPanel.tsx) — renders `null` if no advisory and not in builder mode. Invisible.
- [src/components/deal/OmegaTraceDrawer.tsx](../../src/components/deal/OmegaTraceDrawer.tsx) — builder-mode only.

**Users see no broken UI.** The cockpit "Intelligence" tab falls back to `ai_risk_runs` synthesis ([Phase 65A AAR](../../docs/archive/phase-pre-84/AAR_PHASE_65A_OMEGA_PANEL.md) lines 62-68). The most recent `ai_risk_runs` row for the visible test deal is from Mar 14 — i.e. the cockpit has been showing a risk grade that's 5+ weeks stale and nobody has noticed, because the Omega advisory (when working) would be layered over it as an enhancement.

### Track 3 Unknown / verification needed

- Whether a previously-deployed Pulse MCP build ever exposed `omega://` methods and was removed. No evidence in-repo suggests it did.
- Whether Matt wants the Omega advisory surface back (Phase 79 wired it; no AAR retires it; roadmap D2 flags "investigate" but hasn't prioritized fix).

---

## Track 4 findings — pulse_* schema tables

### Inventory

38 `pulse_*` relations in public schema: 37 BASE TABLES, 1 VIEW (`pulse_active_signals`).

Row counts: all tables are empty except `pulse_projects` which has 1 row — the 2026-04-16 "Burn-In Test Project" (user_id `b0000000-...-b00000000001`). This is burn-in / smoke-test data, not real traffic.

### Ownership: Pulse schema is NOT created by Buddy

Searching `supabase_migrations.schema_migrations` in the Buddy project: only 3 migrations mention `pulse`:

| Version | Name | Effect |
| --- | --- | --- |
| 20260129000003 | `pulse_ledger_forwarding` | Adds columns to `deal_pipeline_ledger` only |
| 20260129000004 | `pulse_ledger_forwarding_hardening` | Adds indexes + more columns to `deal_pipeline_ledger` |
| 20260130000001 | `002_pulse_signals_view` | `CREATE OR REPLACE VIEW pulse_active_signals AS SELECT ... FROM buddy_ledger_events` |

**Zero Buddy migrations create `pulse_missions`, `pulse_episodes`, etc.** The 37 base tables were created outside of Buddy's migration system, almost certainly by the Pulse team's own schema management against the same shared Supabase instance.

### Buddy code access to pulse_* tables

Zero reads, zero writes. Grep of `src/` for `.from("pulse_` returns only matches to `pulse_forward_*` columns on `deal_pipeline_ledger` — not the pulse_* tables themselves.

`services/pulse-mcp/src/` (the in-repo skeleton) does not read them either — it reads `buddy_ledger_events`, `buddy_observer_events`, `buddy_deal_state`, `buddy_incidents`. The in-repo Pulse MCP service is a different codebase (or much older) than the one actually deployed at `pulse-mcp-...run.app`. The deployed service exposes 40 tools; the in-repo one exposes 3 routes.

### Cross-contamination risk

Low from a correctness standpoint. There is no code path in Buddy that silently fails due to an empty `pulse_*` table. The one view `pulse_active_signals` is defined in Buddy migrations and reads from `buddy_ledger_events` — which is stale since 2026-03-06 (201 rows, then nothing). If any UI consumed `pulse_active_signals`, it would see an empty result; nothing does.

The larger risk is **schema drift**: Pulse's team can ALTER/DROP their tables in the shared DB without coordination visible in Buddy's repo. Any accidental collision with a `buddy_*` table would be caught by migration conflicts, but the blast radius is unbounded in principle. Not actionable from Buddy's side; document as a co-tenancy risk.

---

## Track 5 findings — Business Intent

### Original design intent

**Pulse integration** (per [BUDDY_PROJECT_ROADMAP.md](../../BUDDY_PROJECT_ROADMAP.md) §230-238, and the archived [docs/archive/operational-pre-84/PULSE_OMEGA_STATE_VIEW_SPEC.md](../../docs/archive/operational-pre-84/PULSE_OMEGA_STATE_VIEW_SPEC.md)):

- Pulse is a cross-tenant governance / advisory / observability service that consumes Buddy's event stream.
- Two delivery paths by design — (a) durable batch forwarder (canonical), (b) fastlane MCP for low-latency visibility.
- Pulse is intended to be the "system of record for advisory" — synthesizing event patterns into risk signals, confidence scores, and recommendations. Credit authority stays with Buddy.
- Round-trip pattern: Buddy sends events → Pulse writes them back into `buddy_ledger_events` / `buddy_deal_state` tables (shared Supabase) so Buddy can query the synthesized state. Pulse does NOT maintain a separate DB for Buddy telemetry.

**Omega Prime** (per [specs/PHASE_79_SPEC.md:28](../../specs/PHASE_79_SPEC.md#L28), [specs/phase-79-god-tier-closure.md:44](../../specs/phase-79-god-tier-closure.md#L44)):

- Omega Prime is treated in the code as a distinct service (`OMEGA_MCP_URL`, `omega://` scheme, `invokeOmega` chokepoint), but the env var in spec docs points to `https://pulse-mcp-651478110010.us-central1.run.app` — the **same URL** as Pulse MCP.
- "Omega" was the conceptual name for Pulse-in-its-advisory-role. In practice it's one Cloud Run service serving both roles.
- Designed as advisory-only (SR 11-7 wall) — failures must never block the pipeline. `invokeOmega` returns `{ok:false}` on any error, and all UI surfaces degrade to null.

### Phase history

| Phase / PR | Component | Date | Commit / Intent |
| --- | --- | --- | --- |
| — | `deal_pipeline_ledger` + `pulse_forward_*` columns | 2026-01-29 | Migrations `20260129000003`, `20260129000004` |
| PR #823 | Pulse batch forwarder (outbox + cron) | ~Jan-Feb 2026 | Commit `881ace13` per roadmap §234 |
| — | Fastlane MCP client (`src/lib/pulseMcp/`) | 2026-01-29 to 2026-01-30 | `8b3c5e47`, `ffdb504b` — shipped, never enabled |
| — | buddy-core-worker (Cloud Run daemon) | 2026-01-29 | `8b3c5e47` — status unknown (no `claim_owner != null` rows in prod outbox implies not running) |
| 65A | Omega Advisory Panel UI wiring | ~Apr 2026 | AAR [AAR_PHASE_65A_OMEGA_PANEL.md](../../docs/archive/phase-pre-84/AAR_PHASE_65A_OMEGA_PANEL.md) — Omega panel in cockpit with `ai_risk_runs` fallback |
| 78 | BIE Trust Layer (separate from Omega) | 2026-04-15 | — |
| 79 | God Tier Closure — `invokeOmega` wired into `/api/deals/<id>/underwrite/state` | 2026-04-15 | `ce7b3699` (and surrounding) |
| D3 (withdrawn) | Silence `pulse.forwarding_failed` | — | Superseded by this spec |

### Roadmap status

From [BUDDY_PROJECT_ROADMAP.md:234](../../BUDDY_PROJECT_ROADMAP.md#L234):

> **Observability pipeline** — distinguishes two paths: (a) **batch forwarder** — confirmed working via PR #823; (b) **fastlane forwarder** — NOT configured, emits degraded signals on every event. D3 spec silences fastlane until configured. **If real-time Pulse visibility is desired, set the fastlane env vars in Vercel.**

And line 391:

> Omega MCP is advisory-only (SR 11-7 wall). Buddy's canonical pipeline must never depend on an Omega call succeeding.

No existing AAR or roadmap line says "retire Pulse" or "retire Omega." Phase 84 (audit remediation) did not touch either. The D2 roadmap bullet ("Omega MCP `Method not found` investigation") is what prompted this diagnostic.

### Is the design intent still aligned with current priorities?

**Pulse batch forwarder**: intent was real-time delivery to Pulse for governance visibility. Current reality: events are delivered in the `delivered_to='pulse'` sense, but there is no evidence they are landing anywhere useful (see Track 1). The intent is still real; the implementation is unfulfilled.

**Pulse fastlane**: intent was low-latency mirror. Reality: never configured; the tool name it was designed to call (`buddy_event_ingest`) was never deployed on Pulse. The design intent arguably never made it to production. Retiring the fastlane code is cheaper than repairing it — the canonical outbox is sufficient for everything the fastlane was going to do.

**Omega advisory**: intent was to enrich the cockpit with synthesized risk signals. Reality: 100% broken on the wire, UI degrades to a March-stale `ai_risk_runs` fallback. No user complaint, no visible breakage, but also no current signal flowing into the cockpit from Omega. Repair cost (rewriting `invokeOmega.ts` to speak real MCP tools/call) is moderate; retirement cost (remove the three panels and the adapter) is also moderate. Decision rides on whether Matt still wants the Omega advisory surface active.

### UI dependencies

None of the three Omega cockpit components (Advisory, Confidence, Trace) show broken UI on failure — they render `null`. The cockpit "Intelligence" tab falls back to `ai_risk_runs` (last populated 2026-03-14 for the actively-visited test deal; state unknown for other deals). Banker workflow is not blocked by any Omega call failing. Per [roadmap:391](../../BUDDY_PROJECT_ROADMAP.md#L391): "Buddy's canonical pipeline must never depend on an Omega call succeeding."

---

## Open questions for Matt

1. **What is `PULSE_BUDDY_INGEST_URL` actually set to in Vercel production?** This determines whether the outbox is black-holing events or delivering them somewhere observable. Easy to answer — `vercel env pull --environment=production` and `grep PULSE_BUDDY_INGEST_URL`.
2. **Is the `buddy-core-worker` Cloud Run service still deployed?** Zero observable activity (no `claim_owner != null` rows in `buddy_outbox_events`, no heartbeat visible in `buddy_ledger_events` since March 6). If it's still paying GCP compute, it can likely be scaled to zero.
3. **Does the Pulse team still want the `delivered_to='pulse'` event stream?** If yes, Matt should coordinate with Pulse team on the correct ingest URL + auth scheme and we repair. If not, we retire the outbox forwarder and clean up.
4. **Omega advisory — keep or retire?** The Phase 79 intent is documented, but the surface has been 100% silent for 7+ days and nobody noticed. If the advisory layer still matters, REPAIR (estimated 1-2 days to rewrite `invokeOmega.ts` as MCP `tools/call` and map resources to real Pulse tools). If not, RETIRE (delete `src/lib/omega/`, the three cockpit components, the mapping JSON — estimate 0.5 day).
5. **336 dead-lettered outbox events from Jan/Feb 2026 — replay or abandon?** They represent one month of lost pipeline telemetry during the pre-fix 401 era. If Pulse still cares about historical replay, we can re-queue them with the current auth. If not, they stay as an archive artifact.

---

## Proposed next step(s)

| Layer | Option | Effort | Rationale |
| --- | --- | --- | --- |
| Pulse outbox batch forwarder | **INVESTIGATE FURTHER** | 15 min (Matt checks Vercel env) | Until we know what `PULSE_BUDDY_INGEST_URL` is, we can't tell if "delivered" means "received and stored" or "black-holed at a discovery endpoint." Everything else depends on this answer. |
| Pulse fastlane MCP | **RETIRE** | 2 hrs | Tool name (`buddy_event_ingest`) doesn't exist on the deployed Pulse MCP. Canonical outbox covers the functional need. Removing the fastlane also retires the noisy `pulse.forwarding_failed` signal — replacing D3's silencing proposal with a real removal. |
| Omega MCP | **REPAIR** or **RETIRE** (Matt's call) | REPAIR: 1-2 days to rewrite `invokeOmega.ts` to speak real MCP `tools/call` + map `omega://*` to `buddy_ledger_write`/`state_inspect`/`state_confidence`/`observer_query`; Pulse side may need new thin tools for the deal-state shape. RETIRE: 0.5 day to delete `src/lib/omega/`, the 3 cockpit components, and `docs/omega/mapping.json`. | Advisory surface is silently invisible today. REPAIR only makes sense if Matt still wants banker-facing advisory enrichment. RETIRE cleans up dead code; the cockpit falls back to `ai_risk_runs` which is already doing the job. |
| `pulse_*` schema tables | **RETIRE from Buddy's mental model** | 0 hrs | Not Buddy's schema. Document co-tenancy. No deletion — Pulse team owns. |
| Dead-letter cohort (336 events) | **INVESTIGATE FURTHER** | depends on answer to Q3 | If the forwarder is black-holing, there's nothing to replay into. If it's going somewhere real, a one-shot replay script is small. |

### Why not just "silence" (D3)

As the spec notes, silencing hid three independent failure modes behind one loud one. The diagnostic replaces assumption ("the pulse fastlane is just a config toggle away from working") with evidence ("the pulse fastlane calls a tool that doesn't exist on the server"). That changes the correct action from "set an env var" to "delete the fastlane code."

---

## Methodology notes

- Database queries executed via Supabase MCP against production (read-only).
- Live HTTP probes against the deployed `pulse-mcp-651478110010.us-central1.run.app` were unauthenticated introspection only — `POST / {method:"tools/list"}`, `GET /`, `GET /health`, `GET /tools`, plus shape-check POSTs against `/ingest`, `/events`, `/api/pulse/ingest` (all 404) and `/ingest/buddy` (401 without HMAC). No tool call was executed; no ingest was performed.
- Git archaeology via `git log --diff-filter=A` on the relevant source files.
- Vercel env values not directly observed (no `vercel env ls` permission in this session); env state inferred from observable production behavior.
- Subagents (Explore) were used for code-scan breadth on Tracks 2, 3, 4, 5. Their summaries are cross-checked against direct file reads for the most load-bearing claims (JSON-RPC method shape, mapping contract, first-commit dates). Subagent Track-5 claim that "outbox deliveries round-trip back to `buddy_deal_state`" was **not confirmed** and I've restated it as uncertain in §1: the auth scheme and payload shape used by the outbox don't match any in-repo receiver of `buddy_deal_state`. Most likely interpretation: the root endpoint is black-holing the request.

No code, env, or data was modified during this diagnostic. No signal was silenced. Fastlane + Omega continue to emit `pulse.forwarding_failed` and `omega.failed` at their current rates; those signals are the evidence base for anything Matt decides next.
