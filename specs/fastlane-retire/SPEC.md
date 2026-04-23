# Spec FASTLANE-RETIRE — Remove the Never-Real Pulse Fastlane

**Date:** 2026-04-23
**Owner:** Matt
**Executor:** Claude Code
**Estimated effort:** 30–45 minutes
**Risk:** Very low. Deletes dead code. Outbox (canonical pipeline) is completely untouched and continues working exactly as today.

---

## Summary

The fastlane Pulse forwarder at `src/lib/outbox/tryForwardToPulse.ts` has **never worked in production**. It calls a Pulse MCP tool (`buddy_event_ingest`) that does not exist on the deployed service. The underlying client (`src/lib/pulseMcp/client.ts`) also speaks the wrong protocol to the deployed Pulse MCP at every level. Both have been dead code since deploy 2026-01-29.

Post-OMEGA-REPAIR (2026-04-23) we have a single correct path for Buddy → Pulse communication: the outbox + buddy-core-worker + `/ingest/buddy` Bearer-authed forwarder, *plus* the now-working `invokeOmega` JSON-RPC client. The fastlane is strictly redundant with the outbox and the latter is the system-of-record.

**Retiring the fastlane:**
- Eliminates `pulse.forwarding_failed: pulse_mcp_disabled` signal noise emitted on every pipeline event (D3 from AAR 2026-04-22)
- Removes a second wire-protocol path Buddy maintains to Pulse (simpler mental model going forward)
- Removes ~250 lines of dead code across 4 files
- Zero functional regression — outbox handles everything this was supposed to handle, just with a small latency delta (milliseconds to seconds) that no current consumer cares about

## What's being removed

### Primary deletions

| File | Lines | Rationale |
|---|---|---|
| `src/lib/outbox/tryForwardToPulse.ts` | 59 | The fastlane entry point. Calls nonexistent tool. |
| `src/lib/pulseMcp/client.ts` | 178 | Speaks wrong protocol: `{tool, input}` vs real `tools/call` JSON-RPC; wrong endpoint `/call` vs `/`; wrong tool names (`omega.events.write` vs `buddy_ledger_write`). Every method dead. |
| `src/lib/pulseMcp/emitPipelineEvent.ts` | lines 86–103 | The `tryFastLane` helper that imports `tryForwardToPulse`. Remove the helper; keep the outbox step. |
| `src/lib/pulseMcp/config.ts` | 24 | Exists only to configure `client.ts`. Delete unless still used elsewhere (PIV step 1 confirms). |
| `src/lib/pulseMcp/__tests__/` | — | Delete tests for the deleted files only. Keep any test that covers `emitPipelineEvent`'s outbox path (if present). |

### What stays

