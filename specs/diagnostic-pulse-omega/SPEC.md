# Spec DIAG-PULSE-OMEGA — Diagnostic for Pulse + Omega Prime Integration State

**Date:** 2026-04-22
**Status:** READ-ONLY diagnostic. No code changes, no config changes, no silencing.
**Supersedes:** D3 (fastlane silence) — withdrawn. Silencing a broken integration is the wrong move; diagnose before deciding.
**Owner:** Matt (decisions) + Claude Code (execution)
**Scope:** Determine the actual state of Pulse and Omega Prime integration, end-to-end, so that informed decisions can replace assumption-based ones.

---

## Why this exists

D3's original framing ("silence `pulse.forwarding_failed` for `pulse_mcp_disabled` because it's a config state") was wrong. On review of what's actually in the database, what I called "config state" is actually "integration that was built, partially configured, and stopped working at some point — and we stopped noticing because the error became ambient."

Preliminary findings during spec drafting (queried against production DB 2026-04-22):

1. **Omega MCP: 100% failure rate, last 7 days.** `buddy_signal_ledger` shows 53 `omega.invoked` events and 53 `omega.failed` events. Every single invocation failed. All fail with `omega_rpc_error: Method not found`. Resources being called: `omega://state/underwriting_case/{id}`, `omega://confidence/evaluate`, `omega://traces/{id}`, `omega://events/write`. Omega Prime is either not exposing these methods under these names, not running, or exposing them under different names.

