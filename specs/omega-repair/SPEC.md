# Spec OMEGA-REPAIR — Fix the Three Client Bugs Blocking Omega Advisory

**Date:** 2026-04-22
**Supersedes:** Nothing; this is the follow-through on the Phase 1 + Phase 2 diagnostics.
**Owner:** Matt (both sides of the contract — Buddy and Pulse/Omega)
**Executor:** Claude Code
**Estimated effort:** 4–8 hours total. Mostly code changes on Buddy's side. New Vercel env var. Optional matching tool additions on Pulse side if existing tools don't fit.
**Risk:** Medium-low. No pipeline impact (Omega is advisory-only, SR 11-7 wall). Worst case is continued 100% failure rate — nothing *new* breaks.

---

## Problem

Omega advisory is 100% failing in production. 53 `omega.invoked` / 53 `omega.failed` events per week in `buddy_signal_ledger`. Every call errors with `omega_rpc_error: Method not found`.

Phase 2 (`FINDINGS-PHASE-2.md`) identified three independent root causes, any one of which would block the call:

1. **Wrong JSON-RPC `method`.** `src/lib/omega/invokeOmega.ts` line 144 sends `method: "omega://events/write"` directly. The deployed Pulse MCP only recognizes `tools/list` and `tools/call`. The `omega://` namespace is client-side fiction.
2. **Wrong auth header.** `invokeOmega.ts` line 138 sends `Authorization: Bearer`. The `tools/call` endpoint requires `x-pulse-mcp-key`. Bearer is rejected.
3. **Wrong secret value.** Even if the header name were fixed, `OMEGA_MCP_API_KEY` (which holds `b28280af…0`, the same value as `PULSE_INGEST_TOKEN`) is not a valid `x-pulse-mcp-key`. The tool-call endpoint requires a different secret that is not currently set in any Vercel env var.

## Outcome we want

- Every call from `invokeOmega` reaches the deployed Pulse MCP, authenticates successfully, executes a real tool, and returns structured data.
- `buddy_signal_ledger` shows `omega.succeeded` events instead of `omega.failed` for the five resource types Buddy currently calls.
- Cockpit surfaces (`OmegaAdvisoryPanel`, `OmegaConfidenceBadge`, `OmegaTraceDrawer`) populate with real data where Pulse has analyzed a deal, and degrade gracefully (unchanged behavior) where Pulse has not.
- SR 11-7 wall preserved: Omega remains advisory-only, pipeline never depends on Omega success.
- The repair is verifiable by reading ledger counts before/after deploy — no synthetic testing required, production traffic validates itself.

## Non-goals

- **Not rethinking the architecture.** This repair preserves request-response. If the eventual right answer is event-driven "Pulse-as-driver" (the reframe Matt raised), that's a future spec. This spec makes the current surface *work correctly first* so the foundation is provably rock-solid.
- **Not retiring Omega.** Matt explicitly chose REPAIR over RETIRE.
- **Not consolidating `omega/` with `pulseMcp/` clients.** They point at the same service but have different client abstractions. Consolidation is future cleanup; this spec only fixes what's broken.
- **Not replaying the 336 DLQ rows** from the pre-Feb-17 auth era. Separate optional PR.
- **Not touching the fastlane.** Fastlane retire is a separate PR.

---

## Pre-implementation verification (MANDATORY)

Claude Code MUST do all of these before writing code. If any result is surprising, stop and surface before proceeding.

### PIV-1 — Confirm current failure baseline

Query `buddy_signal_ledger` for last 24h:

```sql
SELECT type, COUNT(*) as n
FROM buddy_signal_ledger
WHERE type IN ('omega.invoked', 'omega.succeeded', 'omega.failed', 'omega.timed_out', 'omega.killed')
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY type;
```

Expected: `omega.invoked` ≈ `omega.failed`, `omega.succeeded` = 0. Record exact numbers in the AAR — these are the numerator/denominator for post-deploy verification.

### PIV-2 — Confirm the right Pulse-side tool for each call site

