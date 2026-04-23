# Spec OMEGA-REPAIR — Fix Two Wire-Level Bugs + Kill-Switch the Read Path

**Date:** 2026-04-23 (rev 3.1; small amendment to rev 3 — PIV-3 procedure reworked for Sensitive-flagged secrets, health.ts mapping added)
**Supersedes:** Prior rev 2 at commit `bf55258b`, rev 3 at commit `0277ec64`
**Owner:** Matt (owns both sides of the contract — Buddy and Pulse)
**Executor:** Claude Code
**Accessible repos:** `29xh24fm6r-ctrl/Buddy-The-Underwriter` (Buddy-side changes). `29xh24fm6r-ctrl/PulseMasterrepo` access varies by credential; not required for this repair — see PIV-2.
**Estimated effort:** 3–5 hours total.
**Risk:** Low. No pipeline impact (SR 11-7 wall).

---

## What changed in rev 3.1

After Claude Code ran PIVs against rev 3, two spec bugs surfaced:

1. **PIV-3 procedure was unrunnable as written.** Vercel's `env pull` intentionally returns empty values for Sensitive-flagged env vars (confirmed against Vercel docs). Rev 3's PIV-3 told Claude Code to pull the key locally and probe — but the pull returns empty, so the probe always 401s regardless of whether the stored value is correct or not. Rev 3.1 replaces this with a manual out-of-band probe Matt runs himself.

