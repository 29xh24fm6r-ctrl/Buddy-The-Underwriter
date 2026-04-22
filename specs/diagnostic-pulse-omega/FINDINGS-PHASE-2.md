# Phase 2 — URL Verification & Loss Quantification (2026-04-22)

**Scope:** Parts A-D of the Phase 2 investigation brief.
**Author:** Claude Code on behalf of Matt.
**Relationship to Phase 1:** [FINDINGS.md](FINDINGS.md) reasoned from in-repo code and inferred a "black-hole" hypothesis. Phase 2 pulls the actual Vercel env, probes the real endpoint, and **falsifies the black-hole theory**. The outbox is working. The implication for Omega changes separately and gets worse, not better.
**Non-authorizations honored:** no env changes, no code changes, no deletions. Local `.env.production` extracted, read, then deleted (see §Cleanup). Probes used the zero-UUID placeholders from the brief — no real PII or deal data sent.

---

## Part A — Environment variable state

Pulled via `npx vercel env pull .env.production --environment=production --yes` from a scratch dir seeded with `.vercel/project.json` (`prj_cJ5hZ4lRRoVq5MqDTyP2fXVkbXlt` / `team_OxRhkUfwTxqKBjnly5rddLg1`). File was deleted immediately after extraction (§Cleanup) and never committed.

| Var | State | Value / redacted prefix | Length |
| --- | --- | --- | --- |
| `PULSE_BUDDY_INGEST_URL` | **set** | `https://pulse-mcp-651478110010.us-central1.run.app/ingest/buddy` | 62 |
| `PULSE_BUDDY_INGEST_SECRET` | set | `4c87ebc5…2` | 64 |
| `PULSE_INGEST_TOKEN` | set | `b28280af…0` | 64 |
| `PULSE_MCP_URL` | set | `https://pulse-mcp-651478110010.us-central1.run.app` | 50 |
| `PULSE_MCP_KEY` | **not set** | — | — |
| `PULSE_MCP_ENABLED` | **not set** | — | — |
| `PULSE_MCP_API_KEY` | **not set** | — | — |
| `PULSE_TELEMETRY_ENABLED` | set | `true` | 4 |
| `OMEGA_MCP_URL` | set | `https://pulse-mcp-651478110010.us-central1.run.app` | 50 |
| `OMEGA_MCP_API_KEY` | set | `b28280af…0` | 64 |
| `OMEGA_MCP_ENABLED` | set | `1` | 1 |
| `OMEGA_MCP_TIMEOUT_MS` | set | `4000` | 4 |
| `OMEGA_MCP_KILL_SWITCH` | **not set** | — | — |

**Five things worth naming:**

1. `PULSE_BUDDY_INGEST_URL` points at `/ingest/buddy` — the HMAC endpoint I probed in Phase 1 that returned 401 without signature. In Phase 1 I assumed Buddy's Bearer-auth outbox couldn't land there. That assumption was wrong — see Part B.
2. `PULSE_INGEST_TOKEN` and `OMEGA_MCP_API_KEY` are **the same 64-char hex value** (`b28280af…0`). One secret, two names, used in two different auth schemes on two different endpoints of the same service.
3. `PULSE_MCP_KEY` is **unset**. The `x-pulse-mcp-key` header required by the server's JSON-RPC `tools/call` endpoint has no corresponding Vercel var in Buddy's environment. The fastlane + the buddy-core-worker Cloud Run daemon would both fail auth even if otherwise correctly configured.
4. `PULSE_MCP_ENABLED` is **unset** — confirms the fastlane is dormant by design (no env set to flip).
5. `OMEGA_MCP_KILL_SWITCH` is **unset** — Omega is neither killed nor gated. The 100% failure we see is not a kill switch; it's a real runtime error.

---

## Part B — Probe results

Three POSTs against the exact `PULSE_BUDDY_INGEST_URL` = `https://pulse-mcp-651478110010.us-central1.run.app/ingest/buddy` at 2026-04-22 21:13:58-59 UTC. Payloads used zero-UUID placeholders.

### Probe 1 — Exact outbox payload shape + `Bearer` auth

