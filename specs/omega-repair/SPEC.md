# Spec OMEGA-REPAIR — Fix the Four Client Bugs Blocking Omega Advisory

**Date:** 2026-04-22 (revised 2026-04-23 after PulseMasterrepo source review)
**Supersedes:** Prior draft of this spec (that draft covered three bugs; Matt and Claude found a fourth during Pulse-side source review).
**Owner:** Matt (owns both sides of the contract — Buddy and Pulse/Omega)
**Executor:** Claude Code
**Repo:** Buddy lives at `29xh24fm6r-ctrl/Buddy-The-Underwriter`. Pulse MCP source lives at `29xh24fm6r-ctrl/PulseMasterrepo` under `services/pulse-mcp/src/`. Claude Code has read access to both.
**Estimated effort:** 4–8 hours total. Code changes on Buddy's side only (Pulse MCP is correctly implemented; Buddy's client is wrong). No Pulse-side code changes needed.
**Risk:** Medium-low. No pipeline impact (Omega is advisory-only, SR 11-7 wall). Worst case is continued 100% failure rate — nothing *new* breaks.

---

## Problem

Omega advisory is 100% failing in production. 53 `omega.invoked` / 53 `omega.failed` events per week in `buddy_signal_ledger`. Every call errors with `omega_rpc_error: Method not found`.

The diagnostics in `specs/diagnostic-pulse-omega/FINDINGS.md` and `FINDINGS-PHASE-2.md`, plus source review of `29xh24fm6r-ctrl/PulseMasterrepo/services/pulse-mcp/src/`, identified **four** independent root causes. Any one of them is sufficient to block the call; all four must be fixed for Omega to succeed.

1. **Wrong JSON-RPC `method`.** `src/lib/omega/invokeOmega.ts:144` sends `method: "omega://events/write"` directly. The deployed Pulse MCP only recognizes JSON-RPC methods `tools/list` and `tools/call`. The entire `omega://` namespace is client-side fiction; no Pulse method was ever registered under those names.

2. **Wrong auth header.** `invokeOmega.ts:138` sends `Authorization: Bearer ${apiKey}`. Pulse MCP's auth middleware (`PulseMasterrepo:services/pulse-mcp/src/auth.ts:20-29`) reads the `x-pulse-mcp-key` header only. Bearer is ignored.

3. **Wrong secret value.** Even with the header name corrected, the `OMEGA_MCP_API_KEY` env var Buddy reads holds the Bearer token for the `/ingest/buddy` path (same 64-char value as `PULSE_INGEST_TOKEN`, verified in Phase 2). It is not the value Pulse MCP's `auth.ts` compares against for tool calls — that comes from Secret Manager's `PULSE_MCP_API_KEY` (Version 2, in the `pulse-life-os-2a8c9` GCP project).

4. **Missing `target_user_id` in tool arguments.** Pulse MCP's Buddy-facing tools (`PulseMasterrepo:services/pulse-mcp/src/tools/buddy/ledger.ts`) require `target_user_id` as a Zod-validated argument on every call. Without it, every tool call fails Zod validation with `"target_user_id: Required"` — returned before auth even matters. Buddy's current `invokeOmega` client does not pass this argument in any call site.

## Environment status

Matt has already set the two env vars required for this repair (confirmed via Vercel dashboard, 2026-04-23):

| Var | Value source | Sensitive? | Scope |
|---|---|---|---|
| `OMEGA_MCP_KEY` | Copied from GCP Secret Manager's `PULSE_MCP_API_KEY` v2, `pulse-life-os-2a8c9` project | Yes | Production and Preview |
| `OMEGA_TARGET_USER_ID` | `8c24fdf4-1ef7-418a-b155-16a85eb17f6a` (from Pulse MCP Cloud Run env var `PULSE_MCP_VIEWER_USER_ID`; same as `PULSE_DEFAULT_TARGET_USER_ID`; single-tenant setup) | No (plain UUID) | Production and Preview |