2. **Health-check URI was unmapped.** `src/lib/omega/health.ts` calls `invokeOmega({ resource: "omega://health/ping" })`. Rev 3's translator regex matched `(state|confidence|traces|advisory)` but not `health`. After rev 3 lands, every health check would surface `omega_unmapped_resource: omega://health/ping` — a worse signal than today's honest `Method not found`. Rev 3.1 maps `omega://health/ping` → `mcp_tick` (Pulse's deployed health-check tool).

The rest of rev 3 (the mea culpa, the two wire fixes, the kill-switch design) is unchanged.

---

## Why rev 3 existed (preserved for history)

Rev 2 ("four bugs, wire reads to `state_inspect`/`state_confidence`/`observer_query`") was wrong on three points that only surfaced when Claude Code began execution:

1. **Wrong tool names.** Rev 2 named tools `buddy_write_ledger_event`, `buddy_list_ledger_events`, etc. The deployed Pulse MCP actually exposes them as `buddy_ledger_write`, `buddy_ledger_list`, `buddy_ledger_deal`, `buddy_ledger_flow_health`. Applying rev 2 verbatim would have kept the 100% failure rate — same `-32601 Method not found` error, different specific tool name.

2. **Wrong assumption about `target_user_id` being required.** Pulse's tool schemas mark `target_user_id` as *optional* ("If omitted, server injects default target user"). Rev 2 framed its absence as a bug blocking calls with Zod validation errors. Refuted by the deployed schema. Passing it is still good multi-tenant hygiene, but not a wire-level blocker.

3. **Wrong semantic model for reads.** Rev 2 assumed `state_inspect` / `state_confidence` / `observer_query` accept deal-scoped arguments (e.g., `entity_id`, `session_id`). They don't. The deployed schemas are user-scoped only. Rev 2's wire-level fix would have succeeded at the RPC level and returned data unrelated to the deal the adapter asked about.

**Root cause of rev 2's errors:** sourced tool names and schemas from in-repo code which turned out to not match deployed reality. **In-repo code is not authoritative for deployed contracts. The deployed `tools/list` is.**

---

## The actual problem

Omega advisory is 100% failing in production. 53/53 `omega.invoked` → `omega.failed` in the last 30 days, all with `omega_rpc_error: Method not found`.

After correcting rev 2's errors:

**Two wire-level blocker bugs** (both must be fixed for any Omega call to succeed):
1. **Wrong JSON-RPC method.** `src/lib/omega/invokeOmega.ts:144` sends `method: "omega://events/write"` directly. The deployed Pulse MCP only recognizes JSON-RPC methods `tools/list` and `tools/call`. The entire `omega://` namespace is client-side fiction.
2. **Wrong auth header.** `invokeOmega.ts:138` sends `Authorization: Bearer ${apiKey}`. Pulse MCP's auth middleware reads the `x-pulse-mcp-key` header only.

**One secret change, already applied:** `OMEGA_MCP_KEY` is set in Vercel (Production + Preview, marked Sensitive) with the value from GCP Secret Manager's `PULSE_MCP_API_KEY` v2.

**Two write/health-path tool mappings that work today:**
- `omega://events/write` → `buddy_ledger_write` (event mirror to Pulse governance store)
- `omega://health/ping` → `mcp_tick` (Pulse's designated connectivity probe — "Connectivity proof and round-trip verification through Omega Gate")

**A design-level gap on the read path:** Buddy's cockpit expects deal-scoped advisory reads. Pulse does not currently expose deal-scoped advisory primitives. Kill-switched until Pulse ships purpose-built tools (see `specs/omega-repair/PULSE-SIDE-SPEC.md`).

## The chosen shape of repair (B1)

**Buddy side (this spec, this PR):**
- Fix the two wire-level blockers.
- Wire the write path and the health path: real-tool mappings with known-good semantics.
- Kill-switch the three read helpers with explicit `pulse_advisory_tools_not_yet_available` error.
- Adapter continues returning `stale: true, staleReason: "Deal-scoped advisory tools not yet available in Pulse"`.

**Pulse side (separate spec, separate PR, separate repo):**
- Design and implement three deal-scoped advisory tools per `PULSE-SIDE-SPEC.md`.

**Follow-up Buddy PR (after Pulse ships):**
- Update URI→tool mapping to route reads to the new Pulse tools.
- Lift the kill switch.

## Outcome we want from this PR

- Every Omega call reaches the deployed Pulse MCP with a well-formed `tools/call` envelope and correct auth.
- `buddy_signal_ledger` shows:
  - `omega.succeeded` for `omega://events/write` (write path working)
  - `omega.succeeded` for `omega://health/ping` (health check working)
  - `omega.failed` with `payload.error: "pulse_advisory_tools_not_yet_available"` for reads (honest kill-switch, not `Method not found`)
- Pulse's external DB receives Buddy's event mirror.
- Cockpit UX on test deal `d65cc19e-...` is identical to today. UX improvement requires Pulse-side tools.
- SR 11-7 wall preserved.

## Non-goals

- Not making cockpit advisory panels visible — requires Pulse-side tools.
- Not redesigning client abstractions.
- Not rethinking request-response vs event-driven (future spec).
- Not replaying the 336 pre-Feb-17 DLQ rows (separate optional PR).
- Not retiring the fastlane (separate PR).
- Not modifying PulseMasterrepo.

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

Expected: `omega.invoked` ≈ 53, `omega.failed` ≈ 53, `omega.succeeded` = 0. Record exact values.

### PIV-2 — Read deployed tool contracts from `tools/list`, not from source

Do NOT read `PulseMasterrepo` as source of truth. The authoritative source is the live `tools/list` endpoint.

```bash
curl -sS -X POST https://pulse-mcp-651478110010.us-central1.run.app/ \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"piv2","method":"tools/list"}' | jq '.result.tools[] | {name, description, inputSchema}' > /tmp/pulse-tools.json
```

Record:
1. `buddy_ledger_write` exists with expected schema (required: `event_type`, `status`; optional: `target_user_id`, `deal_id`, `payload`, etc.). Surface if schema differs.
2. `mcp_tick` exists as zero-args tool (used for health mapping).
3. `buddy_advisory_for_deal` / `buddy_confidence_for_deal` / `buddy_traces_for_deal` do NOT exist. If any have appeared since this spec was written, surface (plan changes materially — reads can be wired instead of kill-switched).

### PIV-3 — Verify `OMEGA_MCP_KEY` authenticates end-to-end (MATT RUNS THIS — REVISED)

**Changed in rev 3.1:** Vercel's `env pull` returns empty values for Sensitive-flagged secrets by design. Claude Code cannot pull `OMEGA_MCP_KEY` locally and probe with it. Matt runs this probe from his own terminal instead:

```bash
# Matt pastes the OMEGA_MCP_KEY value inline (NEVER commit; clear clipboard after)
curl -sS -i -X POST https://pulse-mcp-651478110010.us-central1.run.app/ \
  -H "content-type: application/json" \
  -H "x-pulse-mcp-key: <PASTE_KEY_VALUE_HERE>" \
  -d '{"jsonrpc":"2.0","id":"piv3","method":"tools/call","params":{"name":"mcp_tick","arguments":{}}}'
```

Matt reports just the first-line HTTP status back to Claude Code:
- 200 → auth works, proceed with all batches
- 401 → key value is wrong in Vercel; stop and surface
- 400 with Zod error → pick another zero-args tool from PIV-2's recorded list

**Claude Code does NOT run this.** Claude Code does NOT request the key value. Matt's probe result is the input; Claude Code writes the AAR with Matt's reported status.

### PIV-4 — Env var state confirmation

```bash
npx vercel env ls --yes production | grep -E '^(OMEGA_MCP_KEY|OMEGA_TARGET_USER_ID|OMEGA_MCP_API_KEY|OMEGA_MCP_URL|OMEGA_MCP_ENABLED)'
```

Expected:
- `OMEGA_MCP_KEY` — exists, Sensitive
- `OMEGA_TARGET_USER_ID` — exists (plaintext preferred so `env pull` can verify value; if Sensitive by accident, Matt will separately confirm the UUID is `8c24fdf4-1ef7-418a-b155-16a85eb17f6a`)
- `OMEGA_MCP_API_KEY` — exists, deprecated (leave alone)
- `OMEGA_MCP_URL` — exists
- `OMEGA_MCP_ENABLED` — exists (`1`)

If any is missing, stop and surface. Do NOT add env vars.

### PIV-5 — Call graph audit

Grep for callers of the Omega client surface. Document each. Known callers:

- `src/core/omega/OmegaAdvisoryAdapter.ts` → `readOmegaState`, `evaluateOmegaConfidence`, `readOmegaTraces` (all read-path, kill-switched)
- `src/lib/omega/mirrorEventToOmega.ts:~83` → `invokeOmega({ resource: "omega://events/write" })` (write-path, mapped to `buddy_ledger_write`)
- `src/lib/omega/health.ts:~56` → `invokeOmega({ resource: "omega://health/ping" })` (health-path, mapped to `mcp_tick` per rev 3.1)
- `src/app/api/deals/[dealId]/underwrite/state/route.ts` → `omega://advisory/deal-focus` (read-path, kill-switched)
- `src/app/api/examiner/portal/deals/[dealId]/route.ts` → calls `readOmegaState` indirectly (read-path, kill-switched)

If additional callers surface beyond these, document them. Any resource not covered by the translator's mappings or read regex falls to `omega_unmapped_resource` — stop-and-surface if that's a real caller.

---

## Implementation plan

Three commits, one PR.

### Batch 1 — Fix two wire-level blockers, wire write + health paths, kill-switch reads

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

2. **Auth header.** Replace `Authorization: Bearer` with `x-pulse-mcp-key`.

3. **URI→tool translation (REVISED in rev 3.1 to add health mapping):**
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
     const baseArgs = targetUserId ? { target_user_id: targetUserId } : {};

     // Write path — real tool
     if (resource === "omega://events/write") {
       return {
         tool: "buddy_ledger_write",
         arguments: { ...baseArgs, ...payloadObj },
       };
     }

     // Health path — real tool (mcp_tick is Pulse's designated connectivity probe)
     if (resource === "omega://health/ping") {
       return {
         tool: "mcp_tick",
         arguments: {}, // mcp_tick is zero-args; do not pass target_user_id
       };
     }

     // Read paths — kill-switched until Pulse ships deal-scoped advisory tools.
     // See specs/omega-repair/PULSE-SIDE-SPEC.md for Pulse-side work.
     const isReadResource = /^omega:\/\/(state|confidence|traces|advisory)\//.test(resource);
     if (isReadResource) {
       return null; // converts to "pulse_advisory_tools_not_yet_available"
     }

     // Genuinely unknown URI
     return null;
   }
   ```

4. **Error handling when translation returns null.** Distinguish read-killswitched from unmapped:
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

5. **Body construction.**
   ```ts
   const body = JSON.stringify({
     jsonrpc: "2.0",
     id: requestId,
     method: "tools/call",
     params: { name: toolCall.tool, arguments: toolCall.arguments },
   });
   ```

6. **Response unwrapping.**
   ```ts
   const unwrapped = rpc.result?.structuredContent ?? rpc.result?.content?.[0] ?? rpc.result;
   if (!unwrapped) throw new Error("omega_rpc_empty: no content in response");
   return unwrapped as T;
   ```

**Tests:** `src/lib/omega/__tests__/invokeOmega.test.ts`

- Mock `fetch`. Assert:
  - Body has `method: "tools/call"`, `params.name === "buddy_ledger_write"` for write, `params.name === "mcp_tick"` for health.
  - Header `x-pulse-mcp-key` is set; `Authorization` is not.
  - `target_user_id` injected for write path when env var present, NOT injected for `mcp_tick`.
- Test `omega://events/write` → `buddy_ledger_write`.
- Test `omega://health/ping` → `mcp_tick` with zero args.
- Test each read resource returns `{ ok: false, error: "pulse_advisory_tools_not_yet_available" }`.
- Test genuinely unknown URI (`omega://frobnicate`) returns `{ ok: false, error: "omega_unmapped_resource: ..." }`.
- Test deprecated `OMEGA_MCP_API_KEY` fallback emits warn, still works.
- Regression: timeout, kill-switch, disabled paths unchanged.

### Batch 2 — Adapter: explicit stale-reason for kill-switched reads

**File:** `src/core/omega/OmegaAdvisoryAdapter.ts`

When a sub-call fails with `pulse_advisory_tools_not_yet_available`, set `staleReason` to `"Deal-scoped advisory tools not yet available in Pulse"`. Minimal change; most of the adapter's graceful-degradation already works.

**Tests:** extend adapter tests.
- All three sub-calls return `pulse_advisory_tools_not_yet_available` → `stale: true`, reason mentions advisory tools.
- Disabled path unchanged.

### Batch 3 — Env verification (no commit)

Runs PIV-4. Documents env state in AAR. No code change.

### Batch 4 — Deploy and verify

1. After Batches 1 and 2 merge, production deploy completes, wait 2 minutes.
2. Open cockpit for test deal `d65cc19e-b03e-4f2d-89ce-95ee69472cf3`.
3. Hit a route that triggers health check (e.g., `/api/buddy/observer/health`).
4. Within 5 minutes, query:
   ```sql
   SELECT type, payload->>'resource' as resource, payload->>'error' as error, COUNT(*) as n
   FROM buddy_signal_ledger
   WHERE type LIKE 'omega.%'
     AND created_at > NOW() - INTERVAL '10 minutes'
   GROUP BY type, payload->>'resource', payload->>'error'
   ORDER BY type, n DESC;
   ```
5. **Success criteria:**
   - `omega.succeeded` for `omega://health/ping` (health works)
   - `omega.succeeded` for `omega://events/write` if cockpit load triggered signal mirror
   - `omega.failed` for reads ALL show `error: pulse_advisory_tools_not_yet_available`
   - Zero `Method not found` errors
6. If any `Method not found` persists, Batch 1 is incomplete. Revert and diagnose.

### Batch 5 — Roadmap and build principles

Update `BUDDY_PROJECT_ROADMAP.md`:

1. Move D2 to Completed. Reference commit chain.
2. Add completion note mentioning write-path + health-path wired, read-path kill-switched, PULSE-SIDE-SPEC as follow-up.
3. Add four build principles:

   > **MCP integration contracts are sourced from the deployed service's `tools/list`, not from in-repo source code.** Services with independent release cycles drift from repo skeletons. The authoritative contract is what the running service currently exposes. Rev 2 of the Omega repair named tools from in-repo source and would have kept the 100% failure rate. Rule: any MCP client work MUST `POST /{method:"tools/list"}` against the live service and record the actual tool names and schemas before mapping client code. (OMEGA-REPAIR rev 3.1)

   > **Stop-and-surface is load-bearing. Every spec has a PIV gate; that gate exists to catch wrong assumptions before they become commits.** Three moments in the Pulse/Omega arc (D3 pushback → diagnostic, Phase 2 probe → falsified black-hole, rev 2 execution attempt → caught wrong tool names, rev 3 PIV → caught unrunnable PIV-3 + unmapped health URI) were only caught because someone stopped partway through and surfaced. Cost of another pass is hours; cost of shipping the wrong change is days or weeks. Rule: whenever execution evidence contradicts the spec, stop and surface before continuing. Applies to Claude, Claude Code, and any future contributor. (OMEGA-REPAIR rev 3.1)

   > **MCP JSON-RPC envelope is `tools/call`, not custom method names.** When integrating Buddy with any MCP server, the client speaks `method: "tools/call"` with `params: {name: <tool>, arguments: <payload>}`. Custom JSON-RPC method names (e.g., `omega://events/write`) are not recognized by any MCP server. Auth for `tools/call` is `x-pulse-mcp-key`; `Authorization: Bearer` is for the `/ingest/buddy` path only. `target_user_id` is optional in Pulse schemas — pass it for explicit multi-tenant semantics, but absence does not block calls. (OMEGA-REPAIR rev 3.1)

   > **Vercel's `env pull` returns empty values for Sensitive-flagged env vars by design.** PIV procedures or diagnostic scripts that need the actual secret value cannot rely on `env pull` for Sensitive vars. Options: (a) Matt runs the probe manually with the key pasted inline out-of-band, (b) use the Vercel REST API `GET /v1/projects/{id}/env/{envId}` with an API token (also excludes Sensitive values from the default response), (c) deploy a diagnostic endpoint that reads `process.env.VAR` server-side and returns only a status (never the value). Confirmed via Vercel docs 2026-04-23. Rule: any PIV that requires local access to a secret's value must account for Sensitive-flagging at spec-write time. (OMEGA-REPAIR rev 3.1)

4. Queue in Next Phases: "Pulse-side deal-scoped advisory tools (PULSE-SIDE-SPEC) — unblocks cockpit advisory visibility."

---

## Commit strategy

Three commits, one PR:

1. `feat(omega): repair wire contract — tools/call + x-pulse-mcp-key + write/health mapping + read kill-switch` — Batch 1 + tests
2. `feat(omega): adapter explicit stale-reason for kill-switched reads` — Batch 2 + tests
3. `docs: OMEGA-REPAIR rev 3.1 roadmap update + four build principles` — Batch 5

Batches 3 and 4 are verification checkpoints, not commits.

---

## Verification protocol

### V-1 — Ledger signal shape

1 hour and 24 hours after deploy:

```sql
SELECT type, payload->>'error' as error_code, COUNT(*) as n
FROM buddy_signal_ledger
WHERE type LIKE 'omega.%'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY type, payload->>'error'
ORDER BY n DESC;
```

**Success:**
- `omega.succeeded` rows exist for write path and health path
- `omega.failed` rows carry `error: pulse_advisory_tools_not_yet_available` exclusively (no `Method not found`)
- `omega.invoked` ≈ `omega.succeeded` + `omega.failed` (no silent drops)

**Failure modes:**
- Any `Method not found` → Batch 1 incomplete; revert
- Any `http_401` → auth is wrong; could be stale deploy cache OR wrong key value; Matt re-runs PIV-3
- `omega.succeeded` = 0 after 24h → nothing is calling the write or health paths

### V-2 — Cockpit UX on test deal

Matt opens `d65cc19e-...`, reports. Expected: no visible change. Reads invisible (kill-switched), `ai_risk_runs` fallback renders.

### V-3 — Regression: pipeline unchanged

Run test pack on Samaritus. Confirm `deal_financial_facts` count unchanged, spreads unchanged, pipeline behavior identical.

### V-4 — Pulse receives write-path events

Matt confirms (out-of-band, Pulse's own Postgres) new rows from Buddy's signal mirror.

---

## Rollback

If V-1's 1-hour check shows persistent `Method not found` or `http_401`:

1. Revert Batches 1 and 2.
2. Leave env vars in place.
3. Leave build principles in roadmap.
4. Re-diagnose.

SR 11-7 wall = zero pipeline impact on rollback.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| PIV-2 finds `buddy_ledger_write` schema differs | Low | PIV-2 reads real schema; translator updated to match |
| `OMEGA_MCP_KEY` value wrong | Medium (given rev 3.1 amendment found verification was structurally blocked) | PIV-3 revised to Matt's manual probe; 401 → stop before any code commit |
| `OMEGA_TARGET_USER_ID` pulled empty — could be Sensitive-flag artifact or genuinely empty | Low impact either way | Matt verifies UUID value out-of-band; tools accept omission (server injects default) so even empty is non-fatal, just defeats hygiene |
| `mcp_tick` returns unexpected shape | Very low | Pulse-side tool is stable ("Connectivity proof"); `health.ts` only checks `result.ok`, not shape |
| Read regex misses a caller | Low | PIV-5 audits full call graph; `health.ts` was caught in rev 3.1 |
| Pulse-side tools ship before Buddy follow-up PR | Negligible | Kill switch is cheap to remove |

---

## Addendum for Claude Code — judgment boundaries

**Authorized:**
- Read any file in Buddy's repo
- Read any table in Buddy's Supabase (read-only)
- Probe deployed Pulse MCP with `tools/list` (unauthenticated discovery only)
- Write code to `src/lib/omega/`, `src/core/omega/`, and test files
- Commit Batches 1, 2, 5 to `main`

**NOT authorized:**
- Run PIV-3 — Matt runs the manual probe. Claude Code only records Matt's reported result.
- Modify any Vercel env var
- Modify any file in PulseMasterrepo
- Silence any ledger signal
- Touch outbox or ledger forwarder code
- Ship without all five PIVs documented in AAR
- Commit secret values in any form
- Paper over newly-discovered bugs — stop-and-surface

**If Matt reports PIV-3 returned 401:** stop and surface. Do not commit Batches 1/2 until the key is corrected.

**If PIV-2 finds `buddy_advisory_for_deal` etc. have been added to Pulse:** stop and surface. Plan changes materially.

**If a new caller of `invokeOmega` surfaces that isn't in PIV-5's list and isn't covered by the translator:** stop and surface. Don't paper over with another regex extension without consulting Matt.

**Ordering note:** Batches 1 and 2 may begin before Matt's PIV-3 manual probe completes. The code changes are correct independent of whether the stored key is right. But do NOT deploy (Batch 4) until PIV-3 returns 200. If it returns 401, revert before any production traffic hits the new code.

---

## After this lands

Foundation is rock-solid on the wire. Buddy and Pulse talk correctly. Write path + health path carry real Pulse tool calls. Read path is honest about being not-yet-wired.

Remaining work:
1. **PULSE-SIDE-SPEC.md execution** — add deal-scoped advisory tools to PulseMasterrepo.
2. **Buddy follow-up PR** — lift kill switch once Pulse ships. ~30 min work.
3. **Fastlane retire PR** — separate concern.
4. **DLQ replay** — optional.
5. **Pulse-as-driver rethink** — future spec.
6. **Deprecate `OMEGA_MCP_API_KEY`** — 1-2 weeks of stable operation, then remove.

The repair is not the vision. The repair gives us ground to stand on.
