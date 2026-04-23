# Spec OMEGA-REPAIR — Fix Two Wire-Level Bugs + Field Mapping + Kill-Switch the Read Path

**Date:** 2026-04-23 (rev 3.3; adds field-name mapping in the write-path translator after Claude Code's PIV surfaced that rev 3.2's spread would produce Zod failures)
**Supersedes:** Prior rev 3.2 at commit `bf1b63d2`
**Owner:** Matt
**Executor:** Claude Code
**Estimated effort:** 3–5 hours.
**Risk:** Low. No pipeline impact (SR 11-7 wall).

---

## What changed in rev 3.3

Claude Code's PIV against rev 3.2 surfaced that `mirrorEventToOmega` builds an envelope with field names that do not match `buddy_ledger_write`'s input schema:

| Buddy envelope field | Pulse tool field | Status in rev 3.2 |
|---|---|---|
| `type` | `event_type` | Wrong name — Pulse rejects with Zod error (field required, missing) |
| (none) | `status` | Not sent — Pulse rejects with Zod error (field required, missing) |
| `entities[].id` where entity_type is `deal` | `deal_id` | Not extracted |
| `payload` | `payload` | OK |

Rev 3.2's translator used `...baseArgs, ...payloadObj` which preserved Buddy's field names verbatim. `buddy_ledger_write`'s schema would reject every call with `Zod: event_type required, status required`. Outcome D (Zod rejection) wasn't in rev 3.2's outcome table. The code would have been functionally equivalent to still-broken Omega, just with a different error string.

**Rev 3.3 change:** the write-path branch of `translateResourceToToolCall` now explicitly maps Buddy envelope field names to Pulse's schema. Not a spread — an explicit field mapping. Same scope as before (the translator is already the adapter layer between Buddy URIs and Pulse tools; field mapping is what that layer is for).

## What carries forward

- All rev 3.2 framing: PIV-3 deferred, Batch 4 is the authoritative auth test, outcomes A/B/C acceptable.
- All rev 3.1 framing: health path → `mcp_tick`, Vercel Sensitive env principle.
- All rev 3 framing: read-path kill-switched, Pulse-side companion spec for deal-scoped tools.
- Five build principles from rev 3.2 plus one new one in rev 3.3.

---

## The actual problem

Omega advisory is 100% failing in production. 53/53 `omega.invoked` → `omega.failed`, all with `omega_rpc_error: Method not found`.

**Two wire-level blocker bugs:**
1. Wrong JSON-RPC method — `omega://` URIs used directly instead of `tools/call`
2. Wrong auth header — `Authorization: Bearer` instead of `x-pulse-mcp-key`

**One field-mapping bug (rev 3.3):** even with the wire fixed, the write-path body shape doesn't match `buddy_ledger_write`'s schema. Translator must explicitly map fields.

**Real-tool mappings:**
- `omega://events/write` → `buddy_ledger_write` with field mapping (rev 3.3)
- `omega://health/ping` → `mcp_tick` (rev 3.1)

**Design-level gap on read path:** Pulse doesn't expose deal-scoped advisory tools. Kill-switched pending PULSE-SIDE-SPEC.md.

## The chosen shape of repair (B1 + field mapping)

**Buddy side (this PR):**
- Fix wire blockers
- Wire write + health paths with explicit field mapping for write
- Kill-switch read path

**Pulse side (separate):** Deal-scoped advisory tools.

**Follow-up Buddy PR:** Lift kill switch when Pulse ships.

## Outcome we want

- Every Omega call reaches Pulse with well-formed `tools/call` envelope, correct auth, and correct field shapes.
- `buddy_signal_ledger` shows:
  - `omega.succeeded` for write and health (if auth works)
  - OR `omega.failed` with `http_401` (if auth is still broken — acceptable outcome B)
  - `omega.failed` for reads with `pulse_advisory_tools_not_yet_available`
  - Zero `Method not found`
  - Zero `Zod`-shaped errors for the write path

## Non-goals

Unchanged from rev 3.2.

---

## Pre-implementation verification (MANDATORY)

### PIV-1 — Record current failure baseline

```sql
SELECT type, COUNT(*) as n, MAX(created_at)::text as latest
FROM buddy_signal_ledger
WHERE type IN ('omega.invoked', 'omega.succeeded', 'omega.failed', 'omega.timed_out', 'omega.killed')
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY type;
```