The deployed Pulse MCP exposes 40 tools (per Phase 2). For each of Buddy's five `omega://` resources, verify which tool actually answers the need:

| Buddy resource | Proposed Pulse tool | Verification query |
|---|---|---|
| `omega://events/write` | `buddy_ledger_write` | Send a probe via `tools/call` with zero-UUID deal_id. Expect success. |
| `omega://state/underwriting_case/{dealId}` | `state_inspect` (args TBD) | Inspect Pulse MCP's tool schema for `state_inspect`. Confirm it accepts deal_id or equivalent. |
| `omega://state/borrower/{borrowerId}` | `state_inspect` or borrower-specific equivalent | Same — confirm from tool schema. |
| `omega://confidence/evaluate` | `state_confidence` | Confirm from tool schema. |
| `omega://traces/{sessionId}` | `observer_query` | Confirm from tool schema. |

**How to get tool schemas:** POST to deployed MCP with `{"method":"tools/list"}` — no auth required. The response includes each tool's `inputSchema` (JSON Schema). Match Buddy's needs against the schemas.

If any Pulse tool does not cleanly answer Buddy's need, surface it. We have two options in that case:
- (a) Claude Code writes a translation layer in Buddy's adapter.
- (b) Matt adds a purpose-built tool to Pulse MCP's codebase that returns the exact shape Buddy's cockpit needs.

Do NOT assume the mapping is clean. Verify each one.

### PIV-3 — Obtain and record the correct `x-pulse-mcp-key` secret value

Matt owns Pulse and has said "I can have the Pulse key ready immediately." Before Claude Code starts coding:

1. Matt provides the correct `x-pulse-mcp-key` secret value (out-of-band — do NOT commit it; do NOT paste it into the spec; do NOT write it to the repo).
2. Claude Code sets it in Vercel production env as **`OMEGA_MCP_KEY`** (new var name; see Naming Decision below).
3. Claude Code verifies it works by calling a low-risk tool (e.g., `mcp_tick` or `system_smoke_test`) from a scratch script with the new secret. If it 200s, the secret is valid.

If the secret isn't available when Claude Code starts, the repair stalls here. Code can still be written (it compiles without the secret), but no end-to-end validation happens until the secret lands.

### PIV-4 — Naming decision: new env var for the tool-call key

Current state in Vercel:
- `PULSE_INGEST_TOKEN` — valid Bearer token for `/ingest/buddy`. **Keep unchanged.**
- `OMEGA_MCP_API_KEY` — currently equals `PULSE_INGEST_TOKEN` (same value). **Misnamed; it is not actually a valid MCP key.**
- `PULSE_MCP_KEY` — unset. The fastlane client expects this.

Proposal: introduce **`OMEGA_MCP_KEY`** as the new variable name for the `x-pulse-mcp-key` secret. Reasons:
- Distinguishes from the misleading `OMEGA_MCP_API_KEY` (which we will leave in place but stop referencing — see deprecation below).
- Distinct from `PULSE_MCP_KEY` because even though they happen to point at the same deployed service, the Omega client and the fastlane client have different lifecycles (fastlane is being retired; Omega is being repaired).
- The existing `src/lib/omega/invokeOmega.ts` has a `getOmegaMcpApiKey()` function — rename the function and point it at the new env var.

Deprecate but do NOT delete `OMEGA_MCP_API_KEY` in this PR. Leave it set in Vercel so we can roll back by reverting the code change if needed. Add a comment in `invokeOmega.ts` noting the rename and that `OMEGA_MCP_API_KEY` is deprecated as of this commit.

### PIV-5 — Confirm no one else calls `invokeOmega` with expectations that break

Search `src/` for every caller of `invokeOmega` and every caller of `readOmegaState`, `readOmegaTraces`, `evaluateOmegaConfidence`, `mirrorEventToOmega`. Document the call graph. Each caller is downstream of this repair — if any of them has expectations about response shape that change, we need to know.

