# Spec OMEGA-REPAIR — Fix Two Wire-Level Bugs + Kill-Switch the Read Path

**Date:** 2026-04-23 (rev 3.2; small amendment to rev 3.1 — PIV-3 deferred to Batch 4 after out-of-band auth diagnostic exhausted chat-based resolution paths)
**Supersedes:** Prior rev 2 at commit `bf55258b`, rev 3 at commit `0277ec64`, rev 3.1 at commit `75eafb42`
**Owner:** Matt (owns both sides of the contract — Buddy and Pulse)
**Executor:** Claude Code
**Accessible repos:** `29xh24fm6r-ctrl/Buddy-The-Underwriter` (Buddy-side changes). `29xh24fm6r-ctrl/PulseMasterrepo` access varies by credential; not required for this repair.
**Estimated effort:** 3–5 hours total.
**Risk:** Low. No pipeline impact (SR 11-7 wall).

---

## What changed in rev 3.2

Matt ran the rev 3.1 PIV-3 manual probe. Both Secret Manager versions of `PULSE_MCP_API_KEY` (v1 32 chars, v2 25 chars) returned HTTP 401 when probed via curl, despite the deployed Cloud Run revision `pulse-mcp-00895-4qc` pinning `PULSE_MCP_API_KEY` env var to `secretKeyRef: { name: PULSE_MCP_API_KEY, key: '2' }` — the same source value. Meanwhile, Claude's own chat-session Pulse MCP connector authenticates successfully against the same URL.

The discrepancy could not be resolved from chat. Possibilities include:
- MCP protocol handshake differs from raw HTTP — Claude's connector may use a transport Buddy doesn't
- IP allowlist or Cloud Run ingress config
- Deployed PulseMasterrepo code having evolved past the `auth.ts` we can read
- Something about the Vercel runtime network path that differs from local curl

**None of these block the code work.** The code changes in Batches 1 and 2 are correct independent of whether the stored key is right. Vercel's runtime reads `OMEGA_MCP_KEY` from its encrypted store (not through the CLI pull path we were testing from) — the runtime path may succeed where curl does not.

**Rev 3.2 change:** PIV-3 becomes "deferred — verified by production ledger post-deploy." Claude Code proceeds with Batches 1, 2, 5 without blocking. Batch 4's ledger check is now the authoritative test of whether auth works end-to-end. Worst case (persistent `http_401`): code is still correct, signal is still honest, Matt owns the Pulse-side auth investigation as a separate workstream. SR 11-7 wall means zero pipeline impact either way.

## What carries forward from rev 3.1

- Two wire-level fixes (method + header)
- Write path: `omega://events/write` → `buddy_ledger_write`
- Health path: `omega://health/ping` → `mcp_tick` (rev 3.1 addition)
- Read path: kill-switched with `pulse_advisory_tools_not_yet_available` error
- Four build principles (rev 3.1)

Adding one build principle in rev 3.2 capturing the lesson from the auth diagnostic loop.

---

## Why rev 3 existed (preserved for history)

Rev 2 ("four bugs, wire reads to `state_inspect`/`state_confidence`/`observer_query`") was wrong on three points that only surfaced when Claude Code began execution:

1. **Wrong tool names.** Rev 2 named tools `buddy_write_ledger_event`, `buddy_list_ledger_events`, etc. The deployed Pulse MCP actually exposes them as `buddy_ledger_write`, `buddy_ledger_list`, `buddy_ledger_deal`, `buddy_ledger_flow_health`. Applying rev 2 verbatim would have kept the 100% failure rate — same `-32601 Method not found` error, different specific tool name.

2. **Wrong assumption about `target_user_id` being required.** Pulse's tool schemas mark `target_user_id` as *optional*. Refuted by the deployed schema. Passing it is still good multi-tenant hygiene, but not a wire-level blocker.

3. **Wrong semantic model for reads.** Rev 2 assumed `state_inspect` / `state_confidence` / `observer_query` accept deal-scoped arguments. They don't. The deployed schemas are user-scoped only. Rev 2's wire-level fix would have succeeded at the RPC level and returned data unrelated to the deal.

**Root cause of rev 2's errors:** sourced tool names and schemas from in-repo code which turned out to not match deployed reality. **In-repo code is not authoritative for deployed contracts. The deployed `tools/list` is.**

---

## The actual problem

Omega advisory is 100% failing in production. 53/53 `omega.invoked` → `omega.failed` in the last 30 days, all with `omega_rpc_error: Method not found`.