Expected: `omega.invoked` ≈ 53, `omega.failed` ≈ 53, `omega.succeeded` = 0.

### PIV-2 — Read deployed tool contracts from `tools/list`

```bash
curl -sS -X POST https://pulse-mcp-651478110010.us-central1.run.app/ \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"piv2","method":"tools/list"}' | jq '.result.tools[] | {name, description, inputSchema}' > /tmp/pulse-tools.json
```

Record:
1. `buddy_ledger_write` exists. Confirm exact required/optional field list:
   - Required: `event_type`, `status`
   - Optional: `target_user_id`, `deal_id`, `payload`, `expected_outcome`, `actual_outcome`
   - If schema differs (e.g., `status` enum values change, or new required fields), update the translator's write branch to match.
2. `mcp_tick` exists, zero-args.
3. `buddy_advisory_for_deal` / `buddy_confidence_for_deal` / `buddy_traces_for_deal` do NOT exist. If they have appeared, surface.

### PIV-3 — DEFERRED

Unchanged from rev 3.2. Claude Code does not probe auth.

### PIV-4 — Env var state

```bash
npx vercel env ls --yes production | grep -E '^(OMEGA_MCP_KEY|OMEGA_TARGET_USER_ID|OMEGA_MCP_API_KEY|OMEGA_MCP_URL|OMEGA_MCP_ENABLED)'
```

All five expected. If any missing, stop and surface.

### PIV-5 — Call graph audit

Known callers (unchanged from rev 3.2):
- `src/lib/omega/mirrorEventToOmega.ts` → write path
- `src/lib/omega/health.ts` → health path
- `src/core/omega/OmegaAdvisoryAdapter.ts` → read path (kill-switched)
- `src/app/api/deals/[dealId]/underwrite/state/route.ts` → read path (kill-switched)
- `src/app/api/examiner/portal/deals/[dealId]/route.ts` → read path indirect (kill-switched)

### PIV-6 — Confirm caller envelope shape (NEW in rev 3.3)

Read `src/lib/omega/mirrorEventToOmega.ts` and verify the envelope shape currently passed to `invokeOmega`:

```ts
{ type, entities, payload, ts, correlationId }
```

Where `entities: Array<{ entity_type: string; id?: string; optional?: boolean }>`.

Also read `docs/omega/mapping.json` and record the distinct `entity_type` values used across events. As of this spec: `deal`, `underwriting_case`, `borrower`, `document`, `credit_decision`, `policy_context`, `examiner_drop`, `financial_snapshot`, `borrower_owner`. The ones that correspond to "deal" for Pulse's `deal_id` field are `deal` and `underwriting_case` (both map to `deals.id`). Surface if the set differs from expected.

---

## Implementation plan

Three commits, one PR.

### Batch 1 — Fix wire + field mapping, wire write + health, kill-switch reads

**File:** `src/lib/omega/invokeOmega.ts`

**Changes:**

1. **Secret lookup.** (Unchanged from rev 3.2.)
   ```ts
   function getOmegaMcpApiKey(): string | undefined {
     const newKey = process.env.OMEGA_MCP_KEY;
     if (newKey) return newKey;
     const fallback = process.env.OMEGA_MCP_API_KEY;
     if (fallback) {
       console.warn("[omega] using deprecated OMEGA_MCP_API_KEY env var — rename to OMEGA_MCP_KEY");
       return fallback;
     }
     return undefined;
   }
   ```

2. **Auth header.** Replace `Authorization: Bearer` with `x-pulse-mcp-key`.