From Phase 2's call-site enumeration:
- `src/core/omega/OmegaAdvisoryAdapter.ts` — calls `readOmegaState`, `evaluateOmegaConfidence`, `readOmegaTraces`
- `src/buddy/server/writeBuddySignal.ts` → `mirrorEventToOmega.ts` — calls `invokeOmega` for `omega://events/write`
- `src/app/api/examiner/portal/deals/[dealId]/route.ts:125` — calls `omega://state/borrower/{id}`

Three entry points. All three need to survive the response-shape changes introduced by the repair. Verify shapes match `OmegaAdvisoryState` (cockpit) and whatever examiner portal expects.

---

## Implementation plan

Five batches, each committable separately. Land in order.

### Batch 1 — Fix `invokeOmega.ts` (the one file with all three bugs)

**File:** `src/lib/omega/invokeOmega.ts`

**Changes:**

1. Replace the JSON-RPC body construction. Currently (line 133-144):
   ```ts
   const body = JSON.stringify({
     jsonrpc: "2.0",
     id: requestId,
     method: resource,       // BUG: "omega://events/write" not recognized
     params: payload ?? {},
   });
   ```

   Fix:
   ```ts
   // Translate omega:// URI to Pulse tool name + arguments.
   const toolCall = translateResourceToToolCall(resource, payload);
   if (!toolCall) {
     throw new Error(`omega_unmapped_resource: ${resource}`);
   }
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

2. Replace the auth header. Currently (line 135-140):
   ```ts
   if (apiKey) {
     headers["Authorization"] = `Bearer ${apiKey}`;
   }
   ```

   Fix:
   ```ts
   if (apiKey) {
     headers["x-pulse-mcp-key"] = apiKey;
   }
   ```

3. Update `getOmegaMcpApiKey()` to read the new env var:
   ```ts
   function getOmegaMcpApiKey(): string | undefined {
     return process.env.OMEGA_MCP_KEY || process.env.OMEGA_MCP_API_KEY || undefined;
     // OMEGA_MCP_API_KEY fallback is deprecated — remove in a future cleanup.
   }
   ```

4. Add the `translateResourceToToolCall` helper. This is the URI→tool mapping. Keep it in `invokeOmega.ts` for now; extract to its own file only if the mapping grows beyond ~30 lines.

   ```ts
   interface ToolCall {
     tool: string;
     arguments: Record<string, unknown>;
   }

   function translateResourceToToolCall(
     resource: string,
     payload: unknown,
   ): ToolCall | null {
     // omega://events/write → buddy_ledger_write
     if (resource === "omega://events/write") {
       return {
         tool: "buddy_ledger_write",
         arguments: (payload as Record<string, unknown>) ?? {},
       };
     }

     // omega://state/<type>/<id> → state_inspect
     const stateMatch = resource.match(/^omega:\/\/state\/([^/]+)\/(.+)$/);
     if (stateMatch) {
       return {
         tool: "state_inspect",
         arguments: {
           state_type: stateMatch[1],
           entity_id: stateMatch[2],
           ...(payload as Record<string, unknown> ?? {}),
         },
       };
     }

     // omega://confidence/evaluate → state_confidence
     if (resource === "omega://confidence/evaluate") {
       return {
         tool: "state_confidence",
         arguments: (payload as Record<string, unknown>) ?? {},
       };
     }

     // omega://traces/<sessionId> → observer_query
     const traceMatch = resource.match(/^omega:\/\/traces\/(.+)$/);
     if (traceMatch) {
       return {
         tool: "observer_query",
         arguments: {
           session_id: traceMatch[1],
           ...(payload as Record<string, unknown> ?? {}),
         },
       };
     }

     return null;
   }
   ```

   **IMPORTANT:** the argument shapes above are GUESSES. PIV-2 resolves them by reading each tool's `inputSchema`. Update this function to match the real schemas before shipping. If shapes don't match, it's a PIV-2 finding, not a Batch 1 finding.

5. Handle the new response shape. MCP `tools/call` responses wrap the actual result:
   ```json
   {
     "jsonrpc": "2.0",
     "id": "...",
     "result": {
       "content": [{"type": "text", "text": "..."}],
       "structuredContent": {...}   // when present, this is the actual data
     }
   }
   ```

   The existing code assumes `rpc.result` IS the data. After the repair, `rpc.result.structuredContent` (or `rpc.result.content[0]` parsed) IS the data. Update the response unwrapping accordingly.

**Tests:** `src/lib/omega/__tests__/invokeOmega.test.ts` — new file.
- Mock fetch. Assert request body has `method: "tools/call"`, correct `params.name`, correct `arguments`.
- Assert request header is `x-pulse-mcp-key`, not `Authorization`.
- Test each of the five URI patterns individually.
- Test that an unmapped URI returns `{ ok: false, error: "omega_unmapped_resource: ..." }`.
- Test timeout, kill-switch, disabled paths still work (regression coverage).

### Batch 2 — Verify adapter shapes still line up

**File:** `src/core/omega/OmegaAdvisoryAdapter.ts`

After Batch 1, responses from `readOmegaState` / `evaluateOmegaConfidence` / `readOmegaTraces` will carry real data in different shapes than before (because they now come from `state_inspect`, `state_confidence`, `observer_query` instead of the mythical `omega://` namespace).