- `src/lib/outbox/insertOutboxEvent.ts` — untouched. System of record.
- `src/lib/pulse/forwardLedgerCore.ts` — separate workstream (the Bearer-authed `/ingest/buddy` forwarder; confirmed working via PR #823).
- `src/lib/omega/*` — untouched. OMEGA-REPAIR's wire-level client (correct protocol).
- `emitPipelineEvent` public API surface — unchanged signature. Only its internals lose the fastlane fire-and-forget.
- `buddy_outbox_events` table — unchanged.
- Buddy-core-worker (Cloud Run) — unchanged. Canonical forwarder.

### Env vars to audit

`PULSE_MCP_ENABLED`, `PULSE_MCP_URL`, `PULSE_MCP_API_KEY`, `PULSE_MCP_TIMEOUT_MS`, `PULSE_MCP_STRICT` — all five were consumed only by `pulseMcp/config.ts` to feed `pulseMcp/client.ts`. After retirement, these env vars are orphaned. **Do not remove them from Vercel in this PR** — follow the same stability-window pattern we used for `OMEGA_MCP_API_KEY`. Mark them for removal after 1–2 weeks of stable operation.

The `.env.example` block documenting them gets a deprecation comment (see Implementation step 5) but the vars stay listed to avoid confusing future env copy/pastes.

## Non-goals

- **Not touching the outbox.** `insertOutboxEvent.ts` and `buddy_outbox_events` continue working exactly as today.
- **Not touching the buddy-core-worker.** Separate service, separate repo. No changes.
- **Not touching `forwardLedgerCore.ts` (the Bearer telemetry forwarder).** Different subsystem — that one was confirmed working via PR #823 / commit `881ace13`.
- **Not touching `invokeOmega`.** OMEGA-REPAIR owns that path.
- **Not removing `PULSE_MCP_*` env vars from Vercel.** Stability window.
- **Not backfilling historical `pulse.forwarding_failed` ledger rows.** They remain as a historical record; future signals just stop being generated.

## PIV — Pre-implementation verification

### PIV-1 — Confirm no other callers of `pulseMcp/client.ts` exports

```bash
# From repo root
grep -rn "from \"@/lib/pulseMcp/client\"\|from \"@/lib/pulseMcp\"" src/ --include="*.ts" --include="*.tsx"
grep -rn "tryForwardToPulse\|pulseMcp.client\|PulseMcpClient\|pulseMcp/client" src/ --include="*.ts" --include="*.tsx"
```

Expected hits (acceptable):
- `src/lib/outbox/tryForwardToPulse.ts` — uses `callTool`, will be deleted anyway
- `src/lib/pulseMcp/emitPipelineEvent.ts` — imports `tryForwardToPulse` inside `tryFastLane`, will be cleaned
- `src/lib/pulseMcp/__tests__/*` — tests for deleted code, will be deleted

**Unexpected hits:** any import from `@/lib/pulseMcp/client` outside `src/lib/pulseMcp/` or `src/lib/outbox/tryForwardToPulse.ts` → stop and surface. The client may have a consumer we don't know about. Do NOT paper over with a stub; investigate the actual caller and decide whether to migrate them to the outbox path or `invokeOmega`.

### PIV-2 — Confirm `pulse.forwarding_failed` signal is really coming from this path

```sql
SELECT COUNT(*) as n, MAX(created_at)::text as latest
FROM buddy_signal_ledger
WHERE type = 'pulse.forwarding_failed'
  AND source = 'fastlane'
  AND created_at > NOW() - INTERVAL '24 hours';
```

Record the count. Expected: non-zero (the whole point of D3).

After deploy, the same query should return zero for any window after deploy time.

### PIV-3 — Confirm outbox rows are being produced correctly today (sanity check)

```sql
SELECT COUNT(*) as n, MIN(created_at)::text as earliest, MAX(created_at)::text as latest
FROM buddy_outbox_events
WHERE created_at > NOW() - INTERVAL '24 hours';
```

Record the count. This should be healthy (outbox is working). If it's zero, stop and surface — something else is wrong and deleting the fastlane would mask it.

## Implementation

### Step 1 — Delete the fastlane entry point

**File:** `src/lib/outbox/tryForwardToPulse.ts`

Action: delete the file entirely.

### Step 2 — Remove the fastlane invocation from `emitPipelineEvent`

**File:** `src/lib/pulseMcp/emitPipelineEvent.ts`

Remove the entire `tryFastLane` helper function (lines 86–103 approximately). Also remove the `void tryFastLane(...)` call inside `emitPipelineEvent` (around line 77).

**After the change, the function body becomes:**

```ts
export async function emitPipelineEvent(args: {
  kind: string;
  deal_id: string;
  bank_id?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const eventId = uuidv7();
    const safePayload = args.payload ? filterPayload(args.payload) : {};

    // Step 1: ALWAYS write to outbox (system of record).
    // Fastlane retired 2026-04-23 — outbox + buddy-core-worker is the only forward path.
    await insertOutboxEvent({
      id: eventId,
      kind: args.kind,
      dealId: args.deal_id,
      bankId: args.bank_id ?? null,
      payload: safePayload,
    });
  } catch {
    // swallow — never block workflows
  }
}
```

Keep `ALLOWED_PAYLOAD_KEYS`, `filterPayload`, imports of `insertOutboxEvent` and `uuidv7`. Remove the comment block referring to "Step 2: Fire-and-forget fast-lane delivery".

**Net effect:** `emitPipelineEvent`'s signature is unchanged. Every call site (however many exist) continues working identically. Only the never-real fastlane goroutine is removed.

### Step 3 — Delete the dead client and its config

Delete:
- `src/lib/pulseMcp/client.ts`
- `src/lib/pulseMcp/config.ts` — verify via PIV-1 that no non-client consumer imports it

### Step 4 — Delete tests for the deleted code

`src/lib/pulseMcp/__tests__/*` — delete only tests that import the deleted files. If any test covers `emitPipelineEvent`'s outbox behavior, keep it and update if needed.

**Specifically relevant:** Matt's memory mentions `src/lib/pulseMcp/__tests__/connection.test.ts` exists and enforces the `PULSE_MCP_API_KEY` vs `PULSE_MCP_KEY` split on the worker side. That test no longer has meaning if the client is deleted — the worker-side split still exists but it's enforced in the worker repo, not in Buddy's tree. Delete the connection test along with the client it was testing.

### Step 5 — Update `.env.example`

The `─── Pulse MCP (outbound, Next.js side) ────` block currently documents five env vars. Update the section's leading comment block to:

```bash
# ─── Pulse MCP (outbound, Next.js side) ────────────────────────────────────
# DEPRECATED 2026-04-23 (FASTLANE-RETIRE): These vars are orphaned in Buddy's
# Next.js tree as of commit <this-commit>. Buddy → Pulse communication is now
# handled exclusively by:
#   (1) the outbox + buddy-core-worker (system of record) — see insertOutboxEvent
#   (2) the Bearer-authed telemetry forwarder — see PULSE_BUDDY_INGEST_URL below
#   (3) the Omega MCP client — see OMEGA_MCP_* below (JSON-RPC tools/call)
# Leaving these vars listed to document past state. Remove from Vercel after
# 1–2 weeks of stable operation.
PULSE_MCP_ENABLED=false
PULSE_MCP_URL=https://pulse-mcp-651478110010.us-central1.run.app/sse
PULSE_MCP_API_KEY=
PULSE_MCP_TIMEOUT_MS=3000
PULSE_MCP_STRICT=false
```

### Step 6 — Typecheck + tests

```bash
npx tsc --noEmit
```

Expected: clean. If there are imports of the deleted files in non-obvious places, the typechecker will flag them.

```bash
npm test
```

Expected: all tests still pass (minus the deliberately-deleted `__tests__` files).

### Step 7 — Commit and deploy

Single commit with message:

```
feat(outbox): retire Pulse fastlane — outbox is the only Buddy→Pulse forward path

- Delete src/lib/outbox/tryForwardToPulse.ts (dead since deploy 2026-01-29, called nonexistent tool)
- Delete src/lib/pulseMcp/{client,config}.ts (spoke wrong protocol to deployed Pulse MCP)
- Strip tryFastLane() from emitPipelineEvent (keep outbox step, remove fastlane invocation)
- Delete related __tests__/connection.test.ts (tested deleted client)
- Update .env.example to document PULSE_MCP_* as deprecated

Closes D3 from AAR 2026-04-22. pulse.forwarding_failed: pulse_mcp_disabled
signal noise eliminated. Outbox pipeline untouched.

Part of OMEGA-REPAIR arc cleanup. See specs/fastlane-retire/SPEC.md.
```

## Verification

### V-1 — Check that the signal noise is gone

After deploy, wait ~5 minutes. Trigger a pipeline event (anything that calls `emitPipelineEvent` — uploading a doc to the test deal works). Then:

```sql
SELECT COUNT(*) as n
FROM buddy_signal_ledger
WHERE type = 'pulse.forwarding_failed'
  AND source = 'fastlane'
  AND created_at > '<deploy_time>'::timestamptz;
```

Expected: 0.

### V-2 — Check that the outbox is still working

Same test action. Query:

```sql
SELECT COUNT(*) as n, MAX(created_at)::text as latest
FROM buddy_outbox_events
WHERE created_at > '<deploy_time>'::timestamptz;
```

Expected: non-zero. Rows appearing means `insertOutboxEvent` still runs correctly.

### V-3 — TypeScript + regression

- `tsc --noEmit` stays clean
- Test suite: all previously-passing tests still pass (the 22 pre-existing failures from the OMEGA-REPAIR AAR remain unchanged)
- No new console errors on cockpit load

### V-4 — Sanity check the cockpit still works

Load the test deal cockpit in browser. Confirm:
- Page loads normally
- Checklist updates when a doc is added
- No new console errors

## Rollback

Single-commit revert. No data migration, no infrastructure change. If anything breaks:

```bash
git revert <commit-sha>
git push
```

Back to today's state in under a minute. Outbox never stopped; there's nothing to restore.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| PIV-1 finds an unexpected caller of `pulseMcp/client` | Low | Stop and surface; don't delete until the caller is either migrated or confirmed dead |
| Some workflow actually depends on fastlane for latency-sensitive UX | Very low (fastlane has been failing 100% for months — no UX ever depended on it) | If surfaced, keep `tryForwardToPulse` but replumb it through `invokeOmega` with correct tool — separate follow-up spec |
| Outbox rate changes after deploy (because fastlane was somehow affecting it) | Very low (orthogonal code paths) | V-2 measures |
| Deleting `config.ts` breaks a non-obvious import | Low | PIV-1 grep + `tsc --noEmit` catches any reference |

## Build principle emerging from this

> **Dead-on-arrival integrations should be retired, not silenced.** When a code path produces degraded signals on every invocation and has never successfully completed a request, the right move is deletion, not a kill-switch or config change. Silencing dead code leaves future engineers to rediscover that the silent path was always broken. Retirement removes the archaeology. The fastlane had been emitting `pulse.forwarding_failed` on every pipeline event since 2026-01-29 — never worked, client spoke wrong protocol, called nonexistent tool. D3 spec initially considered silencing; FASTLANE-RETIRE deletes instead. Rule: before silencing a degraded-signal source, verify whether it ever worked. If not, delete. (FASTLANE-RETIRE 2026-04-23)

## Hand-off

Execute directly. Small PR, clean diff, easy review. If PIV-1 surfaces an unexpected caller, stop and report — we'll figure out the migration path before anything else.