3. **URI→tool translation (REVISED in rev 3.3 with explicit field mapping for write).**
   ```ts
   interface ToolCall {
     tool: string;
     arguments: Record<string, unknown>;
   }

   interface OmegaEventEnvelope {
     type: string;
     entities?: Array<{ entity_type: string; id?: string; optional?: boolean }>;
     payload?: unknown;
     ts?: string;
     correlationId?: string;
   }

   // Entity types that should populate Pulse's `deal_id` field.
   // Sourced from docs/omega/mapping.json — both alias to deals.id.
   const DEAL_ENTITY_TYPES = new Set(["deal", "underwriting_case"]);

   function getOmegaTargetUserId(): string | undefined {
     return process.env.OMEGA_TARGET_USER_ID || undefined;
   }

   function translateResourceToToolCall(
     resource: string,
     payload: unknown,
   ): ToolCall | null {
     const targetUserId = getOmegaTargetUserId();
     const baseArgs = targetUserId ? { target_user_id: targetUserId } : {};

     // Write path — explicit field mapping from Buddy envelope to buddy_ledger_write schema
     if (resource === "omega://events/write") {
       const envelope = payload as OmegaEventEnvelope;

       if (!envelope?.type) {
         // Surfaced as specific error rather than sending a broken body
         throw new Error("omega_write_missing_event_type");
       }

       // Extract deal_id from entities array when a deal/underwriting_case entity is present
       const dealEntity = envelope.entities?.find(
         (e) => DEAL_ENTITY_TYPES.has(e.entity_type) && typeof e.id === "string",
       );

       return {
         tool: "buddy_ledger_write",
         arguments: {
           ...baseArgs,
           event_type: envelope.type,  // map: type → event_type
           status: "success",          // mirror only fires on successful signals
           ...(dealEntity?.id ? { deal_id: dealEntity.id } : {}),
           // Roll the rest of Buddy's envelope under payload for Pulse governance store
           payload: {
             entities: envelope.entities ?? [],
             body: envelope.payload ?? {},
             ts: envelope.ts,
             correlationId: envelope.correlationId,
           },
         },
       };
     }

     // Health path — real tool
     if (resource === "omega://health/ping") {
       return {
         tool: "mcp_tick",
         arguments: {},
       };
     }

     // Read paths — kill-switched
     const isReadResource = /^omega:\/\/(state|confidence|traces|advisory)\//.test(resource);
     if (isReadResource) return null;

     return null;
   }
   ```

4. **Error handling:**
   ```ts
   let toolCall: ToolCall | null = null;
   try {
     toolCall = translateResourceToToolCall(resource, payload);
   } catch (translationErr) {
     // Specific translator errors (e.g., omega_write_missing_event_type) bubble up as-is
     throw translationErr;
   }
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

Wire/header tests (unchanged):
- Header `x-pulse-mcp-key` set, `Authorization` not set
- Body has `method: "tools/call"`

Write-path field mapping tests (NEW in rev 3.3):
- Envelope `{ type: "buddy.deal.ignited", entities: [{entity_type: "deal", id: "d1"}], payload: {foo:"bar"}, ts: "...", correlationId: "c1" }` → `params.arguments` has `event_type: "buddy.deal.ignited"`, `status: "success"`, `deal_id: "d1"`, `payload.entities === entities`, `payload.body === {foo:"bar"}`, `payload.ts === "..."`, `payload.correlationId === "c1"`.
- Envelope with `entity_type: "underwriting_case"` entity also extracts `deal_id`.
- Envelope with no deal/underwriting_case entity → no `deal_id` field in arguments (not empty string, not null, genuinely absent).
- Envelope missing `type` → throws `omega_write_missing_event_type`; body never sent.
- `target_user_id` injected when env var set, not injected when unset.

Health-path (unchanged from rev 3.1):
- `omega://health/ping` → `params.name === "mcp_tick"`, `params.arguments === {}`.
- `target_user_id` NOT injected for mcp_tick (zero-args tool).

Read-path kill-switch (unchanged):
- Each read resource returns `{ ok: false, error: "pulse_advisory_tools_not_yet_available" }`.

Error paths (unchanged):
- Unknown URI → `omega_unmapped_resource: ...`.
- Deprecated `OMEGA_MCP_API_KEY` fallback emits warn, still works.

Regression (unchanged):
- Timeout, kill-switch, disabled paths untouched.

### Batch 2 — Adapter: explicit stale-reason for kill-switched reads

Unchanged from rev 3.2.

### Batch 3 — Env verification (no commit)

Unchanged.

### Batch 4 — Deploy and verify

1. After Batches 1 and 2 merge, deploy completes, wait 2 minutes.
2. Trigger cockpit load on `d65cc19e-...` and a health-check route.
3. Query:
   ```sql
   SELECT type, payload->>'resource' as resource, payload->>'error' as error, COUNT(*) as n
   FROM buddy_signal_ledger
   WHERE type LIKE 'omega.%'
     AND created_at > NOW() - INTERVAL '10 minutes'
   GROUP BY type, payload->>'resource', payload->>'error'
   ORDER BY type, n DESC;
   ```

