# Spec OMEGA-REPAIR — Fix Two Wire-Level Bugs + Kill-Switch the Read Path

**Date:** 2026-04-23 (rev 3; replaces rev 2 which had incorrect tool names and misread the read tools' semantic scope)
**Supersedes:** Prior rev 2 at commit `bf55258b` (which superseded rev 1 at `d5b0de73`)
**Owner:** Matt (owns both sides of the contract — Buddy and Pulse)
**Executor:** Claude Code
**Accessible repos:** `29xh24fm6r-ctrl/Buddy-The-Underwriter` (Buddy-side changes). `29xh24fm6r-ctrl/PulseMasterrepo` is private; not all credentials see it. That's fine — see PIV-2.
**Estimated effort:** 3–5 hours total. Smaller than rev 2 because the read path is kill-switched, not wired to tools that can't answer the question.
**Risk:** Low. No pipeline impact (SR 11-7 wall). Worst case is the write path still fails and UI stays unchanged from today.

---

## Why rev 3 exists — mea culpa

Rev 2 ("four bugs, wire reads to `state_inspect`/`state_confidence`/`observer_query`") was wrong on three points that only surfaced when Claude Code began execution:

1. **Wrong tool names.** Rev 2 named tools `buddy_write_ledger_event`, `buddy_list_ledger_events`, etc. The deployed Pulse MCP actually exposes them as `buddy_ledger_write`, `buddy_ledger_list`, `buddy_ledger_deal`, `buddy_ledger_flow_health`. Applying rev 2 verbatim would have kept the 100% failure rate — same `-32601 Method not found` error, different specific tool name.

2. **Wrong assumption about `target_user_id` being required.** Pulse's tool schemas mark `target_user_id` as *optional* ("If omitted, server injects default target user"). Rev 2 framed its absence as bug #4 blocking calls with Zod validation errors. That's refuted by the deployed schema. Passing it is still good multi-tenant hygiene, but it is not a wire-level blocker.

3. **Wrong semantic model for reads.** Rev 2 assumed `state_inspect` / `state_confidence` / `observer_query` accept deal-scoped arguments (e.g., `entity_id`, `session_id`). They don't. The deployed schemas are user-scoped only:
   - `state_inspect({ target_user_id? })` — returns the user's current Pulse runtime state. No deal/entity filter.
   - `state_confidence({ target_user_id?, limit? })` — returns recent confidence events for the user. No deal filter.
   - `observer_query({ target_user_id?, limit?, event_type? })` — returns recent observer events, filtered by event type at most. No session filter.

   This means Buddy's cockpit advisory surface — which wants "what does Pulse think about *this specific deal*?" — cannot be answered by the current Pulse tool surface at all. Rev 2's wire-level fix would have succeeded at the RPC level and returned data unrelated to the deal the adapter asked about.

**Root cause of all three errors:** rev 2 sourced tool names and schemas from in-repo code (`PulseMasterrepo/services/pulse-mcp/src/tools/buddy/ledger.ts`) which turned out to not match deployed reality. The in-repo `tools/index.ts` registers 9 `pulse.*` tools; the deployed service exposes 40 tools with entirely different names. This drift pattern matches what we saw earlier in the arc — Buddy's own `services/pulse-mcp/` skeleton was also stale compared to deployed. **In-repo code is not authoritative for deployed contracts. The deployed `tools/list` is.**

Rev 3 corrects all three errors, narrows scope, and adds a stop-and-surface principle as a build rule.

---

## The actual problem

Omega advisory is 100% failing in production. 53/53 `omega.invoked` → `omega.failed` in the last 30 days, all with `omega_rpc_error: Method not found`.

After correcting rev 2's errors, the real failure picture is:

**Two wire-level blocker bugs** (both must be fixed for any Omega call to succeed):
1. **Wrong JSON-RPC method.** `src/lib/omega/invokeOmega.ts:144` sends `method: "omega://events/write"` directly. The deployed Pulse MCP only recognizes JSON-RPC methods `tools/list` and `tools/call`. The entire `omega://` namespace is client-side fiction.
2. **Wrong auth header.** `invokeOmega.ts:138` sends `Authorization: Bearer ${apiKey}`. Pulse MCP's auth middleware reads the `x-pulse-mcp-key` header only. Bearer is silently ignored, request fails auth.

**One secret change, already applied:** `OMEGA_MCP_KEY` is now set in Vercel (Production + Preview, marked Sensitive) with the value from GCP Secret Manager's `PULSE_MCP_API_KEY` v2. Matt handled this. Buddy just needs to read it.

**One write-path tool mapping that works today:** `omega://events/write` → `buddy_ledger_write` (confirmed against deployed `tools/list`). This is the only Omega surface that maps cleanly to an existing Pulse tool with matching semantics.

**A design-level gap on the read path:** Buddy's cockpit expects deal-scoped advisory reads. Pulse does not currently expose deal-scoped advisory primitives. Fixing the wire without fixing the design gap produces calls that succeed at the RPC level but return data unrelated to the question being asked. That's worse than the current failure mode.

## The chosen shape of repair (B1)

**Buddy side (this spec, this PR):**
- Fix the two wire-level blockers so `invokeOmega` can actually talk to the deployed Pulse MCP.
- Wire the write path: `omega://events/write` → `buddy_ledger_write` with correct args. This carries Buddy's event stream into Pulse's governance/observability store, which was the original design intent for that resource.
- Kill-switch the three read helpers (`readOmegaState`, `evaluateOmegaConfidence`, `readOmegaTraces`). They early-return a specific `pulse_advisory_tools_not_yet_available` error. Adapter continues returning `stale: true, staleReason: "Deal-scoped advisory tools not yet available in Pulse"`. Cockpit UX unchanged on reads (stays invisible, falls back to `ai_risk_runs`), but the ledger now shows honest signal instead of `Method not found` noise.

**Pulse side (separate spec, separate PR, separate repo):**
- Design and implement three deal-scoped advisory tools in PulseMasterrepo:
  - `buddy_advisory_for_deal(deal_id, target_user_id?)` — returns Pulse's synthesized advisory for a specific deal
  - `buddy_confidence_for_deal(deal_id, target_user_id?)` — returns Pulse's confidence score for a specific deal
  - `buddy_traces_for_deal(deal_id, target_user_id?)` — returns Pulse's reasoning traces for a specific deal
- Stub captured in `specs/omega-repair/PULSE-SIDE-SPEC.md` (sibling to this spec).

**Follow-up Buddy PR (after Pulse ships):**
- Update the URI→tool mapping to route reads to the new Pulse tools.
- Lift the kill switch.
- Adapter starts returning real data.

## Outcome we want from this PR specifically

- Every Omega call reaches the deployed Pulse MCP with a well-formed JSON-RPC `tools/call` envelope and correct auth.
- `buddy_signal_ledger` shows:
  - `omega.succeeded` for every `omega://events/write` call (write path working)
  - `omega.failed` with `payload.error: "pulse_advisory_tools_not_yet_available"` for reads (honest kill-switch, not `Method not found`)
- Pulse's external DB receives Buddy's signal mirror events (verifiable by asking Matt to query Pulse's own Postgres, or by trusting the HTTP 200 + minted UUID response).
- Cockpit UX on test deal `d65cc19e-...` is identical to today (reads invisible, falls back to `ai_risk_runs`). This is intentional — the UX improvement requires Pulse-side tools.
- SR 11-7 wall preserved: Omega remains advisory-only; pipeline never depends on Omega success.

## Non-goals

- **Not making the cockpit advisory panels visible.** That requires Pulse-side tools; see follow-up PR.
- **Not redesigning the client abstractions.** `src/lib/omega/` and `src/lib/pulseMcp/` still point at the same deployed service with different client framings. Consolidation is future cleanup.
- **Not rethinking request-response vs event-driven.** The "Pulse-as-driver" architectural rethink Matt raised earlier in the arc is a future spec, not this PR.
- **Not replaying the 336 pre-Feb-17 DLQ rows.** Optional separate PR.
- **Not retiring the fastlane.** Separate PR.
- **Not modifying PulseMasterrepo.** Out of scope for this PR (the companion Pulse-side spec exists for that work).

---

## Pre-implementation verification (MANDATORY)

Claude Code MUST complete all five PIVs before writing code. Surface any finding that contradicts the spec. Stop-and-surface is a requirement, not a courtesy.

### PIV-1 — Record the current failure baseline

```sql
SELECT type, COUNT(*) as n, MAX(created_at)::text as latest
FROM buddy_signal_ledger
WHERE type IN ('omega.invoked', 'omega.succeeded', 'omega.failed', 'omega.timed_out', 'omega.killed')
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY type;
```

Expected (per prior AAR): `omega.invoked` ≈ 53, `omega.failed` ≈ 53, `omega.succeeded` = 0.

Record exact values. These are the before-state for V-1.

### PIV-2 — Read deployed tool contracts from `tools/list`, not from source

**Changed from rev 2:** do NOT attempt to read `PulseMasterrepo:services/pulse-mcp/src/tools/` as the source of truth. Even if accessible, the in-repo code is stale relative to the deployed service. The authoritative source is the live `tools/list` endpoint.

Probe:

```bash
curl -sS -X POST https://pulse-mcp-651478110010.us-central1.run.app/ \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"piv2","method":"tools/list"}' | jq '.result.tools[] | {name, description, inputSchema}' > /tmp/pulse-tools.json
```

No auth required for discovery. Record:

1. Confirm `buddy_ledger_write` exists with `inputSchema` accepting at minimum: `event_type`, `deal_id` (optional), `status` (enum), `payload`, `target_user_id` (optional). If the schema differs, surface before coding.
2. Confirm the three deal-scoped tools `buddy_advisory_for_deal`, `buddy_confidence_for_deal`, `buddy_traces_for_deal` do NOT exist. If any of them have appeared since this spec was written, surface (plan changes materially).
3. Record any tool named `mcp_tick` or similar zero-args tool — PIV-3 uses it for auth smoke-testing.

If `buddy_ledger_write`'s schema differs from expected, the URI→tool translation layer must be updated before commit. This is not a stop-and-surface (writes are a known-clean mapping), but the translator must match the real schema.

### PIV-3 — Verify `OMEGA_MCP_KEY` authenticates end-to-end

Two-step probe. Runs in a throwaway directory; does NOT commit or leave a `.env.production` on disk.

```bash
mkdir -p /tmp/omega-piv3 && cd /tmp/omega-piv3
cp /path/to/buddy/.vercel/project.json .vercel/project.json  # team + project linkage
npx vercel env pull .env.production --environment=production --yes
KEY=$(grep '^OMEGA_MCP_KEY=' .env.production | cut -d'=' -f2- | tr -d '"')
# Probe with mcp_tick or confirmed zero-args tool from PIV-2
curl -sS -i -X POST https://pulse-mcp-651478110010.us-central1.run.app/ \
  -H "content-type: application/json" \
  -H "x-pulse-mcp-key: $KEY" \
  -d '{"jsonrpc":"2.0","id":"piv3","method":"tools/call","params":{"name":"mcp_tick","arguments":{}}}'
unset KEY
rm -f .env.production
cd / && rm -rf /tmp/omega-piv3
```

Expected: HTTP 200 with a successful `mcp_tick` response (whatever shape — just that it's 200 and not 401).

- 401 → `OMEGA_MCP_KEY` value is wrong. Stop and surface to Matt; do not proceed.
- 400 with Zod error → tool needs args; pick another zero-args tool from PIV-2.
- 200 → auth works. Proceed.

**Cleanup is part of the procedure, not a footnote.** The `.env.production` file must be deleted before the command exits. Never commit it.

### PIV-4 — Env var state confirmation

```bash
npx vercel env ls --yes production | grep -E '^(OMEGA_MCP_KEY|OMEGA_TARGET_USER_ID|OMEGA_MCP_API_KEY|OMEGA_MCP_URL|OMEGA_MCP_ENABLED)'
```

Expected:
- `OMEGA_MCP_KEY` — exists, Sensitive
- `OMEGA_TARGET_USER_ID` — exists, plaintext (`8c24fdf4-1ef7-418a-b155-16a85eb17f6a`)
- `OMEGA_MCP_API_KEY` — exists, deprecated (leave alone)
- `OMEGA_MCP_URL` — exists (`https://pulse-mcp-651478110010.us-central1.run.app`)
- `OMEGA_MCP_ENABLED` — exists (`1`)

If any is missing, stop and surface. Do NOT add env vars in this PR — Matt handled the secret management manually.

### PIV-5 — Call graph audit

Grep for callers of the Omega client surface. Document each in the AAR.

- `src/core/omega/OmegaAdvisoryAdapter.ts` → `readOmegaState`, `evaluateOmegaConfidence`, `readOmegaTraces`
- `src/buddy/server/writeBuddySignal.ts` → `src/lib/omega/mirrorEventToOmega.ts` → `invokeOmega({ resource: "omega://events/write" })`
- `src/app/api/examiner/portal/deals/[dealId]/route.ts:~125` — line may have drifted; grep `omega://state/borrower`

Additional callers (if found) must be documented. Any caller that would be affected by the read-path kill switch should be explicitly listed so the impact is visible.

---

## Implementation plan

Four commits, one PR. Land in order.

### Batch 1 — Fix the two wire-level blockers in `invokeOmega.ts`

**File:** `src/lib/omega/invokeOmega.ts`

**Changes (in order):**

1. **Secret lookup.** Replace `getOmegaMcpApiKey()`:
   ```ts
   function getOmegaMcpApiKey(): string | undefined {
     const newKey = process.env.OMEGA_MCP_KEY;
     if (newKey) return newKey;
     const fallback = process.env.OMEGA_MCP_API_KEY;
     if (fallback) {
       console.warn(
         "[omega] using deprecated OMEGA_MCP_API_KEY env var — rename to OMEGA_MCP_KEY",
       );
       return fallback;
     }
     return undefined;
   }
   ```

2. **Auth header — bug fix.** Replace:
   ```ts
   if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
   ```
   with:
   ```ts
   if (apiKey) headers["x-pulse-mcp-key"] = apiKey;
   ```

3. **JSON-RPC envelope — bug fix.** Replace the direct `method: resource` assignment with `method: "tools/call"` and a translation layer.

4. **URI→tool translation.** Add the helper. Only the write path maps to a real tool; reads kill-switch:
   ```ts
   interface ToolCall {
     tool: string;
     arguments: Record<string, unknown>;
   }

   function getOmegaTargetUserId(): string | undefined {
     return process.env.OMEGA_TARGET_USER_ID || undefined;
   }

   function translateResourceToToolCall(
     resource: string,
     payload: unknown,
   ): ToolCall | null {
     const targetUserId = getOmegaTargetUserId();
     const payloadObj = (payload as Record<string, unknown>) ?? {};

     // Write path — wires to real deployed Pulse tool
     if (resource === "omega://events/write") {
       return {
         tool: "buddy_ledger_write",
         arguments: {
           ...(targetUserId ? { target_user_id: targetUserId } : {}),
           ...payloadObj,
         },
       };
     }

     // Read paths — kill-switched until Pulse ships deal-scoped advisory tools.
     // See specs/omega-repair/PULSE-SIDE-SPEC.md for the Pulse-side work.
     // These return null which causes invokeOmega to surface a specific error.
     const isReadResource =
       /^omega:\/\/(state|confidence|traces|advisory)\//.test(resource) ||
       resource === "omega://confidence/evaluate";

     if (isReadResource) {
       return null; // invokeOmega converts null → "pulse_advisory_tools_not_yet_available"
     }

     return null; // also null for genuinely unknown URIs
   }
   ```

5. **Error handling when translation returns null.** Distinguish "known-read-path-killswitched" from "genuinely unmapped":
   ```ts
   const toolCall = translateResourceToToolCall(resource, payload);
   if (!toolCall) {
     const isReadResource = /^omega:\/\/(state|confidence|traces|advisory)\//.test(resource);
     const err = isReadResource
       ? "pulse_advisory_tools_not_yet_available"
       : `omega_unmapped_resource: ${resource}`;
     throw new Error(err);
   }
   ```

   This produces a specific, searchable error string in `buddy_signal_ledger` for the read path. Not a `Method not found` — an honest, ticketable signal.

6. **Body construction.** With `toolCall` populated, build the correct MCP envelope:
   ```ts
   const body = JSON.stringify({
     jsonrpc: "2.0",
     id: requestId,
     method: "tools/call",
     params: {
       name: toolCall.tool,
       arguments: toolCall.arguments,
     },
   });
   ```

7. **Response unwrapping.** MCP `tools/call` wraps results. Update the unwrap:
   ```ts
   const unwrapped = rpc.result?.structuredContent ?? rpc.result?.content?.[0] ?? rpc.result;
   if (!unwrapped) {
     throw new Error("omega_rpc_empty: no content in response");
   }
   return unwrapped as T;
   ```

**Tests:** `src/lib/omega/__tests__/invokeOmega.test.ts`

- Mock `fetch`. Assert:
  - Body has `method: "tools/call"`, `params.name === "buddy_ledger_write"`, `params.arguments` includes merged payload + target_user_id when present.
  - Header `x-pulse-mcp-key` is set; `Authorization` is not.
- Test `omega://events/write` happy path.
- Test each read resource (`omega://state/underwriting_case/X`, `omega://confidence/evaluate`, `omega://traces/Y`, `omega://state/borrower/Z`) returns `{ ok: false, error: "pulse_advisory_tools_not_yet_available" }`.
- Test genuinely unknown URI (`omega://frobnicate`) returns `{ ok: false, error: "omega_unmapped_resource: ..." }`.
- Test deprecated `OMEGA_MCP_API_KEY` fallback emits warn, still works.
- Regression: timeout, kill-switch, disabled paths unchanged.

### Batch 2 — Adapter: surface the kill-switched reads cleanly

**File:** `src/core/omega/OmegaAdvisoryAdapter.ts`

Current adapter code already tolerates failed sub-calls and returns `stale: true`. The only change needed:

1. When a sub-call fails with error `pulse_advisory_tools_not_yet_available`, set `staleReason` to `"Deal-scoped advisory tools not yet available in Pulse"` so the signal is explicit rather than generic.
2. Optional: add a `source: "omega_read_killswitch"` field to `OmegaAdvisoryState` if the type allows. If it doesn't, skip — not worth widening the type for signaling.

Minimal code change. Most of the adapter's existing graceful-degradation logic already works correctly.

**Tests:** extend `OmegaAdvisoryAdapter` tests (or create first ones).
- All three sub-calls return `pulse_advisory_tools_not_yet_available` → `stale: true`, reason mentions advisory tools.
- Disabled (`OMEGA_MCP_ENABLED !== "1"`) → unchanged from today.

### Batch 3 — Env verification (no commit)

Just runs PIV-4. Documents in AAR that all five env vars are in the expected state. No code change, no commit.

### Batch 4 — Deploy and verify

1. After Batches 1 and 2 merge, production deploy completes, wait 2 minutes.
2. Open cockpit for test deal `d65cc19e-b03e-4f2d-89ce-95ee69472cf3`.
3. Within 5 minutes, query:
   ```sql
   SELECT type, payload->>'resource' as resource, payload->>'error' as error, COUNT(*) as n
   FROM buddy_signal_ledger
   WHERE type LIKE 'omega.%'
     AND created_at > NOW() - INTERVAL '10 minutes'
   GROUP BY type, payload->>'resource', payload->>'error'
   ORDER BY type, n DESC;
   ```
4. **Success criteria:**
   - `omega.succeeded` ≥ 1 (the write path, if any signal mirror fires during cockpit load)
   - `omega.failed` for read paths ALL show `error: pulse_advisory_tools_not_yet_available` (not `Method not found`)
   - Zero `Method not found` errors anywhere
5. If any `Method not found` persists, Batch 1 is incomplete. Revert and diagnose.

### Batch 5 — Roadmap and build principles

Update `BUDDY_PROJECT_ROADMAP.md`:

1. Move D2 (Omega `Method not found` item in Phase 84.1 backlog) to Completed. Reference commit chain.

2. Add completion note to Completed Phases:
   > **Omega wire-level repair + read kill-switch 2026-04-23.** Two wire-level blocker bugs fixed: JSON-RPC method wrong (`omega://` URIs replaced with `tools/call`), auth header wrong (`x-pulse-mcp-key` replaces `Authorization: Bearer`). New `OMEGA_MCP_KEY` env var sourced from GCP Secret Manager `PULSE_MCP_API_KEY` v2. Write path `omega://events/write` → `buddy_ledger_write` working end-to-end. Read path (state/confidence/traces) kill-switched with explicit `pulse_advisory_tools_not_yet_available` signal pending Pulse-side deal-scoped advisory tools (companion spec at `specs/omega-repair/PULSE-SIDE-SPEC.md`). Pre-repair 100% Omega failure rate resolved; ledger now shows honest signal distinguishing write success from read-not-yet-available. Commits: [chain].

3. Add three new build principles:

   > **MCP integration contracts are sourced from the deployed service's `tools/list`, not from in-repo source code.** Services with independent release cycles (Cloud Run deployments, Pulse MCP, Buddy voice gateway) drift from their repo skeletons. The authoritative contract is what the running service currently exposes. Verified 2026-04-23: rev 2 of the Omega repair spec named tools from `PulseMasterrepo:services/pulse-mcp/src/tools/buddy/ledger.ts` (which registers 9 `pulse.*` tools in its `tools/index.ts`); the deployed service exposes 40 tools with different names (`buddy_ledger_write`, not `buddy_write_ledger_event`). Applying rev 2 verbatim would have kept the 100% failure rate. Rule: any MCP client work MUST `POST /{method:"tools/list"}` against the live service and record the actual tool names and schemas before mapping client code. (OMEGA-REPAIR rev 3)

   > **Stop-and-surface is load-bearing. Every spec has a PIV gate; that gate exists to catch wrong assumptions before they become commits.** Three separate moments in the Pulse/Omega arc (D3 pushback → diagnostic, Phase 2 probe → falsified black-hole, rev 2 execution attempt → caught wrong tool names) were only caught because someone stopped partway through and surfaced rather than pushing forward. The cost of another pass is hours; the cost of shipping the wrong change is days or weeks. Rule: whenever execution evidence contradicts the spec, stop and surface before continuing. This applies to Claude, to Claude Code, and to any future contributor. (OMEGA-REPAIR rev 3 — stop-and-surface as a build principle)

   > **MCP JSON-RPC envelope is `tools/call`, not custom method names.** When integrating Buddy with any MCP server, the client always speaks `method: "tools/call"` with `params: {name: <tool>, arguments: <payload>}`. Custom JSON-RPC method names (e.g., `omega://events/write`) are not recognized by any MCP server — an anti-pattern from early prototyping. Auth for `tools/call` is `x-pulse-mcp-key`; `Authorization: Bearer` is for the `/ingest/buddy` path only. Where available, pass `target_user_id` in tool arguments for explicit multi-tenant semantics — though note it is optional in the deployed Pulse schemas, not required. (OMEGA-REPAIR rev 3)

4. Move D2 to Completed; queue in Next Phases: "Pulse-side deal-scoped advisory tools (PULSE-SIDE-SPEC) — unblocks cockpit advisory visibility."

---

## Commit strategy

Three commits, one PR:

1. `feat(omega): repair wire contract — tools/call + x-pulse-mcp-key + write-path wiring + read kill-switch` — Batch 1 + tests
2. `feat(omega): adapter explicit stale-reason for kill-switched reads` — Batch 2 + tests
3. `docs: OMEGA-REPAIR rev 3 roadmap update + three build principles` — Batch 5

Batches 3 and 4 are verification checkpoints, not commits.

---

## Verification protocol

### V-1 — Ledger signal shape

1 hour after deploy, and again at 24 hours:

```sql
SELECT
  type,
  payload->>'error' as error_code,
  COUNT(*) as n
FROM buddy_signal_ledger
WHERE type LIKE 'omega.%'
  AND created_at > NOW() - INTERVAL '1 hour'   -- or '24 hours' at second check
GROUP BY type, payload->>'error'
ORDER BY n DESC;
```

**Success:**
- `omega.succeeded` rows exist (write path firing)
- `omega.failed` rows carry `error: pulse_advisory_tools_not_yet_available` exclusively (no `Method not found`)
- `omega.invoked` ≈ `omega.succeeded` + `omega.failed` (no silent drops)

**Failure modes to watch:**
- Any `Method not found` → Batch 1 is incomplete; revert and re-diagnose
- Any `http_401` → auth is wrong despite Vercel env showing correct var; possibly a deploy cache issue
- `omega.succeeded` = 0 after 24h → write path isn't being triggered, either from test traffic or from signal emission path

### V-2 — Cockpit UX on test deal

Matt opens `d65cc19e-...` and reports. Expected: no visible change from today. Reads stay invisible (kill-switched), `ai_risk_runs` fallback still renders. This is intentional — cockpit improvement requires Pulse-side tools.

If bankers somehow saw new advisory surfaces, that would indicate Pulse shipped deal-scoped tools unexpectedly. Unlikely.

### V-3 — Regression: pipeline unchanged

Run one test pack on Samaritus (`d65cc19e-...`, the 9 fixed documents). Confirm:
- `deal_financial_facts` count identical to pre-repair snapshot
- Spreads unchanged
- Snapshot/recon/UW behavior identical
- No new errors in `buddy_system_events`

### V-4 — Pulse receives write-path events

Matt (out-of-band, since I can't query Pulse's external DB) confirms that after deploy, new rows appear in Pulse's own Postgres corresponding to Buddy's `omega://events/write` calls from the test-deal cockpit load. If Matt sees none, the write path is failing silently somewhere and V-1's `omega.succeeded` counts are misleading.

---

## Rollback

If V-1's 1-hour check shows persistent `Method not found` or `http_401`:

1. Revert Batches 1 and 2. Restores 100% failure rate — but that was the known-safe prior state.
2. Leave env vars in place (no harm).
3. Leave build principles in roadmap (they remain true regardless of repair outcome).
4. Re-diagnose. Repeat stop-and-surface as needed.

SR 11-7 wall means rollback has zero pipeline impact.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| PIV-2 finds `buddy_ledger_write`'s schema differs from expectation | Low | Source from deployed `tools/list` — PIV-2 reads the real schema before coding. Update translator to match. |
| `OMEGA_MCP_KEY` value is wrong despite Matt's copy from Secret Manager | Low | PIV-3 probes `mcp_tick` with the key before any code commits. If 401, stop before writing code. |
| Kill-switch error string `pulse_advisory_tools_not_yet_available` conflicts with existing error signals somewhere | Very low | String is specific and unused. Grep before using to confirm. |
| Pulse-side tools ship before Buddy's follow-up PR lands; new tools wasted | Negligible | Kill switch costs nothing to leave in place; follow-up PR is small (change 4 URIs and remove 1 error branch). |
| Cockpit quietly breaks because adapter's stale-reason string is now longer | Very low | UI doesn't render the stale string beyond a debug attribute; verified by reading adapter consumers. |
| The "mea culpa" section sets a bad precedent for specs to be wordy | Cosmetic | Kept it to one section; build principles internalize the lessons going forward. |

---

## Addendum for Claude Code — judgment boundaries

**Authorized:**
- Read any file in Buddy's repo and in PulseMasterrepo (if accessible — deploy tools/list is authoritative either way)
- Read any table in Buddy's Supabase (read-only)
- Probe the deployed Pulse MCP (`tools/list` unauthenticated, `tools/call` authenticated with `OMEGA_MCP_KEY`)
- Write code changes to `src/lib/omega/` and `src/core/omega/`
- Write tests in `src/lib/omega/__tests__/` and `src/core/omega/__tests__/`
- Commit Batches 1, 2, 5 to `main`

**NOT authorized:**
- Modify any Vercel env var (Matt handled env state; don't overwrite)
- Modify any file in PulseMasterrepo (Pulse-side work is a separate PR per PULSE-SIDE-SPEC.md)
- Silence any ledger signal (diagnostic signals must keep firing for V-1 to be measurable)
- Touch outbox or ledger forwarder code (Phase 2 confirmed working)
- Ship without running all five PIVs and documenting findings in the AAR
- Commit `OMEGA_MCP_KEY` value in any form (code, comment, test fixture, `.env` file, console output, log output)
- Paper over any newly-discovered bug. If a sixth bug surfaces during implementation, stop-and-surface.

**If PIV-2 finds the deployed tool schema for `buddy_ledger_write` differs from this spec's assumption:** update the translator to match. That's not a stop-and-surface — that's execution.

**If PIV-2 finds `buddy_advisory_for_deal` / `buddy_confidence_for_deal` / `buddy_traces_for_deal` have appeared since this spec was written:** stop and surface. The read path can be wired instead of kill-switched, which materially changes the plan.

**If PIV-3 returns 401:** stop and surface. Secret is wrong.

**If Claude Code finds evidence in Buddy's own signal ledger that the write path was already succeeding via some other code path and this spec is about to break it:** stop and surface immediately.

---

## After this lands

Foundation is rock-solid on the wire. Buddy and Pulse talk correctly. Write path carries Buddy's event stream. Read path is honest about being not-yet-wired.

Remaining work, in separable PRs:
1. **PULSE-SIDE-SPEC.md execution** — add `buddy_advisory_for_deal`, `buddy_confidence_for_deal`, `buddy_traces_for_deal` to PulseMasterrepo, deploy. Pulse side, Matt owns.
2. **Buddy follow-up PR** — update URI→tool mapping for reads, lift kill switch. Small PR, ~30 min of work once Pulse tools exist.
3. **Fastlane retire PR** — delete the never-real integration (separate concern).
4. **DLQ replay script** — optional historical telemetry recovery.
5. **Pulse-as-driver architectural rethink** — future spec, now possible from a working baseline.
6. **Deprecate `OMEGA_MCP_API_KEY`** — after 1-2 weeks of stable operation, remove from Vercel.

The repair is not the vision. The repair gives us ground to stand on.