**Two wire-level blocker bugs** (both must be fixed for any Omega call to succeed):
1. **Wrong JSON-RPC method.** `src/lib/omega/invokeOmega.ts:144` sends `method: "omega://events/write"` directly. The deployed Pulse MCP only recognizes JSON-RPC methods `tools/list` and `tools/call`. The entire `omega://` namespace is client-side fiction.
2. **Wrong auth header.** `invokeOmega.ts:138` sends `Authorization: Bearer ${apiKey}`. Pulse MCP's auth middleware reads the `x-pulse-mcp-key` header only.

**One secret change, already applied:** `OMEGA_MCP_KEY` is set in Vercel (Production + Preview, marked Sensitive). Its runtime correctness is now verified by Batch 4 post-deploy, not by PIV-3.

**Two real-tool mappings:**
- `omega://events/write` → `buddy_ledger_write` (event mirror to Pulse governance store)
- `omega://health/ping` → `mcp_tick` (Pulse's designated connectivity probe)

**Design-level gap on the read path:** Buddy's cockpit expects deal-scoped advisory reads. Pulse does not currently expose deal-scoped advisory primitives. Kill-switched until Pulse ships purpose-built tools (see `specs/omega-repair/PULSE-SIDE-SPEC.md`).

## The chosen shape of repair (B1)

**Buddy side (this PR):** Wire fixes + write-path wiring + health-path wiring + read-path kill-switch.

**Pulse side (separate PR per PULSE-SIDE-SPEC.md):** Deal-scoped advisory tools.

**Follow-up Buddy PR:** Lift kill switch once Pulse ships.

## Outcome we want

- Every Omega call reaches the deployed Pulse MCP with a well-formed `tools/call` envelope and correct auth.
- `buddy_signal_ledger` shows:
  - Either `omega.succeeded` rows (auth works in the Vercel runtime path) — ideal case
  - Or `omega.failed` rows with `http_401` (auth doesn't work in Vercel runtime path either; code is still correct; Matt owns separate Pulse-side auth diagnostic)
  - `omega.failed` for reads ALL carry `error: pulse_advisory_tools_not_yet_available` (NOT `Method not found` — rev 3 bug eliminated)
  - Zero `Method not found` anywhere
- Cockpit UX on `d65cc19e-...` is identical to today.
- SR 11-7 wall preserved.

## Non-goals

- Not making cockpit advisory panels visible — requires Pulse-side tools.
- Not resolving the Pulse-side auth mystery (separate workstream).
- Not redesigning client abstractions.
- Not rethinking request-response vs event-driven.
- Not replaying DLQ.
- Not retiring the fastlane.
- Not modifying PulseMasterrepo.

---

## Pre-implementation verification (MANDATORY)

Claude Code MUST complete all applicable PIVs before writing code. Surface any finding that contradicts the spec.

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

```bash
curl -sS -X POST https://pulse-mcp-651478110010.us-central1.run.app/ \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"piv2","method":"tools/list"}' | jq '.result.tools[] | {name, description, inputSchema}' > /tmp/pulse-tools.json
```

Record:
1. `buddy_ledger_write` exists with expected schema (required: `event_type`, `status`; optional: `target_user_id`, `deal_id`, `payload`, etc.). Surface if schema differs.
2. `mcp_tick` exists as zero-args tool (used for health mapping).
3. `buddy_advisory_for_deal` / `buddy_confidence_for_deal` / `buddy_traces_for_deal` do NOT exist. If any have appeared since this spec was written, surface (plan changes materially).

### PIV-3 — DEFERRED (REVISED IN REV 3.2)

**Not run pre-implementation.** Matt's rev 3.1 manual probe exhausted chat-resolvable diagnostic paths; the deployed Pulse MCP rejects curl probes with 401 using the same secret source the Cloud Run revision is configured to read, but accepts Claude's MCP-protocol connection. The discrepancy is out of scope for this PR.

**Auth verification is deferred to Batch 4** (production ledger check). If writes show `omega.succeeded` → auth works in the Vercel runtime path, repair complete. If writes show `http_401` → code is still correct but Pulse-side auth mystery persists; Matt owns that as a separate Pulse-side workstream. Either outcome leaves the pipeline untouched.

**Claude Code does NOT attempt to probe with `OMEGA_MCP_KEY`. Claude Code does NOT request the key value. PIV-3 is marked "deferred" in the AAR with a pointer to this spec section.**

### PIV-4 — Env var state confirmation

```bash
npx vercel env ls --yes production | grep -E '^(OMEGA_MCP_KEY|OMEGA_TARGET_USER_ID|OMEGA_MCP_API_KEY|OMEGA_MCP_URL|OMEGA_MCP_ENABLED)'
```

Expected:
- `OMEGA_MCP_KEY` — exists, Sensitive
- `OMEGA_TARGET_USER_ID` — exists (if Sensitive, Matt separately confirms UUID value)
- `OMEGA_MCP_API_KEY` — exists, deprecated
- `OMEGA_MCP_URL` — exists
- `OMEGA_MCP_ENABLED` — exists (`1`)

If any is missing, stop and surface.

### PIV-5 — Call graph audit

Known callers:

- `src/core/omega/OmegaAdvisoryAdapter.ts` → `readOmegaState`, `evaluateOmegaConfidence`, `readOmegaTraces` (read-path, kill-switched)
- `src/lib/omega/mirrorEventToOmega.ts:~83` → `invokeOmega({ resource: "omega://events/write" })` (write-path, mapped to `buddy_ledger_write`)
- `src/lib/omega/health.ts:~56` → `invokeOmega({ resource: "omega://health/ping" })` (health-path, mapped to `mcp_tick`)
- `src/app/api/deals/[dealId]/underwrite/state/route.ts` → `omega://advisory/deal-focus` (read-path, kill-switched)
- `src/app/api/examiner/portal/deals/[dealId]/route.ts` → calls `readOmegaState` indirectly (read-path, kill-switched)

If additional callers surface beyond these, document them. Any resource not covered by the translator's mappings or read regex falls to `omega_unmapped_resource` — stop-and-surface if that's a real caller.

---

## Implementation plan

Three commits, one PR.

### Batch 1 — Fix two wire-level blockers, wire write + health paths, kill-switch reads

**File:** `src/lib/omega/invokeOmega.ts`

**Changes (in order):**

1. **Secret lookup.**
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

3. **URI→tool translation:**
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

     if (resource === "omega://events/write") {
       return {
         tool: "buddy_ledger_write",
         arguments: { ...baseArgs, ...payloadObj },
       };
     }

     if (resource === "omega://health/ping") {
       return {
         tool: "mcp_tick",
         arguments: {},
       };
     }

     const isReadResource = /^omega:\/\/(state|confidence|traces|advisory)\//.test(resource);
     if (isReadResource) return null;

     return null;
   }
   ```

4. **Error handling:**
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

5. **Body construction:**
   ```ts
   const body = JSON.stringify({
     jsonrpc: "2.0",
     id: requestId,
     method: "tools/call",
     params: { name: toolCall.tool, arguments: toolCall.arguments },
   });
   ```

6. **Response unwrapping:**
   ```ts
   const unwrapped = rpc.result?.structuredContent ?? rpc.result?.content?.[0] ?? rpc.result;
   if (!unwrapped) throw new Error("omega_rpc_empty: no content in response");
   return unwrapped as T;
   ```

**Tests:** `src/lib/omega/__tests__/invokeOmega.test.ts`

- Mock `fetch`. Assert body has `method: "tools/call"`, correct tool names per URI, `x-pulse-mcp-key` header set, `Authorization` not set.
- Test `omega://events/write` → `buddy_ledger_write`.
- Test `omega://health/ping` → `mcp_tick` with zero args.
- Test read resources return `{ ok: false, error: "pulse_advisory_tools_not_yet_available" }`.
- Test unknown URI returns `{ ok: false, error: "omega_unmapped_resource: ..." }`.
- Test deprecated `OMEGA_MCP_API_KEY` fallback emits warn, works.
- Regression: timeout, kill-switch, disabled paths unchanged.

### Batch 2 — Adapter: explicit stale-reason for kill-switched reads

**File:** `src/core/omega/OmegaAdvisoryAdapter.ts`

When a sub-call fails with `pulse_advisory_tools_not_yet_available`, set `staleReason` to `"Deal-scoped advisory tools not yet available in Pulse"`.

**Tests:** extend adapter tests.

### Batch 3 — Env verification (no commit)

Runs PIV-4. Documents state in AAR.

### Batch 4 — Deploy and verify (NOW THE AUTHORITATIVE AUTH TEST)

1. After Batches 1 and 2 merge, production deploy completes, wait 2 minutes.
2. Open cockpit for test deal `d65cc19e-b03e-4f2d-89ce-95ee69472cf3`.
3. Hit a route that triggers health check (`/api/buddy/observer/health` or similar).
4. Within 5 minutes, query:
   ```sql
   SELECT type, payload->>'resource' as resource, payload->>'error' as error, COUNT(*) as n
   FROM buddy_signal_ledger
   WHERE type LIKE 'omega.%'
     AND created_at > NOW() - INTERVAL '10 minutes'
   GROUP BY type, payload->>'resource', payload->>'error'
   ORDER BY type, n DESC;
   ```

5. **Three possible outcomes:**

   **(A) Full success.** `omega.succeeded` for write and health paths; reads show `pulse_advisory_tools_not_yet_available`; zero `Method not found`, zero `http_401`. Repair complete.

   **(B) Auth 401 in Vercel runtime path too.** `omega.failed` rows show `http_401` for write and health; reads still show `pulse_advisory_tools_not_yet_available`; zero `Method not found`. Code repair complete; auth mystery confirmed out of scope; Matt owns Pulse-side diagnostic. This is an acceptable landing state — the signal went from `Method not found` (wrong wire) to `http_401` (wire correct, auth not yet resolved). No rollback.

   **(C) Any `Method not found` persists.** Batch 1 is incomplete. Revert and diagnose.

   Outcomes A and B both count as shipping the intended work. Outcome C is the only revert trigger.

### Batch 5 — Roadmap and build principles

Update `BUDDY_PROJECT_ROADMAP.md`:

1. Move D2 to Completed.
2. Add completion note:
   > **Omega wire-level repair 2026-04-23.** Two wire-level bugs fixed (JSON-RPC method + auth header). Write path `omega://events/write` → `buddy_ledger_write` and health path `omega://health/ping` → `mcp_tick` wired to real deployed Pulse tools. Read path kill-switched with `pulse_advisory_tools_not_yet_available` pending Pulse-side deal-scoped advisory tools (PULSE-SIDE-SPEC.md). Pulse-side auth state confirmed inconsistent during diagnostic — Batch 4 serves as authoritative auth test, and a persistent `http_401` ledger signal (if any) is acceptable separate-workstream state. Signal shape cleanup achieved regardless of auth state: `Method not found` is eliminated. Commits: [chain].

3. Add five build principles:

   > **MCP integration contracts are sourced from the deployed service's `tools/list`, not from in-repo source code.** Services with independent release cycles drift from repo skeletons. Rev 2 of the Omega repair named tools from in-repo source and would have kept the 100% failure rate. Rule: any MCP client work MUST `POST /{method:"tools/list"}` against the live service and record the actual tool names and schemas before mapping client code. (OMEGA-REPAIR rev 3.2)

   > **Stop-and-surface is load-bearing.** Five moments in the Pulse/Omega arc (D3 pushback → diagnostic, Phase 2 probe → falsified black-hole, rev 2 execution → caught wrong tool names, rev 3 PIV → caught unrunnable PIV-3 + unmapped health URI, rev 3.1 PIV-3 manual probe → caught Pulse-side auth inconsistency) were only caught because someone stopped partway and surfaced. Cost of another pass is hours; cost of shipping the wrong change is days. Rule: whenever execution evidence contradicts the spec, stop and surface. (OMEGA-REPAIR rev 3.2)

   > **MCP JSON-RPC envelope is `tools/call`, not custom method names.** The client speaks `method: "tools/call"` with `params: {name, arguments}`. Custom method names (`omega://events/write`) are not recognized. Auth for `tools/call` is `x-pulse-mcp-key`; `Authorization: Bearer` is for `/ingest/buddy` only. `target_user_id` is optional. (OMEGA-REPAIR rev 3.2)

   > **Vercel's `env pull` returns empty values for Sensitive-flagged env vars by design.** PIV procedures that need the actual secret value cannot rely on `env pull` for Sensitive vars. Options: manual out-of-band probe, Vercel REST API with token, or diagnostic endpoint reading `process.env.VAR` server-side. Confirmed via Vercel docs 2026-04-23. (OMEGA-REPAIR rev 3.2)

   > **Diminishing-returns rule for cross-system auth diagnostics.** When a diagnostic loop has exhausted 3+ rounds of chat-based probing without resolution, stop probing and defer to production verification. Reasoning: (a) the remaining variables are typically outside chat's visibility (network path, IP allowlist, protocol handshake differences, deployed-code drift); (b) code correctness and auth correctness are separable concerns that do not need to be verified in the same workstream; (c) production ledger signal is more authoritative than any out-of-band probe, and is achievable for free by deploying the code fix. Rule: if PIV is looping, mark as deferred, ship the code, and let the ledger tell the truth. (OMEGA-REPAIR rev 3.2 — from the rev 3.1 → rev 3.2 auth diagnostic)

4. Queue in Next Phases:
   - Pulse-side deal-scoped advisory tools (PULSE-SIDE-SPEC)
   - Pulse-side auth diagnostic (if outcome B above): investigate why MCP-protocol calls authenticate but direct HTTP calls with the same secret source don't

---

## Commit strategy

Three commits, one PR:

1. `feat(omega): repair wire contract — tools/call + x-pulse-mcp-key + write/health mapping + read kill-switch`
2. `feat(omega): adapter explicit stale-reason for kill-switched reads`
3. `docs: OMEGA-REPAIR rev 3.2 roadmap update + five build principles`

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

**Acceptable outcomes:** see Batch 4's outcome table (A and B both pass; only C reverts).

### V-2 — Cockpit UX

Matt opens `d65cc19e-...`. Expected: no visible change. Reads invisible, `ai_risk_runs` fallback renders.

### V-3 — Regression

Test pack on Samaritus. `deal_financial_facts` count, spreads, pipeline behavior unchanged.

### V-4 — Pulse receives write-path events (only applicable if outcome A)

Matt confirms out-of-band. If outcome B (auth 401), V-4 is expected to show nothing, which is consistent with the auth state.

---

## Rollback

Only triggered by V-1 persistent `Method not found`. Persistent `http_401` is NOT a rollback trigger in rev 3.2 — it's an acceptable end-state with Pulse-side auth diagnostic queued separately.

If rollback needed:
1. Revert Batches 1 and 2.
2. Leave env vars in place.
3. Leave build principles in roadmap.
4. Re-diagnose.

SR 11-7 wall = zero pipeline impact.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| PIV-2 finds `buddy_ledger_write` schema differs | Low | Translator updated to match |
| `OMEGA_MCP_KEY` wrong in Vercel runtime | Medium (auth state confirmed inconsistent during diagnostic) | Acceptable outcome — Batch 4 reveals, Pulse-side diagnostic handles separately |
| `OMEGA_TARGET_USER_ID` empty/Sensitive-flagged | Low impact | Tools accept omission |
| `mcp_tick` returns unexpected shape | Very low | `health.ts` only checks `result.ok` |
| Read regex misses a caller | Low | PIV-5 audits call graph |
| Rev 3.2's deferred PIV-3 masks a different bug | Low | Batch 4 catches any wire issue via `Method not found` signal |

---

## Addendum for Claude Code — judgment boundaries

**Authorized:**
- Read any file in Buddy's repo
- Read any table in Buddy's Supabase (read-only)
- Probe deployed Pulse MCP with `tools/list` (unauthenticated discovery only)
- Write code to `src/lib/omega/`, `src/core/omega/`, and test files
- Commit Batches 1, 2, 5 to `main`
- Deploy to production (Batch 4) — proceed without waiting for PIV-3

**NOT authorized:**
- Attempt PIV-3 probes — deferred per rev 3.2
- Request or reference the `OMEGA_MCP_KEY` value
- Modify any Vercel env var
- Modify any file in PulseMasterrepo
- Silence any ledger signal
- Touch outbox or ledger forwarder code
- Commit secret values in any form
- Paper over newly-discovered bugs — stop-and-surface

**If PIV-2 finds `buddy_advisory_for_deal` etc. have been added to Pulse:** stop and surface. Plan changes materially.

**If a new caller of `invokeOmega` surfaces that isn't in PIV-5's list and isn't covered by the translator:** stop and surface.

**If Batch 4 shows outcome B (`http_401` only, no `Method not found`):** this is acceptable per rev 3.2 outcome table. Do not revert. Document in AAR and flag Pulse-side diagnostic as queued for Matt.

**If Batch 4 shows outcome C (any `Method not found`):** revert Batches 1/2. Re-diagnose.

---

## After this lands

Wire contract is correct regardless of auth state. Signal shape cleaned up. Reads kill-switched honestly.

Remaining work:
1. **PULSE-SIDE-SPEC.md execution** — deal-scoped advisory tools.
2. **Buddy follow-up PR** — lift kill switch once Pulse ships.
3. **Pulse-side auth diagnostic** (conditional on outcome B) — why do MCP-protocol calls authenticate but direct HTTP with the same key source doesn't?
4. **Fastlane retire PR** — separate concern.
5. **DLQ replay** — optional.
6. **Pulse-as-driver rethink** — future spec.
7. **Deprecate `OMEGA_MCP_API_KEY`** — after stable operation.

The repair is not the vision. The repair gives us ground to stand on.