4. **Four possible outcomes:**

   **(A) Full success.** `omega.succeeded` for write + health; reads show `pulse_advisory_tools_not_yet_available`; zero `Method not found`, zero `http_401`, zero Zod errors. Repair complete.

   **(B) Auth 401 in Vercel runtime.** `omega.failed` with `http_401` for write + health; reads kill-switched; zero `Method not found`, zero Zod errors. Code repair complete; auth mystery separate Matt-owned workstream. Acceptable ship state.

   **(C) `Method not found` persists.** Batch 1 wire fix incomplete. REVERT.

   **(D) Zod validation error on write path.** `omega.failed` with `omega_rpc_error: <Zod message>` for write specifically; health works or 401s cleanly; reads kill-switched. Field mapping has drifted from `buddy_ledger_write` schema (probably Pulse-side schema change between spec-write and deploy). Read Pulse's `tools/list` response fresh, compare to rev 3.3's mapping, amend translator. NOT a full revert — focused fix on the write branch.

   Outcomes A and B both count as shipping the PR's intent. Outcome C reverts; Outcome D is a small amendment, not a revert.

### Batch 5 — Roadmap and six build principles

Update `BUDDY_PROJECT_ROADMAP.md`:

1. Move D2 to Completed.
2. Completion note:
   > **Omega wire-level repair + field mapping 2026-04-23.** Three bugs fixed: JSON-RPC method (`omega://` → `tools/call`), auth header (`Authorization: Bearer` → `x-pulse-mcp-key`), and write-path field shape (Buddy envelope `type` → Pulse schema `event_type`, default `status: "success"`, extract `deal_id` from entities). Write + health paths wired to real Pulse tools (`buddy_ledger_write`, `mcp_tick`). Read path kill-switched with `pulse_advisory_tools_not_yet_available` pending PULSE-SIDE-SPEC.md. Pulse-side auth state confirmed inconsistent during diagnostic — Batch 4 serves as authoritative auth test, persistent `http_401` is separate-workstream state. Commits: [chain].

3. Six build principles (one added in rev 3.3):

   > **(1) MCP integration contracts are sourced from the deployed service's `tools/list`, not from in-repo source code.** Services with independent release cycles drift. Rule: any MCP client work MUST `POST /{method:"tools/list"}` and record actual names + schemas before mapping client code. (OMEGA-REPAIR rev 3.3)

   > **(2) Stop-and-surface is load-bearing.** Six moments in the Pulse/Omega arc (D3 pushback → diagnostic; Phase 2 probe → falsified black-hole; rev 2 execution → caught wrong tool names; rev 3 PIV → caught unrunnable PIV-3 and unmapped health URI; rev 3.1 PIV-3 probe → caught Pulse-side auth inconsistency; rev 3.2 PIV → caught field-name mismatch) were only caught because someone stopped partway and surfaced. Rule: whenever execution evidence contradicts the spec, stop and surface. (OMEGA-REPAIR rev 3.3)

   > **(3) MCP JSON-RPC envelope is `tools/call`, not custom method names.** The client speaks `method: "tools/call"` with `params: {name, arguments}`. Auth for tool calls is `x-pulse-mcp-key`. `target_user_id` is optional in Pulse schemas. (OMEGA-REPAIR rev 3.3)

   > **(4) Vercel's `env pull` returns empty values for Sensitive-flagged env vars by design.** PIV procedures needing secret values cannot use `env pull` for Sensitive vars. Options: manual out-of-band probe, REST API with token, or diagnostic endpoint. (OMEGA-REPAIR rev 3.3)

   > **(5) Diminishing-returns rule for cross-system auth diagnostics.** After 3+ chat-based probe rounds without resolution, stop probing and defer to production verification. Production ledger is more authoritative than out-of-band probes, and is achievable for free by deploying the code fix. Rule: if PIV is looping, mark as deferred, ship the code, and let the ledger tell the truth. (OMEGA-REPAIR rev 3.3)

   > **(6) Tool-name mapping is necessary but not sufficient; field-name mapping is the second layer.** When integrating with an external tool, verifying the tool NAME exists in `tools/list` is table-stakes. The second required check is: does the caller's payload shape match the tool's `inputSchema` field-by-field? Tool-name match + field-name mismatch produces Zod errors at runtime — different from "tool not found" but equally fatal. Rule: when writing the translator/adapter layer, explicitly enumerate the required and optional fields from the tool's `inputSchema` and map caller data into them field-by-field. Do not spread caller objects into tool arguments without matching field names first. (OMEGA-REPAIR rev 3.3 — from the rev 3.2 → rev 3.3 PIV)