The adapter currently reads fields like `state.data?.recommendation`, `state.data?.signals`, `conf.data?.score`, `tr.data?.id`. Those field names are **guesses from a time when the endpoint never returned anything**. Confirm the real shapes now that we're actually getting data, and update the adapter fields to match.

**Do not guess.** Run PIV-2 first, get the tool schemas, then edit the adapter to read the actual response field names. If they don't match what `OmegaAdvisoryState` expects, add a thin shape-mapping function in the adapter (no separate file — keep it close to the usage).

**Tests:** Extend `OmegaAdvisoryAdapter.ts` tests (or write first ones — confirm if tests exist). Cover:
- Happy path: all three sub-calls succeed → `OmegaAdvisoryState` populated, `stale: false`.
- Partial: only confidence succeeds → populated with `stale: false, confidence: <score>`, advisory empty string.
- All fail → `stale: true`, `staleReason: "Omega returned no data for this deal"`.
- Disabled (`OMEGA_MCP_ENABLED !== "1"`) → `stale: true, staleReason: "Omega MCP not enabled"`.

### Batch 3 — Vercel env change

Set `OMEGA_MCP_KEY` in Vercel production to the value Matt provides out-of-band.

Use `vercel env add OMEGA_MCP_KEY production` and paste at the prompt. Do NOT write the value to any file, not even in a comment. Verify with `vercel env ls --yes production | grep OMEGA_MCP_KEY` that it's set.

Also add `OMEGA_MCP_KEY` to preview and development if those environments exist and are used for testing. If unsure, ask Matt.

### Batch 4 — Deploy and verify in production

1. After Batches 1–3 are merged and env is set, wait for production deploy to finish.
2. Open the cockpit for the test deal `d65cc19e-b03e-4f2d-89ce-95ee69472cf3`. Load the page.
3. Within 2 minutes, query:
   ```sql
   SELECT type, COUNT(*) as n, MAX(created_at)::text as latest
   FROM buddy_signal_ledger
   WHERE type IN ('omega.invoked', 'omega.succeeded', 'omega.failed')
     AND created_at > NOW() - INTERVAL '5 minutes'
   GROUP BY type;
   ```