2. **Pulse batch forwarder: appears to be working, destination unclear.** `buddy_outbox_events` shows 743 events delivered to `delivered_to='pulse'` between Apr 14 and Apr 22. But `buddy_ledger_events` (the table I assumed was Pulse's receiving table) hasn't received anything since March 6 — 47 days stale. So deliveries are happening somewhere, but not into the table I expected.

3. **Pulse dead-letter queue: 336 events, all HTTP 401.** Events that failed permanently before authentication was fixed. They were never retried after the fix — they're orphaned.

4. **Pulse fastlane: firing on every checklist update, 100% failure.** 15 `pulse.forwarding_failed` signals in 7 days with `error: pulse_mcp_disabled` because `PULSE_MCP_ENABLED` is not set in Vercel.

5. **~40 `pulse_*` tables in Buddy's Supabase, all empty.** `pulse_missions`, `pulse_runs`, `pulse_active_signals`, `pulse_episodes`, `pulse_doctrine_promotions`, `pulse_executive_memory` — all zero rows. Schema exists, no data has ever flowed through these.

This is a system that was built to integrate with Pulse and Omega Prime and currently does not, in three independent ways, with partial success in one path (the outbox to `delivered_to='pulse'`). The D3 fix would have silenced the loudest symptom and left all three failure modes intact. This diagnostic exists to replace that approach with understanding.

---

## Goals

**In scope:**

1. **Map the code.** Enumerate every code path in Buddy that calls Pulse or Omega Prime. Identify the three layers (outbox/batch, fastlane MCP client, Omega MCP) and every call site for each.

2. **Map the configuration.** For each layer, identify which environment variables control it, which are set in Vercel, and which are not. Surface the gaps.

3. **Map the wire.** For each layer, identify where events go when delivery reports succeed. Confirm or falsify the assumption that "delivered" means "received and stored."

4. **Map the contract.** For Omega specifically, enumerate the four `omega://` resources Buddy calls and determine — from Omega Prime's side — which methods Omega actually exposes. The `Method not found` error tells us there is a mismatch; this phase identifies the shape of the mismatch.

5. **Map the intent.** For each integration, determine what it was designed to do — the business purpose. An integration that's not working and has no clear purpose is a different problem from one that's not working but has a clear design intent. This shapes the fix choice.

**Out of scope:**

- No code changes.
- No environment variable changes.
- No silencing, even temporarily.
- No migration of data.
- No architectural decisions. Those come after the diagnostic, based on the findings.

---

## Methodology

Split into five investigation tracks, each read-only.

### Track 1 — Pulse Outbox / Batch Forwarder

**Question:** The 743 events with `delivered_to='pulse'` — where do they actually go? Does the destination receive and store them?

**Steps:**

1. Read `src/lib/outbox/` in full. Identify the worker that drains `buddy_outbox_events` and marks them `delivered_to='pulse'`. Document its HTTP target (URL), auth method, and any retry/dead-letter logic.
2. Identify the environment variables it reads (`PULSE_TELEMETRY_ENABLED`, `PULSE_BUDDY_INGEST_URL`, `PULSE_INGEST_TOKEN` per roadmap note — verify actual variable names from code).
3. Check Vercel for each of those env vars — `vercel env ls --yes production | grep -Ei 'pulse|telemetry|ingest'`. Record which are set, their lengths, last-modified dates.
4. Identify where delivered events should land. This is the critical question. Options:
   - A remote Pulse HTTP endpoint that writes to Pulse's own Supabase project (not this one)
   - A remote Pulse HTTP endpoint that writes back to this Supabase's `buddy_ledger_events` or other table
   - A local Supabase function (edge function or trigger) that receives and stores
5. Pick one recent delivered event and trace it from outbox row → HTTP request → destination. Use Vercel runtime logs to find the actual outbound HTTP call. Document the target hostname.
6. Report: does the destination exist? Is it reachable? Does it store the event? Can we observe the stored form somewhere?

### Track 2 — Pulse Fastlane MCP Client

**Question:** What was the fastlane designed to deliver that the outbox doesn't, and why is it unconfigured?

**Steps:**

1. Read `src/lib/pulseMcp/client.ts` and `src/lib/pulseMcp/config.ts` in full. Document the full surface area (`callTool`, `listTools`, `emitEvent`, `ping`).
2. Grep for every call site of `tryForwardToPulse`, `callTool` from `pulseMcp/client`, and direct `PulseMcpClient` instantiation. List each call site with the event type it forwards.
3. Compare the set of events the fastlane forwards against the set the outbox forwards. Is there overlap, divergence, or one a superset of the other?
4. Git log on `src/lib/pulseMcp/` and `src/lib/outbox/` — when were they written, in what order, by whom? Was the fastlane supposed to replace the outbox, supplement it, or serve a distinct purpose?
5. Check if `PULSE_MCP_ENABLED` was ever set in any Vercel environment. `vercel env ls --yes` across all environments. If it was set and removed, when and why?
6. If the answer to "why is it unconfigured" is "we never finished configuring it," that's one thing. If it's "we tried and it broke and we disabled it," that's a different thing. Report which.

### Track 3 — Omega Prime MCP (the `Method not found` mystery)

**Question:** What's the actual contract gap between what Buddy calls and what Omega exposes?

**Steps:**

1. Read `src/lib/omega/` in full. Document every `omega://` resource Buddy invokes and from which call sites.
2. Confirm `OMEGA_MCP_ENABLED`, `OMEGA_MCP_URL`, `OMEGA_MCP_API_KEY`, `OMEGA_MCP_KILL_SWITCH` state in Vercel. Record the URL value (or first 40 chars if sensitive) so we know the endpoint.
3. Try an interactive MCP listing call: from Claude Code's shell, `curl -X POST <OMEGA_MCP_URL>` with a JSON-RPC `tools/list` request (standard MCP introspection). Record the response. This tells us what methods Omega Prime actually exposes under the current deployment.
4. For each method Omega exposes, compare against each `omega://` resource Buddy calls. The mismatch pattern will be one of:
   - Same methods, different names (e.g., Buddy calls `omega://events/write`, Omega exposes `events.write` or `omega.events.write`)
   - Buddy's methods don't exist at all on Omega's side
   - Omega is running a different version than the one Buddy was built against
5. Check whether there's a `docs/omega/mapping.json` or equivalent that documents the expected contract. Compare against runtime reality.
6. If Pulse MCP is available from the MCP tools list on our chat side (it appears to be), use it as a reference: does Pulse MCP expose anything with a similar naming pattern to what Omega should expose? This might tell us whether Buddy was built against an older spec that has since evolved on the Pulse/Omega side.

### Track 4 — Pulse Schema Tables (the 40 empty tables)

**Question:** Why does Buddy's Supabase have 40+ `pulse_*` tables that are all empty?

**Steps:**

1. `SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'pulse_%'` — full list.
2. For each table, count rows and get max(`created_at`) or equivalent timestamp if one exists.
3. Identify the migrations that created them. `SELECT name FROM supabase_migrations.schema_migrations WHERE name ILIKE '%pulse%' ORDER BY version` — what was the intent at migration time?
4. Grep `src/` for any reads or writes against these tables. If they're all read-only in the code, Buddy is treating Pulse tables as external data that arrives from somewhere else. If there are no reads or writes at all, they're dead schema.
5. Determine: are these tables that Pulse writes *into* Buddy's DB (shared DB pattern)? Tables that Buddy writes for Pulse to consume? Or are they dead schema copied over for some reason and never wired up?

### Track 5 — Business Intent

**Question:** What were these integrations designed to do, and does the design still reflect current priorities?

**Steps:**

1. Pull the original design docs (if any) for Pulse integration and Omega Prime integration. Likely locations: `BUDDY_PROJECT_ROADMAP.md`, `docs/`, `specs/`, `/docs/archive/phase-pre-84/`, phase AARs from Phases 60-75 (the roadmap shows this era built a lot of governance and agent infrastructure).
2. Identify the phase or PR that introduced each integration layer. Batch forwarder per roadmap = PR #823 / commit `881ace13`. Fastlane and Omega likely earlier.
3. For each integration, answer:
   - What was the original design intent? (e.g., "Omega provides advisory risk signals to Buddy" or "Pulse is the system of record for cross-tenant executive intelligence")
   - Does that design intent still reflect current priorities?
   - If yes, the integration needs to be repaired.
   - If no, the integration needs to be explicitly retired — not silenced.
4. Identify any dependencies. For example: does the banker cockpit UI render anything that depends on Omega advisory data? If Omega has been 100% failing for weeks, is there a UI surface that's been showing stale or empty advisory info all this time?

---

## Output — what the diagnostic produces

Single deliverable: `specs/diagnostic-pulse-omega/FINDINGS.md` — committed as a doc-only PR.

Structure:

```
# Pulse + Omega Prime Integration — Diagnostic Findings (2026-04-22)

## Summary table

| Layer | State | Last Success | Root Cause | Design Intent | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Pulse outbox → Pulse | [working / partial / broken] | [date] | [evidence] | [1-sentence intent] | [REPAIR / RECONFIGURE / RETIRE / INVESTIGATE] |
| Pulse fastlane MCP | ... | ... | ... | ... | ... |
| Omega MCP | ... | ... | ... | ... | ... |
| pulse_* schema tables | ... | ... | ... | ... | ... |

## Track 1 findings — Pulse Outbox / Batch Forwarder
(detailed findings per the Track 1 methodology)

## Track 2 findings — Pulse Fastlane MCP Client
...

## Track 3 findings — Omega Prime MCP
...

## Track 4 findings — Pulse Schema Tables
...

## Track 5 findings — Business Intent
...

## Open questions for Matt

(any decisions that require business-level input, not technical investigation)

## Proposed next step(s)

(one spec-level recommendation per layer, with effort estimate. Options are:
- REPAIR: fix the failing integration in place.
- RECONFIGURE: the integration works but is not connected. Set the missing env vars, verify flow.
- RETIRE: the integration is dead or superseded. Remove the code and schema cleanly.
- INVESTIGATE FURTHER: not enough information yet; specific additional questions needed.
)
```

---

## What this spec does NOT do

- **Does not silence anything.** The `pulse.forwarding_failed` signal continues firing on every checklist update. The `omega.failed` signal continues firing on every cockpit load. These are load-bearing diagnostic signals; silencing them before we understand what they're telling us would destroy the evidence the diagnostic is built on.
- **Does not configure anything.** Even if the diagnostic finds that "just set `PULSE_MCP_ENABLED=1`" would make the fastlane work, we don't do it in this PR. Configuration changes land after the findings have been read and a deliberate decision has been made about each layer.
- **Does not delete anything.** The 40 empty `pulse_*` tables stay. The 336 dead-letter events stay. The Omega code stays. Cleanup decisions land after understanding.
- **Does not ship fixes.** Separate spec per layer, after Matt reads FINDINGS.md and directs next steps.

---

## Commit strategy

Single PR. Single commit if possible, or one commit per track if the work naturally decomposes.

Commit message: `docs(diag): Pulse + Omega Prime integration diagnostic findings`

The only file created is `specs/diagnostic-pulse-omega/FINDINGS.md`.

---

## Timeline

This is an investigation, not a build. Estimated effort: 2–3 hours across the five tracks. Claude Code can do most of it from shell + Supabase MCP + git log. Track 3 (Omega MCP introspection) may require interactive HTTP calls that need to inspect real responses. Track 5 (business intent) depends on readable design docs; if docs are sparse, that track itself becomes a finding ("no recoverable design intent for X; Matt to clarify").

---

## After the diagnostic

Matt reads FINDINGS.md. For each layer, one of:

1. **REPAIR:** draft a repair spec per-layer. Scoped, narrow, addresses the specific failure.
2. **RECONFIGURE:** change env vars (usually 1-5 minutes of work in Vercel), verify, done.
3. **RETIRE:** draft a retirement spec. Delete the code, drop the tables, remove the env vars. Honest decommissioning instead of noisy silence.
4. **INVESTIGATE FURTHER:** additional specific questions to answer before choosing the above.

Each layer can land in a different column. For example: the outbox might need REPAIR (retry the 336 dead-letter events + fix whatever made them 401 in the first place), the fastlane might need RETIRE (if the outbox is the canonical path and the fastlane is redundant), Omega might need REPAIR (fix the method-name mismatch), and the `pulse_*` tables might need RETIRE (drop them if they're dead schema).

---

## Addendum for Claude Code — judgment boundaries

You have authority to:

- Read any file, any DB table, any Vercel env state
- Run HTTP calls against `OMEGA_MCP_URL` and `PULSE_BUDDY_INGEST_URL` to introspect (MCP `tools/list`, HTTP `OPTIONS`, etc.)
- Run read-only `curl` against whatever external endpoints are identified
- Commit `specs/diagnostic-pulse-omega/FINDINGS.md`

You do NOT have authority to:

- Change any environment variable
- Modify any code outside `specs/diagnostic-pulse-omega/`
- Attempt fixes during the diagnostic, even if the root cause becomes obvious
- Silence any emitted signal, even temporarily

If you find during diagnosis that a production system is *actively causing harm* (not just noise — actual data loss or user-visible failure), stop the diagnostic and surface immediately. The expected finding is "ambient noise, no active harm," but verify rather than assume.

If any track produces "I genuinely cannot determine this from available evidence," say so explicitly. "Unknown" is an acceptable answer in the findings table. "Probably working" is not.