4. Queue in Next Phases:
   - Pulse-side deal-scoped advisory tools (PULSE-SIDE-SPEC)
   - Pulse-side auth diagnostic (if Batch 4 = outcome B)

---

## Commit strategy

Three commits, one PR:

1. `feat(omega): repair wire + field mapping — tools/call + x-pulse-mcp-key + explicit buddy_ledger_write field mapping + mcp_tick health + read kill-switch`
2. `feat(omega): adapter explicit stale-reason for kill-switched reads`
3. `docs: OMEGA-REPAIR rev 3.3 roadmap update + six build principles`

---

## Verification protocol

Unchanged except V-1 tolerates both outcomes A and B and catches both C and D distinctly.

---

## Rollback

Only outcome C (persistent `Method not found`) triggers a full revert. Outcome B (`http_401` only) is acceptable. Outcome D (Zod error) is a focused translator amendment, not a revert.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `buddy_ledger_write` schema has drifted between spec and deploy | Low | PIV-2 re-reads the live schema; translator updated if drift found |
| `OMEGA_MCP_KEY` wrong in Vercel runtime | Medium | Acceptable outcome B — code still correct, Matt owns Pulse-side fix |
| Mapping.json adds a new entity type that should map to `deal_id` | Low | `DEAL_ENTITY_TYPES` set is a single-file edit; PIV-6 catches this |
| Caller (`mirrorEventToOmega`) changes its envelope shape | Low | PIV-6 verifies caller shape at spec-execution time; would surface |
| Rev 3.3 misses another field-mapping bug | Low | Batch 4 outcome D catches Zod errors distinctly from wire errors |

---

## Addendum for Claude Code — judgment boundaries

**Authorized:**
- Read any file in Buddy's repo
- Read Supabase read-only
- Probe deployed Pulse MCP with `tools/list` (unauthenticated)
- Write code to `src/lib/omega/`, `src/core/omega/`, and tests
- Commit Batches 1, 2, 5 to `main`
- Deploy to production

**NOT authorized:**
- Probe `tools/call` with `OMEGA_MCP_KEY` (PIV-3 deferred)
- Modify any Vercel env var
- Modify any file in PulseMasterrepo
- Silence any ledger signal
- Touch outbox or ledger forwarder code
- Commit secret values in any form
- Paper over newly-discovered bugs

**If PIV-2 finds `buddy_ledger_write`'s schema differs (e.g., additional required fields like `tenant_id`):** update translator's write branch to match. Not a stop-and-surface — that's the exact job of the spec.

**If PIV-2 finds `buddy_advisory_for_deal` etc. have been added to Pulse:** stop and surface.

**If PIV-6 finds `mirrorEventToOmega`'s envelope shape has changed:** stop and surface; envelope contract affects translator.

**If Batch 4 = outcome C (any `Method not found`):** revert Batches 1/2. Diagnose.

**If Batch 4 = outcome D (Zod error on write path):** amend translator write branch to match live schema. Commit the fix; do not revert.

**If Batch 4 = outcome B (`http_401` only, no `Method not found`, no Zod):** acceptable ship state. Flag Pulse-side auth diagnostic for Matt.

---

## After this lands

Wire + field shape + kill-switch all correct. Signal shape clean regardless of auth state. Reads honestly kill-switched.

Remaining work:
1. PULSE-SIDE-SPEC.md execution
2. Buddy follow-up PR to lift kill switch
3. Pulse-side auth diagnostic (conditional on outcome B)
4. Fastlane retire PR
5. DLQ replay
6. Pulse-as-driver rethink
7. Deprecate `OMEGA_MCP_API_KEY`

The repair is not the vision. The repair gives us ground to stand on.