4. Expected: `omega.invoked` ≥ 3, `omega.succeeded` ≥ 1, `omega.failed` = 0 (or very low, only for resources Pulse hasn't analyzed yet).

If `omega.failed` is still nonzero post-deploy, pull one of the failed ledger rows' `payload.error` and diagnose. The repair is incomplete until the failure rate drops dramatically.

### Batch 5 — Roadmap and build principles

Update `BUDDY_PROJECT_ROADMAP.md`:

1. Move D2 (the Omega Method-not-found item in Phase 84.1 backlog) to completed, referencing this repair's commit chain.
2. Add a completion note: "Omega advisory repaired 2026-04-22. Three independent client bugs fixed: JSON-RPC method wrong (omega:// URIs replaced with tools/call), auth header wrong (x-pulse-mcp-key replaces Authorization Bearer), secret wrong (new OMEGA_MCP_KEY env var). Success rate restored to [X]% in post-deploy verification. Integration contract now matches deployed Pulse MCP."
3. Add a new build principle:

> **When integrating Buddy with external MCP servers, the client always speaks the MCP JSON-RPC envelope: `method: "tools/call"` with `params: {name: <tool>, arguments: <payload>}`. Custom JSON-RPC method names (e.g., `omega://events/write`) are not recognized by any MCP server — they are an anti-pattern from early prototyping that must not be reintroduced. Auth header for `tools/call` is `x-pulse-mcp-key`, not `Authorization: Bearer` (that's the `/ingest/buddy` pattern). Verified 2026-04-22 by end-to-end repair of the Omega advisory surface. See `specs/diagnostic-pulse-omega/FINDINGS-PHASE-2.md` for the diagnostic history. (OMEGA-REPAIR)**

4. Add another build principle capturing the diagnostic discipline lesson:

> **Probe the deployed service before inferring from in-repo service code. Services with independent release cycles (Cloud Run deployments updated outside the main Buddy repo) can drift from their in-repo skeletons. Phase 1 of the Pulse/Omega diagnostic read `services/pulse-mcp/src/routes/ingestBuddy.ts` in-repo and inferred an HMAC contract; Phase 2 probed the deployed endpoint and found Bearer auth accepted. The in-repo code was months stale. Rule: any diagnostic conclusion about a deployed service must be grounded in live probes (curl, MCP introspection, etc.), not static analysis of the repo representation of that service. (OMEGA-REPAIR diagnostic lesson)**

---

## Commit strategy

Four commits, one PR:

1. `feat(omega): repair invokeOmega — tools/call + x-pulse-mcp-key + URI translation` — Batch 1 + tests
2. `feat(omega): align adapter response shapes with real Pulse tool outputs` — Batch 2 + tests
3. `chore(env): add OMEGA_MCP_KEY production env var` — Batch 3 (env change only, possibly no file change; mention in PR description)
4. `docs: OMEGA-REPAIR roadmap update + build principles` — Batch 5

Batch 4 is a verification step, not a commit. Results go in the AAR.

---

## Verification protocol

After all batches land and deploy:

### V-1 — Ledger success rate

Run PIV-1's query. Compare to pre-repair numbers. Success: `omega.succeeded / omega.invoked` ≥ 90% for the next 24 hours.

If the ratio is 60-90%, investigate which resources fail — might be a shape-mapping bug for one specific `omega://` URI, not a systemic regression.

If the ratio is <60%, revert Batch 1 via git and re-diagnose. The repair was incomplete.

### V-2 — Cockpit visible change

Before the repair, for the test deal `d65cc19e-...`:
- `OmegaAdvisoryPanel` renders `null`
- `OmegaConfidenceBadge` renders `null`
- `OmegaTraceDrawer` renders in builder mode only, empty

After the repair:
- At minimum, the adapter returns `stale: true, staleReason: "Omega returned no data for this deal"` (different from the pre-repair sentinel — this means the call succeeded but Pulse has no analysis yet). UI behavior unchanged in this case.
- At best, Pulse has analyzed the deal and one or more panels populate.

Matt: open the cockpit for the test deal after deploy. Report what you see. This is the user-facing acceptance.

### V-3 — Regression: no pipeline impact

Run one full test pack execution on Samaritus (the 9 fixed documents). Expected:
- All 9 docs upload, classify, extract as before
- No change in `deal_financial_facts` count
- No change in spreads
- Snapshot/recon/UW behavior identical

Omega is advisory-only. Repair should not touch the pipeline. Confirm by testing the pipeline.

### V-4 — Fallback path still works

For a deal where Pulse has NOT analyzed (most deals right now), cockpit should fall back to `ai_risk_runs` synthesis. That code path is in the state API route, not in the adapter. Confirm it still runs when Omega returns empty.

---

## Rollback

If anything breaks in production:

1. **Revert Batch 1 commit.** Restores the 100% failure rate but that was the known-safe prior state.
2. Leave `OMEGA_MCP_KEY` env var in place (doesn't hurt anything).
3. Leave the build principle in the roadmap (the diagnostic lesson is true even if the repair reverts).
4. Investigate, re-spec, try again.

SR 11-7 wall protects us here — reverting doesn't hurt the pipeline.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Pulse tool argument shapes don't match our guesses in `translateResourceToToolCall` | High | PIV-2 mandates reading `inputSchema` from `tools/list` before coding. The spec's guesses are explicitly labeled as guesses. |
| Response field names in adapter don't match real tool outputs | Medium-high | Batch 2 explicitly does this verification as part of implementation. Tests use real response fixtures captured from Pulse. |
| `OMEGA_MCP_KEY` secret Matt provides is wrong or Pulse rejects it | Low (Matt owns Pulse) | PIV-3 step 3 — probe a low-risk tool before writing code against the key. If it 401s, fix the key before proceeding. |
| Repair reveals that Pulse has analyzed 0 deals so cockpit still looks "broken" to bankers | Medium | Expected. The "stale: true, staleReason: 'no data for this deal'" path is the correct degradation. UI was already invisible; it stays invisible. Not a regression. |
| Pulse's response shapes change in the future without coordination | Low (Matt owns both sides) | Build principle mandates probing for drift; future changes to Pulse's tool schemas will require corresponding adapter updates. |
| Rename from `OMEGA_MCP_API_KEY` to `OMEGA_MCP_KEY` leaves a stale env var in Vercel | Low cosmetic | Leave it for now, document as deprecated, clean up in a future PR after 1-2 weeks of stable operation. |
| The repair succeeds but exposes latent bugs in the adapter or downstream consumers | Medium | V-3 (regression test on Samaritus) catches pipeline impact. Cockpit render tests would catch UI bugs — extend test coverage if any surface appears broken. |

---

## Addendum for Claude Code — judgment boundaries

You have authority to:

- Read any file in the repo, any table in Supabase (read-only)
- Probe the deployed Pulse MCP via `curl` and `tools/list` (no auth required for discovery)
- Write code changes to `src/lib/omega/`, `src/core/omega/`, and related test files
- Commit to `main` once all batches are ready
- Set `OMEGA_MCP_KEY` in Vercel prod env (after Matt provides the value)

You do NOT have authority to:

- Delete `OMEGA_MCP_API_KEY` from Vercel (deprecation only, leave it set)
- Modify Pulse MCP codebase (`services/pulse-mcp/`) — that's a different codebase, out of scope for this repair
- Silence any ledger signal — diagnostic signals stay as they are, we're fixing the thing that emits them, not the emission itself
- Touch the outbox or ledger forwarder code paths — those are working (Phase 2 confirmed)
- Ship without running PIV-1, PIV-2, PIV-3, PIV-4, PIV-5 and reporting findings
- Commit the `OMEGA_MCP_KEY` value to the repo in any form (code, comment, test fixture, .env file, anywhere)

If you find during PIV-2 that one or more Pulse tools don't cleanly answer Buddy's needs, **stop and surface**. Don't write shape-mapping gymnastics to paper over a semantic gap — that's where bugs hide. Matt will decide whether to add a purpose-built tool on Pulse's side or accept an explicit translation layer.

If you find during implementation that a fourth independent bug exists that Phase 2 didn't catch, **stop and surface**. The diagnostic track record is that each phase finds bugs the previous phase missed. Don't paper over a newly-discovered issue; spec it separately.

---

## After this lands

The foundation is rock-solid. Buddy talks to Pulse correctly. The 100% failure rate is gone. Cockpit has real data where Pulse has analyzed, graceful degradation where it hasn't.

Then we can decide what comes next on the Buddy ↔ Pulse axis:
- Retire the fastlane (the never-real integration, already scoped)
- Replay the 336 DLQ rows from Jan/Feb (optional telemetry recovery)
- Begin the "Pulse-as-driver" architectural rethink (future spec, now informed by a working baseline)

The repair is not the vision. The repair gives us ground to stand on while the vision work happens.