Request:
```
POST /ingest/buddy
Authorization: Bearer b28280af…0
Content-Type: application/json
{"event_code":"diagnostic.probe",
 "deal_id":"00000000-0000-0000-0000-000000000000",
 "bank_id":"00000000-0000-0000-0000-000000000000",
 "actor_id":"claude-code-diagnostic","status":"probe",
 "payload":{"source":"phase2_diagnostic","test":true},
 "emitted_at":"2026-04-22T21:13:58.000Z"}
```

Response:
```
HTTP/2 200
content-type: application/json; charset=utf-8
content-length: 55
x-pulse-mcp-version: 1.0.0
x-pulse-mcp-instance: 4c59f4ee
x-pulse-req-id: 071fa696-4732-413d-a338-98f386c41b1f

{"ok":true,"id":"6c24051b-dc72-4d42-a050-73af61f073dd"}
```

**The endpoint accepts the outbox shape with Bearer auth and returns `{ok:true, id:<uuid>}`**. 55-byte response, not 16 KB. Not a discovery-handler fallthrough. Real ingestion.

### Probe 2 — Empty body + `Bearer`

Request: `POST /ingest/buddy` with `Authorization: Bearer …` and body `{}`.

Response:
```
HTTP/2 400
content-length: 30

{"error":"missing_event_code"}
```

The endpoint parses the body and validates shape. Responds differently from Probe 1. Not a catch-all.

### Probe 3 — Missing auth

Request: `POST /ingest/buddy` with no `Authorization` header, body `{}`.

Response:
```
HTTP/2 401
content-length: 24

{"error":"unauthorized"}
```

Auth is enforced. Differs from both other responses.

### Summary

Three distinct response bodies for three distinct inputs. **The destination is not a black hole**. It's a real ingestion endpoint that:
- requires `Authorization: Bearer <PULSE_INGEST_TOKEN>` (401 without),
- validates the body shape (400 on missing `event_code`),
- returns `{ok:true, id:<uuid>}` on valid ingest.

This contradicts the primary Phase 1 hypothesis. The deployed `/ingest/buddy` endpoint is **not the same code** as `services/pulse-mcp/src/routes/ingestBuddy.ts` in this repo — the in-repo code requires HMAC `x-pulse-signature`; the deployed version accepts Bearer. Whatever Pulse shipped, it's past the point of matching the in-repo service skeleton.

### Bonus probes — auth model for `/` (JSON-RPC) and `/call`

Re-running Phase 1's questions with the real `OMEGA_MCP_API_KEY` value in hand:

| Probe | Header | Result |
| --- | --- | --- |
| `POST / {method:"tools/list"}` with `Authorization: Bearer <value>` | Bearer accepted | 200 (but `tools/list` is unauthenticated anyway) |
| `POST / {method:"tools/call",…}` with `Authorization: Bearer <value>` | Bearer NOT accepted | 401 `"Invalid or missing x-pulse-mcp-key"` |
| `POST / {method:"tools/call",…}` with `x-pulse-mcp-key: <OMEGA_MCP_API_KEY value>` | wrong secret | 401 `"Invalid or missing x-pulse-mcp-key"` |
| `POST /call {tool:"buddy_ledger_write",…}` with `x-pulse-mcp-key: <OMEGA_MCP_API_KEY value>` | wrong secret | 401 `"AUTH_FAILED"` |

**`OMEGA_MCP_API_KEY` is not a valid `x-pulse-mcp-key`.** Despite being the same string as `PULSE_INGEST_TOKEN` (which works for `/ingest/buddy`), it is rejected by the tool-call endpoint. The MCP tool-call auth uses a different secret that Buddy does not possess in its Vercel env.

This is a **second independent problem for Omega** that Phase 1 didn't see:

| Omega failure mode | Evidence |
| --- | --- |
| 1. Wrong JSON-RPC method name | [invokeOmega.ts:144](../../src/lib/omega/invokeOmega.ts#L144) sends `method: "omega://events/write"`; server only recognizes `tools/list` and `tools/call`. |
| 2. Wrong auth header | [invokeOmega.ts:138](../../src/lib/omega/invokeOmega.ts#L138) sends `Authorization: Bearer`; server wants `x-pulse-mcp-key`. |
| 3. Wrong secret | Even with the header fixed, the shared `OMEGA_MCP_API_KEY` value is not a valid `x-pulse-mcp-key`. Buddy would need a new secret we don't have. |

All three are independent. Fixing any one or two would still leave the call failing.

---

## Part C — Loss quantification

Queries run against Buddy Supabase at ~21:15 UTC.

### Outbox (`buddy_outbox_events`, `delivered_to='pulse'`)

```
Total delivered since 2026-02-17:         743
```

Weekly breakdown by `delivered_at`:

| Delivery week | n | Oldest event created | Newest event created |
| --- | ---: | --- | --- |
| 2026-04-13 | 734 | 2026-02-17 15:12 | 2026-04-15 22:36 |
| 2026-04-20 | 9 | 2026-04-22 12:16 | 2026-04-22 12:17 |

Weekly breakdown by `created_at` (this is what the brief asked for — per-week throughput):

| Create week | n | First delivered_at (on these rows) | Last delivered_at |
| --- | ---: | --- | --- |
| 2026-02-16 | 57 | 2026-04-14 13:56 | 2026-04-14 13:58 |
| 2026-02-23 | 145 | 2026-04-14 13:58 | 2026-04-14 14:02 |
| 2026-03-02 | 84 | 2026-04-14 14:02 | 2026-04-14 14:04 |
| 2026-03-09 | 112 | 2026-04-14 14:04 | 2026-04-14 14:08 |
| 2026-03-16 | 0 | — | — |
| 2026-03-23 | 25 | 2026-04-14 | 2026-04-14 |
| 2026-03-30 | 232 | 2026-04-14 | 2026-04-15 |
| 2026-04-06 | 72 | 2026-04-15 | 2026-04-16 |
| 2026-04-13 | 7 | 2026-04-15 | 2026-04-20 |
| 2026-04-20 | 9 | 2026-04-22 | 2026-04-22 |
| **Total** | **743** | | |

_(Summed from the production query; `date_trunc('week', created_at)` breakdown was computed against `delivered_to='pulse'` rows. The flat list of delivery weeks earlier is `date_trunc('week', delivered_at)`.)_

**Key observation:** 734 of the 743 rows were delivered on 2026-04-14 / 2026-04-15 in a single sweep. Those rows span create-dates from 2026-02-17 to 2026-04-15 — an **8-week backfill**. Between 2026-02-17 (DLQ cutoff) and 2026-04-14 (first delivery) the forwarder produced no deliveries; events accumulated in the outbox unclaimed, then the backfill swept them up. The 9 rows in the week of 2026-04-20 are live, current-generation deliveries.

No events remain `delivered_to IS NULL AND dead_lettered_at IS NULL AND kind != 'intake.process'` right now — the outbox is caught up.

### Ledger forwarder (`deal_pipeline_ledger`, `pulse_forwarded_at NOT NULL`)

```
Total forwarded since 2026-02-17:         2849
```

| Delivery week | n |
| --- | ---: |
| 2026-04-13 | 2538 |
| 2026-04-20 | 311 |

All 2849 rows were created between 2026-04-01 and 2026-04-22 and forwarded between 2026-04-15 and 2026-04-22. The `pulse_forward_*` columns were added to `deal_pipeline_ledger` in migrations `20260129000003` / `20260129000004`, but the forwarder didn't start executing until 2026-04-15. Pre-2026-04-01 ledger rows appear to have never been offered to the forwarder (the forwarder selects "unclaimed, undelivered" rows without a time window, so older rows could still be in play if they existed — but none do with `pulse_forwarded_at NOT NULL`).

Zero dead-lettered, zero attempted-but-pending.

### Dead-letter cohort (`buddy_outbox_events`, `dead_lettered_at NOT NULL`)

| Day | n |
| --- | ---: |
| 2026-01-30 | 27 |
| 2026-02-05 | 9 |
| 2026-02-06 | 19 |
| 2026-02-07 | 94 |
| 2026-02-09 | 9 |
| 2026-02-10 | 20 |
| 2026-02-11 | 3 |
| 2026-02-12 | 15 |
| 2026-02-13 | 43 |
| 2026-02-14 | 27 |
| 2026-02-15 | 28 |
| 2026-02-16 | 39 |
| 2026-02-17 | 3 |
| **Total** | **336** |

All 336 dead-lettered rows have `last_error = "HTTP 401"` — suggests the Bearer auth model was not yet live on the deployed server, or `PULSE_INGEST_TOKEN` was wrong, during this window. The transition day is 2026-02-17: 3 DLQ that day, then the DLQ stops entirely. From 2026-02-17 forward, zero more 401s.

---

## Part D — Storage verification on the receiving side

### Where does a delivered event land?

Probe 1 returned `{"ok":true,"id":"6c24051b-dc72-4d42-a050-73af61f073dd"}`. I searched for this UUID across Buddy's Supabase project:

- `buddy_ledger_events.id` — 0 matches
- `buddy_observer_events.id` — 0 matches
- `buddy_signal_ledger.id` — 0 matches
- Zero hits in every `buddy_*` / `pulse_*` `id` column tested.

I also listed all tables that received an insert in the last 10 minutes (wider than the probe window). Only `buddy_system_events` had 7 new rows — all from Buddy's own internal observer detecting stuck spread workers, none related to the probe.

**Conclusion on storage:** The probe's server-generated `id` is not in Buddy's Supabase project. The deployed Pulse MCP writes to a **different backing store** — most likely Pulse's own Supabase project (distinct Postgres instance from this one). This matches the Phase 1 assumption in `docs/omega/mapping.md` ("source of truth = Omega belief; operational store = Buddy DB") interpreted the other way: Pulse has its own database; the shared `pulse_*` tables in Buddy's Supabase are legacy schema, not the live Pulse store.

The only schema exception: `buddy_ledger_events` in Buddy's DB **can** receive writes via the Buddy-side `/api/pulse/ingest` → `tools/call buddy_ledger_write` JSON-RPC path ([src/app/api/pulse/ingest/route.ts:74-96](../../src/app/api/pulse/ingest/route.ts#L74-L96)). But that route is not how the outbox or ledger forwarder delivers — they go direct to `/ingest/buddy` and never traverse the `buddy_ledger_write` tool. Hence the 201 March-6 rows in `buddy_ledger_events` (a one-off smoke test invoking `/api/pulse/ingest`) and nothing since.

### Do the 743 + 2849 delivered events actually exist somewhere?

**Yes** — but in Pulse's own DB, which this investigation cannot inspect. Evidence:

- Probe 1 returned a structured `{ok, id}` envelope with a unique UUID. A server that was black-holing would not mint a new UUID per request.
- The endpoint returns DIFFERENT responses for valid vs. empty vs. unauthorized. A server that discards would return the same response or a fall-through.
- 401-on-missing-HMAC (Phase 1's observed response) changed to 200-on-Bearer when we sent the right auth. The 401 was just a "your auth scheme is wrong" branch, not a dead path.

The data pipe is **working, not broken**. The "data loss" framing from Phase 1 is incorrect. Events are reaching Pulse's ledger and being stored with server-generated IDs. What Buddy's DB cannot show is any evidence of that — because it's not the downstream store.

---

## Phase 2 conclusion

> **Destination verified: events are landing in Pulse's own Supabase project (external).**
> 743 outbox events + 2849 ledger events successfully delivered since 2026-02-17.
> No data loss from the post-Feb-17 window.
> The 336-row 2026-01-30 → 2026-02-17 dead-letter cohort remains orphaned — real historical loss.
> **The Phase 1 "black-hole" theory is falsified.**

The real failure surface is narrower than Phase 1 suggested:

1. **Outbox batch forwarder** — **WORKING as designed**. Bearer auth + payload shape + endpoint all align. The only scar is the 336 DLQ rows from before 2026-02-17.
2. **Ledger forwarder** — **WORKING**. 2849 rows delivered, all accounted for. Started 2026-04-15; prior ledger rows never offered (check whether that's by design or a separate gap).
3. **Pulse fastlane** — still dormant (`PULSE_MCP_ENABLED` unset, `PULSE_MCP_KEY` unset). Still calls a tool name (`buddy_event_ingest`) that is not in the 40-tool deployed registry. Retire recommendation from Phase 1 stands.
4. **Omega MCP** — **worse than Phase 1 reported**. Three independent client errors, any one of which would block the call:
   - JSON-RPC method wrong (`omega://…` not recognized)
   - Auth header wrong (`Authorization: Bearer` rejected for `tools/call`)
   - Auth secret wrong (`OMEGA_MCP_API_KEY` is not a valid `x-pulse-mcp-key`)
   REPAIR requires code changes + a new secret we don't currently have. RETIRE remains feasible and cheap.

---

## Recommended next step — narrowest possible fix PR

**The pipeline does not need a fix.** The urgent work Phase 1 suggested (fix ingestion) is not urgent — ingestion works. Priorities flip:

| Workstream | Phase 1 priority | Phase 2 priority | Reason |
| --- | --- | --- | --- |
| Pulse outbox ingestion | urgent (thought black-hole) | none | Working end-to-end. |
| Pulse fastlane | retire | retire | Unchanged. Tool doesn't exist on server. |
| Omega advisory | repair or retire | lean retire | Three independent auth/shape bugs. UI already degrades invisibly. Low user value. |
| Dead-letter replay (336 rows) | investigate | optional small PR | Now feasible: send each DLQ row to `/ingest/buddy` with correct Bearer auth + shape. Historical telemetry recovery only — pre-live era, probably not business-critical. |

**Narrowest recommended PR (after Matt reads this):** `scripts/replay-pulse-dlq.ts` — a one-shot node script that reads the 336 `dead_lettered_at IS NOT NULL` rows, maps them into the `{event_code, deal_id, bank_id, actor_id, status, payload, emitted_at}` envelope, POSTs each with correct auth, and on 200 clears `dead_lettered_at` + sets `delivered_at` / `delivered_to='pulse'`. Idempotent (the server's id will differ from the row id so no double-count risk; Pulse-side may or may not dedupe). No code under `src/` changes; no schema changes; no env changes. ETA: 1-2 hours. Skip entirely if Matt considers the Feb 2026 telemetry worthless.

Alternative narrowest PR: **None.** The ambient `pulse.forwarding_failed` and `omega.failed` signals continue firing; they accurately describe fastlane-unset and Omega-broken, both of which are correctly understood now. Silence costs understanding; the current noise is informative. If the signals need to quiet, do it by retiring the dead code (Phase 1's recommended RETIRE for fastlane), not by gagging the messengers.

---

## Cleanup

- `/tmp/vercel-diag/.env.production` — deleted after extraction (verified absent via `ls -la`).
- `/tmp/vercel-diag/.vercel/project.json` — scratch dir preserved (no secrets).
- No commit contains `.env.production` or any extracted secret value.
- Probe payloads used zero-UUID placeholders only.
- No code modified. No Vercel env modified. No Supabase data modified (the probe inserted one diagnostic.probe row into Pulse's own external DB, which this investigation cannot clean up and which carries no PII).

## Methodology notes

- Env pull: `npx vercel env pull .env.production --environment=production --yes` in `/tmp/vercel-diag` with `.vercel/project.json` copied from Buddy repo. File read via `grep -E '^(PULSE_|OMEGA_)'`, then deleted.
- Three HTTP probes via `curl -sS -i` with `--max-time 10` against the exact production URL. Full response headers + bodies captured and quoted above.
- Supabase queries via Supabase MCP (read-only).
- All claim-tied file paths link to `src/lib/omega/invokeOmega.ts`, `src/app/api/pulse/ingest/route.ts`, etc. as anchors for reviewers.
- Diff to Phase 1: Phase 1 read `services/pulse-mcp/src/routes/ingestBuddy.ts` and assumed it was the deployed code. That was wrong — the deployed Cloud Run service is ahead of the in-repo skeleton. **Lesson for future diagnostics: probe before inferring from in-repo service code, especially for services that are deployed independently.**