A fresh redeploy has already been triggered. Claude Code does NOT need to set env vars. It only needs to read code that references them.

## Outcome we want

- Every call from `invokeOmega` reaches the deployed Pulse MCP, authenticates, passes Zod validation, executes a real tool, and returns structured data.
- `buddy_signal_ledger` shows `omega.succeeded` events instead of `omega.failed` for the five resource types Buddy currently calls.
- Cockpit surfaces (`OmegaAdvisoryPanel`, `OmegaConfidenceBadge`, `OmegaTraceDrawer`) populate with real data where Pulse has analyzed a deal, and degrade gracefully (`stale: true`, no UI change) where Pulse has not.
- SR 11-7 wall preserved: Omega remains advisory-only; the pipeline never depends on Omega success.
- The repair is verifiable by reading ledger counts before/after deploy — no synthetic testing required; production traffic validates itself.

## Non-goals

- **Not rethinking the architecture.** This repair preserves request-response. If the eventual right answer is event-driven "Pulse-as-driver" (Matt's reframe from earlier in the diagnostic arc), that's a future spec. This spec makes the current surface *work correctly first* so the foundation is provably rock-solid.
- **Not retiring Omega.** Matt explicitly chose REPAIR.
- **Not consolidating `omega/` with `pulseMcp/` clients.** They point at the same deployed service but have different client abstractions. Consolidation is future cleanup; this spec only fixes what's broken in `omega/`.
- **Not replaying the 336 DLQ rows** from the pre-Feb-17 auth era. Separate optional PR.
- **Not touching the fastlane.** Fastlane retire is a separate PR.
- **Not modifying Pulse MCP's code.** The Pulse-side implementation is correct. Buddy's client is the only thing changing.

---

## Pre-implementation verification (MANDATORY)

Claude Code MUST complete all five PIVs before writing code. If any result is surprising or differs from the assumptions below, stop and surface to Matt before proceeding.

### PIV-1 — Record the current failure baseline

Query `buddy_signal_ledger` for the last 24h via Supabase MCP:

```sql
SELECT type, COUNT(*) as n, MAX(created_at)::text as latest
FROM buddy_signal_ledger
WHERE type IN ('omega.invoked', 'omega.succeeded', 'omega.failed', 'omega.timed_out', 'omega.killed')
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY type;
```

Expected: `omega.invoked` ≈ `omega.failed`, `omega.succeeded` = 0 (or near-zero).

Record the exact numbers in the final AAR. These are the numerator/denominator for post-deploy verification (V-1).

### PIV-2 — Read Pulse-side tool schemas directly from PulseMasterrepo source

**This is no longer an introspection task.** Claude Code has GitHub MCP access to `29xh24fm6r-ctrl/PulseMasterrepo`. Read the tool source files and record the exact Zod schemas for each tool Buddy will call.

Files to read:

| File | Tools defined |
|---|---|
| `PulseMasterrepo:services/pulse-mcp/src/tools/buddy/ledger.ts` | `buddy_list_ledger_events`, `buddy_get_deal_ledger`, `buddy_get_flow_health`, `buddy_write_ledger_event` |
| `PulseMasterrepo:services/pulse-mcp/src/tools/pulse_read.ts` | `pulse_read` (or similar — confirm tool name from `tools/index.ts`) |
| `PulseMasterrepo:services/pulse-mcp/src/tools/pulse_write.ts` | `pulse_write` |
| `PulseMasterrepo:services/pulse-mcp/src/tools/index.ts` | Full tool registry — confirm tool names as exposed on the wire |
| `PulseMasterrepo:services/pulse-mcp/src/auth.ts` | Confirm auth contract (single key `x-pulse-mcp-key`; `assertViewerCanReadTarget` requires `target_user_id`) |

What Claude Code already knows from this spec's authors having read the source:

**`buddy_write_ledger_event`** (Zod schema from `ledger.ts`):
```ts
{
  target_user_id: z.string().min(10),
  event_type: z.string().min(1).max(100),
  deal_id: z.string().optional(),
  status: z.enum(["pending", "success", "failed", "error"]),
  payload: z.record(z.unknown()).default({}),
  expected_outcome: z.record(z.unknown()).optional(),
  actual_outcome: z.record(z.unknown()).optional(),
}
```

**`buddy_list_ledger_events`:**
```ts
{
  target_user_id: z.string().min(10),
  limit: z.number().int().min(1).max(200).default(50),
  hours: z.number().int().min(1).max(168).default(24),
  event_type: z.string().optional(),
  deal_id: z.string().optional(),
}
```

**`buddy_get_deal_ledger`:**
```ts
{
  target_user_id: z.string().min(10),
  deal_id: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(50),
}
```

**`buddy_get_flow_health`:**
```ts
{
  target_user_id: z.string().min(10),
  hours: z.number().int().min(1).max(168).default(24),
}
```

**Every buddy_* tool requires `target_user_id`.** This is bug #4.

Pulse-side tool response shape is always `{ summary: string, artifacts: unknown[] }` — see `ToolResult` interface in `ledger.ts`. Adapter will need to unwrap `artifacts` (Batch 2).

Tools `state_inspect`, `state_confidence`, `observer_query` — PIV-2 task: read their source files and record the exact schemas. Spec assumes these follow the same pattern (require `target_user_id`), but verify. If any of the three `state_*` or `observer_*` tools don't exist under those names, record what does exist on the Pulse side for the three advisory reads Buddy needs (deal state, confidence score, trace).

Record findings in the AAR as a table: Buddy's `omega://` URI → real Pulse tool name → exact argument schema.

### PIV-3 — Verify the auth secret works end-to-end

The `OMEGA_MCP_KEY` env var is already set in Vercel (marked Sensitive, Production+Preview). Before writing any code, verify the value Pulse receives when Buddy calls is a valid `x-pulse-mcp-key`:

Write a scratch script in `/tmp/omega-probe.ts` (delete after verification — do NOT commit):

```ts
// Uses the value from Vercel via `vercel env pull` to a local .env.production,
// then reads process.env.OMEGA_MCP_KEY. Clean up both after.
const key = process.env.OMEGA_MCP_KEY;
if (!key) throw new Error("OMEGA_MCP_KEY not in env");

const res = await fetch("https://pulse-mcp-651478110010.us-central1.run.app/", {
  method: "POST",
  headers: { "content-type": "application/json", "x-pulse-mcp-key": key },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "probe-1",
    method: "tools/call",
    params: { name: "mcp_tick", arguments: {} },
  }),
});
console.log("status:", res.status);
console.log("body:", await res.text());
```

Expected: HTTP 200 with a successful `mcp_tick` response (Pulse's heartbeat tool — no `target_user_id` needed for this one specifically; verify from source).

If 401: secret is wrong. Stop and surface to Matt.
If 400 with a Zod error about missing fields: secret works but tool needs args; pick a different zero-args probe tool from `tools/index.ts`.
If 200: proceed.

Clean up `.env.production` and `omega-probe.ts` after. Do not commit either.

### PIV-4 — Naming and env var state

Already decided and applied:

- **`OMEGA_MCP_KEY`** — the `x-pulse-mcp-key` value. Set in Vercel, marked Sensitive.
- **`OMEGA_TARGET_USER_ID`** — `8c24fdf4-1ef7-418a-b155-16a85eb17f6a`. Set in Vercel, plaintext (not sensitive).
- **`OMEGA_MCP_API_KEY`** — leave set at current value (the Bearer token). Deprecated. `invokeOmega.ts` should read `OMEGA_MCP_KEY` first, fall back to `OMEGA_MCP_API_KEY` for rollback safety, emit a console.warn if only the fallback is used so stale config gets noticed.
- `PULSE_MCP_KEY`, `PULSE_MCP_ENABLED`, `PULSE_MCP_URL` — not set, never have been (fastlane has never been configured). The fastlane retire PR will remove code that references these.

### PIV-5 — Call graph audit

Confirm every caller of the Omega client surface. From the existing diagnostic work:

- `src/core/omega/OmegaAdvisoryAdapter.ts` → calls `readOmegaState`, `evaluateOmegaConfidence`, `readOmegaTraces` (which all route through `invokeOmega`)
- `src/buddy/server/writeBuddySignal.ts` → `src/lib/omega/mirrorEventToOmega.ts` → calls `invokeOmega` for `omega://events/write`
- `src/app/api/examiner/portal/deals/[dealId]/route.ts:125` → calls `omega://state/borrower/{id}` (verify line number — may have drifted)

If grep finds additional callers beyond these three, surface. All callers downstream of the repair must tolerate the new response-shape unwrapping.

---

## Implementation plan

Five batches, committable separately. Land in order.

### Batch 1 — Fix `invokeOmega.ts` (all four bugs live here)

**File:** `src/lib/omega/invokeOmega.ts`

**Changes (in order):**

1. **Secret lookup — bug #3 fix.** Replace `getOmegaMcpApiKey()`:
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

2. **Auth header — bug #2 fix.** Replace the Bearer header with `x-pulse-mcp-key`:
   ```ts
   // Before:
   if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

   // After:
   if (apiKey) headers["x-pulse-mcp-key"] = apiKey;
   ```

3. **JSON-RPC envelope — bug #1 fix.** Replace the `method: resource` pattern with `method: "tools/call"`:
   ```ts
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

4. **URI→tool translation with `target_user_id` injection — bug #4 fix.** Add a helper:
   ```ts
   function getOmegaTargetUserId(): string | undefined {
     return process.env.OMEGA_TARGET_USER_ID || undefined;
   }

   interface ToolCall {
     tool: string;
     arguments: Record<string, unknown>;
   }

   function translateResourceToToolCall(
     resource: string,
     payload: unknown,
   ): ToolCall | null {
     const targetUserId = getOmegaTargetUserId();
     if (!targetUserId) {
       throw new Error("omega_target_user_id_missing: set OMEGA_TARGET_USER_ID");
     }

     const payloadObj = (payload as Record<string, unknown>) ?? {};
     const baseArgs = { target_user_id: targetUserId };

     // omega://events/write → buddy_write_ledger_event
     if (resource === "omega://events/write") {
       return {
         tool: "buddy_write_ledger_event",
         arguments: { ...baseArgs, ...payloadObj },
       };
     }

     // omega://state/<type>/<id> → state_inspect
     // NOTE: PIV-2 must verify that state_inspect exists under that name and accepts
     // these argument names. If not, this mapping must be updated before commit.
     const stateMatch = resource.match(/^omega:\/\/state\/([^/]+)\/(.+)$/);
     if (stateMatch) {
       return {
         tool: "state_inspect",
         arguments: {
           ...baseArgs,
           state_type: stateMatch[1],
           entity_id: stateMatch[2],
           ...payloadObj,
         },
       };
     }

     // omega://confidence/evaluate → state_confidence
     if (resource === "omega://confidence/evaluate") {
       return {
         tool: "state_confidence",
         arguments: { ...baseArgs, ...payloadObj },
       };
     }

     // omega://traces/<sessionId> → observer_query
     const traceMatch = resource.match(/^omega:\/\/traces\/(.+)$/);
     if (traceMatch) {
       return {
         tool: "observer_query",
         arguments: {
           ...baseArgs,
           session_id: traceMatch[1],
           ...payloadObj,
         },
       };
     }

     return null;
   }
   ```

   **IMPORTANT:** Argument names other than `target_user_id` are confirmed only for `buddy_write_ledger_event` (read from source). The `state_inspect` / `state_confidence` / `observer_query` argument shapes are guesses pending PIV-2 verification. Update before commit.

5. **Response unwrapping.** MCP `tools/call` returns:
   ```json
   {
     "jsonrpc": "2.0",
     "id": "...",
     "result": {
       "content": [{"type": "text", "text": "<json>"}],
       "structuredContent": {...}
     }
   }
   ```
   But Pulse's tools all return `{ summary: string, artifacts: unknown[] }` via the `ToolResult` shape. The MCP server wraps this in `result.structuredContent`. Existing code assumes `rpc.result` IS the data. Update unwrapping:
   ```ts
   const unwrapped = rpc.result?.structuredContent ?? rpc.result?.content?.[0];
   if (!unwrapped) {
     throw new Error("omega_rpc_empty: no content in response");
   }
   return unwrapped as T;
   ```

**Tests:** `src/lib/omega/__tests__/invokeOmega.test.ts` — new file.
- Mock `fetch`. Assert request body has `method: "tools/call"`, correct `params.name`, correct `params.arguments`.
- Assert `target_user_id` is present in every tool-call arguments object, sourced from `OMEGA_TARGET_USER_ID`.
- Assert request header is `x-pulse-mcp-key`, not `Authorization`.
- Test the four URI patterns (`events/write`, `state/<type>/<id>`, `confidence/evaluate`, `traces/<id>`) produce the correct tool names.
- Test `omega_unmapped_resource` returns `{ ok: false }` for unknown URIs.
- Test `omega_target_user_id_missing` surfaces clearly when the env var is unset.
- Test deprecated fallback (`OMEGA_MCP_API_KEY` only) emits console.warn and still works.
- Regression: timeout, kill-switch, disabled paths still work.

### Batch 2 — Align adapter response shapes

**File:** `src/core/omega/OmegaAdvisoryAdapter.ts`

After Batch 1, responses from `readOmegaState` / `evaluateOmegaConfidence` / `readOmegaTraces` will carry real data in shapes that come from Pulse's `{ summary, artifacts }` envelope, not the hypothetical `{data: {recommendation, signals, score, id}}` shapes the adapter currently reads.

Action:

1. Using PIV-2's recorded tool schemas, determine what `summary` and `artifacts[0]` actually contain for each of the three read tools.
2. Update the adapter to unwrap `summary` and `artifacts[0]` accordingly and map to the `OmegaAdvisoryState` interface fields (`confidence`, `advisory`, `riskEmphasis`, `traceRef`, `stale`, `staleReason`).
3. If Pulse's shape genuinely doesn't map to what `OmegaAdvisoryState` expects (e.g., Pulse returns raw ledger rows and we want a synthesized advisory), add a small mapping function inside the adapter file. Do not create a separate file.
4. Preserve the graceful degradation path: if `state_inspect` / `state_confidence` / `observer_query` return empty artifacts or the tool errors for a specific deal, return `{ stale: true, staleReason: "..." }` — do not surface a broken-looking UI.

**Tests:** extend existing tests or create `src/core/omega/__tests__/OmegaAdvisoryAdapter.test.ts`.
- Happy path: all three sub-calls return populated artifacts → `OmegaAdvisoryState` populated, `stale: false`.
- Partial: only `state_confidence` succeeds → `confidence` populated, `advisory` empty, `stale: false`.
- Empty artifacts: Pulse returns `{summary: "no data", artifacts: []}` → `stale: true, staleReason: "..."`.
- All sub-calls fail → `stale: true`.
- Disabled (`OMEGA_MCP_ENABLED !== "1"`) → `stale: true, staleReason: "Omega MCP not enabled"`.

### Batch 3 — Env var verification (not a code change)

`OMEGA_MCP_KEY` and `OMEGA_TARGET_USER_ID` are already set. Claude Code's job:

1. Run `vercel env ls --yes production | grep -E '^(OMEGA_MCP_KEY|OMEGA_TARGET_USER_ID)'`. Confirm both exist.
2. Do not add, modify, or delete any env var in this batch. Matt has handled the secret management.
3. If either var is missing from the output, stop and surface — do NOT add them without Matt's explicit instruction (prevents accidental overwrite of the Sensitive value).

This batch produces no commit. It's a checkpoint that documents the env state at time of deploy.

### Batch 4 — Deploy and verify in production

1. After Batches 1 and 2 are merged to main and production deploy completes, wait 2 minutes for cold start.
2. Open the cockpit for test deal `d65cc19e-b03e-4f2d-89ce-95ee69472cf3`. Load the page once.
3. Within 5 minutes of the page load, query:
   ```sql
   SELECT type, COUNT(*) as n, MAX(created_at)::text as latest
   FROM buddy_signal_ledger
   WHERE type IN ('omega.invoked', 'omega.succeeded', 'omega.failed')
     AND created_at > NOW() - INTERVAL '10 minutes'
   GROUP BY type;
   ```
4. **Success criteria:** `omega.succeeded` ≥ 1, `omega.failed` = 0 or very low (and only for specific resources). `omega.invoked` should be ≥ 3 (typically 3–5 per cockpit load — one per Omega sub-call).
5. If any `omega.failed` rows exist, pull the `payload.error` field and diagnose. Common causes to check:
   - `omega_rpc_error: "target_user_id: Required"` → Batch 1 missed injecting `target_user_id` on that URI path
   - `omega_rpc_error: "Method 'X' not found"` → PIV-2's tool name mapping was wrong for URI X
   - `omega_http_401` → secret not being read correctly by the running deployment
   - Zod error on a specific field → tool schema changed since PIV-2 read, or argument name mismatch

### Batch 5 — Roadmap and build principles

Update `BUDDY_PROJECT_ROADMAP.md`:

1. Move D2 (the Omega `Method not found` item in Phase 84.1 backlog) to Completed Phases, referencing this repair's commit chain.
2. Add completion note to Completed Phases:
   > **Omega advisory repaired 2026-04-23.** Four independent client bugs fixed: JSON-RPC method wrong (`omega://` URIs replaced with `tools/call`), auth header wrong (`x-pulse-mcp-key` replaces `Authorization: Bearer`), secret wrong (new `OMEGA_MCP_KEY` env var from GCP Secret Manager `PULSE_MCP_API_KEY` v2), and authz shape wrong (`target_user_id` now injected in every tool call from `OMEGA_TARGET_USER_ID` env var). Pre-repair 100% failure rate restored to [X]% success rate in post-deploy verification. Integration contract now matches deployed Pulse MCP source at `29xh24fm6r-ctrl/PulseMasterrepo:services/pulse-mcp/src/`. Commits: [chain].
3. Add three new build principles:

   > **MCP JSON-RPC envelope is `tools/call`, not custom method names.** When integrating Buddy with any MCP server, the client always speaks `method: "tools/call"` with `params: {name: <tool>, arguments: <payload>}`. Custom JSON-RPC method names (e.g., `omega://events/write`) are not recognized by any MCP server — they are an anti-pattern from early prototyping that must not be reintroduced. Auth header for `tools/call` is `x-pulse-mcp-key`; `Authorization: Bearer` is for the `/ingest/buddy` path only. Every Pulse tool requires `target_user_id` as an argument — this is the authz layer, orthogonal to the `x-pulse-mcp-key` authn layer. Verified 2026-04-23 by end-to-end repair of the Omega advisory surface. See `specs/diagnostic-pulse-omega/FINDINGS-PHASE-2.md` for the diagnostic history. (OMEGA-REPAIR)

   > **Probe deployed services and read their actual source before inferring contracts from Buddy's in-repo client code.** Services with independent release cycles (Cloud Run deployments updated outside the main Buddy repo) drift from their in-repo skeletons. Phase 1 of the Pulse/Omega diagnostic read `services/pulse-mcp/src/routes/ingestBuddy.ts` in-repo and inferred an HMAC contract; Phase 2 probed the deployed endpoint and found Bearer auth accepted. The in-repo Buddy code was months stale. The real Pulse MCP source lives in a separate repo (`29xh24fm6r-ctrl/PulseMasterrepo`). Rule: any diagnostic conclusion about a deployed service must be grounded in (a) live probes (curl, MCP introspection), (b) source from the actual deployment repo, not in-repo skeletons. (OMEGA-REPAIR diagnostic lesson)

   > **Buddy-Pulse integration has a two-sided surface. Check both sides.** Pulse MCP source lives at `29xh24fm6r-ctrl/PulseMasterrepo:services/pulse-mcp/src/`. Buddy's Omega + fastlane + outbox clients live at `29xh24fm6r-ctrl/Buddy-The-Underwriter:src/lib/omega/`, `:src/lib/pulseMcp/`, and `:src/lib/outbox/`. Any future change to the integration requires reading both repos. The "deployed Pulse MCP has 40 tools" fact can only be verified against `PulseMasterrepo/services/pulse-mcp/src/tools/index.ts`, not Buddy's in-repo `services/pulse-mcp/` skeleton (which is stale). (OMEGA-REPAIR)

---

## Commit strategy

Four commits, one PR:

1. `feat(omega): repair invokeOmega — tools/call + x-pulse-mcp-key + target_user_id injection` — Batch 1 + tests
2. `feat(omega): align adapter response shapes with real Pulse tool outputs` — Batch 2 + tests
3. (No commit — Batch 3 is verification-only)
4. `docs: OMEGA-REPAIR roadmap update + three new build principles` — Batch 5

Batch 4 verification is an AAR artifact, not a commit.

---

## Verification protocol

### V-1 — Ledger success rate

Run PIV-1's query 1 hour after deploy, 24 hours after deploy.

- 1-hour success: `omega.succeeded / omega.invoked` ≥ 80%
- 24-hour success: `omega.succeeded / omega.invoked` ≥ 95%

If the 1-hour ratio is <60%, revert Batch 1 and 2 via git. The repair is incomplete.

### V-2 — Cockpit visible change on test deal

Matt opens the cockpit for `d65cc19e-...` after deploy and reports what renders.

Before repair:
- `OmegaAdvisoryPanel`: renders `null` (invisible)
- `OmegaConfidenceBadge`: renders `null` (invisible)
- `OmegaTraceDrawer`: renders in builder mode only, empty

After repair (expected):
- At minimum: calls succeed; adapter returns `stale: true, staleReason: "Omega returned no data for this deal"`. UI still invisible (no data to show). This is the correct degradation — Pulse hasn't analyzed this deal yet.
- If Pulse has analyzed the deal: one or more panels populate. Visible change.

Either outcome is acceptable. The test is whether the *call succeeded*, not whether the *UI changed*.

### V-3 — Regression test: no pipeline impact

Run one full test pack execution on Samaritus (the 9 fixed documents at deal `d65cc19e-...`). Confirm:
- All 9 docs upload, classify, extract as before (`deal_financial_facts` count unchanged vs pre-repair snapshot)
- No change in spreads
- Snapshot/recon/UW behavior identical
- No new error entries in `buddy_system_events`

Omega is advisory-only. Repair should have zero pipeline impact. This regression test proves it.

### V-4 — Fallback path still works

For a deal where Pulse has NOT analyzed, the cockpit should fall back to `ai_risk_runs` synthesis. That code path is in the state API route, not in the adapter. Confirm by loading a non-test deal and observing the fallback renders.

---

## Rollback

If V-1's 1-hour ratio is <60% or V-3 shows pipeline regression:

1. Revert Batch 1 and Batch 2 commits. Restores the 100% Omega failure rate — but that was the known-safe prior state.
2. Leave both env vars in place (no harm).
3. Leave the build principles in the roadmap (diagnostic lessons remain true regardless of repair outcome).
4. Investigate, re-spec, try again.

SR 11-7 wall protects us here — reverting doesn't hurt the pipeline.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| PIV-2's tool schema reads find `state_inspect` / `state_confidence` / `observer_query` don't exist, or take unexpected arguments | Medium-high | PIV-2 mandates source reading. If mismatch, Claude Code stops and surfaces. Matt may decide to add purpose-built Pulse tools or redirect to existing ones. |
| `OMEGA_TARGET_USER_ID` viewer UUID doesn't actually have access to whatever data Pulse has for the test deal | Medium | Pulse's `assertViewerCanReadTarget` fast-path: viewer === target is always allowed. Single-tenant setup (confirmed). If multi-tenant access needed later, separate work. |
| Pulse's response shape (`{summary, artifacts}`) requires more adapter work than expected | Medium | Batch 2 explicitly does this verification. If the mapping is genuinely hostile, Pulse-side purpose-built tools (option b from Phase 2) become the fallback. |
| The `target_user_id` injection masks a separate identity bug (e.g., deals actually belong to a different user in Pulse's view) | Low | `assertViewerCanReadTarget` falls back to `pulse_mcp_viewers` DB check on mismatch. If any cockpit load fails with 403 (not 401), that's the signal — surface to Matt. |
| Test suite doesn't catch shape issues because mocks are Buddy-side only | Medium | V-1 and V-2 are production-ledger verification, not unit-test verification. Real traffic validates. |
| Pulse MCP's auth middleware rejects on any of: key, header name, or target user — but the error surfaces as generic 401 | Low | PIV-3's probe against `mcp_tick` isolates the key+header issue separately from per-tool `target_user_id`. |
| The 100% failure rate becomes a 100% success rate but the adapter's unwrapping produces `stale: true` on every call (functionally no change for the user) | Medium | Expected for deals Pulse hasn't analyzed. V-1 measures call success, not UI change. |

---

## Addendum for Claude Code — judgment boundaries

**Authorized:**
- Read any file in `29xh24fm6r-ctrl/Buddy-The-Underwriter` and `29xh24fm6r-ctrl/PulseMasterrepo` (both via GitHub MCP)
- Read any table in Buddy's Supabase (read-only, via Supabase MCP)
- Probe the deployed Pulse MCP via `curl` (discovery and tool calls)
- Write code changes to `src/lib/omega/` and `src/core/omega/` in Buddy's repo
- Write new tests to `src/lib/omega/__tests__/` and `src/core/omega/__tests__/`
- Commit Batch 1, 2, 5 to `main` once ready

**NOT authorized:**
- Modify `OMEGA_MCP_KEY` or `OMEGA_TARGET_USER_ID` env vars in Vercel (Matt handled this; don't overwrite)
- Delete `OMEGA_MCP_API_KEY` from Vercel (deprecation only; leave for rollback)
- Modify any file in `PulseMasterrepo` (that's a separate codebase; repair is Buddy-side only)
- Silence any ledger signal — diagnostic signals must keep firing so V-1 is measurable
- Touch outbox or ledger forwarder code paths (confirmed working in Phase 2)
- Ship without running PIV-1 through PIV-5 and reporting findings in the AAR
- Commit any secret value to the repo in any form (code, comment, test fixture, `.env` file, console output)

**If PIV-2 finds that `state_inspect` / `state_confidence` / `observer_query` don't exist on the Pulse side:**
Stop. Surface to Matt with the list of tools that DO exist (from `PulseMasterrepo/services/pulse-mcp/src/tools/index.ts`). Matt will decide: (a) add purpose-built Pulse tools, (b) redirect Omega reads to existing tools with different names, or (c) retire the Omega read path entirely.

**If a fifth bug surfaces during implementation:**
Stop. The diagnostic pattern of this arc is that each phase finds bugs the previous missed. Don't paper over a new finding; spec it separately.

---

## After this lands

The foundation is rock-solid. Buddy talks to Pulse correctly. The 100% failure rate is gone. Cockpit has real data where Pulse has analyzed, graceful degradation where it hasn't.

Next on the Buddy ↔ Pulse axis:
- Retire the fastlane (the never-real integration; separate small PR)
- Replay the 336 DLQ rows from Jan/Feb (optional telemetry recovery)
- Begin the "Pulse-as-driver" architectural rethink (future spec, now informed by a working baseline)
- Deprecate and eventually remove `OMEGA_MCP_API_KEY` (1-2 weeks of stable operation, then clean env removal)

The repair is not the vision. The repair gives us ground to stand on while the vision work happens.
