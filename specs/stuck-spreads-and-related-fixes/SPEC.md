# Spec STUCK-SPREADS-AND-RELATED-FIXES — Diagnose and Fix the Spread Orphan Pattern

**Date:** 2026-04-23
**Owner:** Matt
**Executor:** Claude Code
**Estimated effort:** 4–7 hours total across 4 batches. Each batch is independently committable.
**Risk:** Medium-low. Each batch is bounded. PIVs verify reality before each commit.

---

## TL;DR — What this spec does

Fixes 4 distinct but related bugs surfaced during Test Pack Run 2 on deal `e505cd1c-86b4-4d73-88e3-bc71ef342d94`:

| Batch | Fix | Effort | Risk |
|---|---|---|---|
| **1** | Stuck spreads (orchestrator crashes silently, leaves orphan placeholders) | 2–3 hr | medium |
| **2** | Ownership entity display_name garbage (`"MICHAEL NEWMARK\nTaxpayer address"`) — D1 from AAR 2026-04-22 | 1 hr | low |
| **3** | Readiness panel lies — counts deal-scoped spreads as "complete" while owner-scoped ones are stuck | 1 hr | low |
| **4** | Document, do not fix yet, the buddy-core-worker outbox forwarder dead path | 30 min | none |

Total work commits to main: 3 PRs (Batch 1, 2, 3 each their own commit). Batch 4 is doc-only.

The unifying observation behind these bugs: **the spread system has multiple silent failure modes that all manifest as "data exists but UI says everything is fine"**. Each batch eliminates one silent failure mode.

---

## Pre-implementation verification (MANDATORY before Batch 1)

Run all of PIV-0 through PIV-4 first. Stop and surface if any expectation is violated.

### PIV-0 — Confirm test deal state still matches spec evidence

```sql
SELECT 
  spread_type,
  status,
  spread_version,
  owner_type,
  owner_entity_id,
  started_at IS NULL as never_started,
  finished_at IS NULL as never_finished,
  ROUND(EXTRACT(EPOCH FROM (NOW() - updated_at))/60)::int as minutes_since_update
FROM deal_spreads
WHERE deal_id = 'e505cd1c-86b4-4d73-88e3-bc71ef342d94'
ORDER BY spread_type;
```

**Expected:**
- 4 spreads in `ready` status (BALANCE_SHEET, T12, STANDARD, PERSONAL_INCOME)
- 2 spreads in `queued` status (GLOBAL_CASH_FLOW v3, PERSONAL_FINANCIAL_STATEMENT v1) with `never_started=true`

If reality differs:
- The deal may have moved on (someone manually re-ran spreads or test pack progressed). That's OK — pick a different test deal showing the same symptom (look for `deal_spreads.status = 'queued'` AND `started_at IS NULL` AND `updated_at < NOW() - INTERVAL '5 minutes'`).
- Or the issue self-resolved. In that case, you cannot reproduce — STOP and surface.

### PIV-1 — Confirm orphan run pattern

```sql
SELECT 
  r.id as run_id,
  r.status as run_status,
  r.started_at::text,
  r.finished_at::text,
  r.created_at::text,
  (SELECT COUNT(*) FROM deal_spread_jobs j 
    WHERE j.deal_id = r.deal_id 
    AND j.meta->>'run_id' = r.id::text) as associated_jobs
FROM deal_spread_runs r
WHERE r.deal_id = 'e505cd1c-86b4-4d73-88e3-bc71ef342d94'
ORDER BY r.created_at DESC;
```

**Expected:** at least one run with `status='queued'`, `finished_at IS NULL`, `associated_jobs = 0`. That's the orphan.

### PIV-2 — Confirm extractor is NOT the bottleneck

```sql
SELECT fact_type, COUNT(*) as n
FROM deal_financial_facts
WHERE deal_id = 'e505cd1c-86b4-4d73-88e3-bc71ef342d94'
  AND fact_type = 'PERSONAL_FINANCIAL_STATEMENT'
GROUP BY fact_type;
```

**Expected:** 17 facts. If 0, extractor never produced PFS facts and the fix is upstream — STOP and surface (this would be a different bug).

### PIV-3 — Confirm template prereqs would pass

```sql
-- Confirm INCOME_STATEMENT facts exist (T12 prereq satisfied)
SELECT 
  (SELECT COUNT(*) FROM deal_financial_facts WHERE deal_id = 'e505cd1c-86b4-4d73-88e3-bc71ef342d94' AND fact_type = 'INCOME_STATEMENT') as income_statement,
  (SELECT COUNT(*) FROM deal_financial_facts WHERE deal_id = 'e505cd1c-86b4-4d73-88e3-bc71ef342d94' AND fact_type = 'BALANCE_SHEET') as balance_sheet,
  (SELECT COUNT(*) FROM deal_financial_facts WHERE deal_id = 'e505cd1c-86b4-4d73-88e3-bc71ef342d94' AND fact_type = 'PERSONAL_INCOME') as personal_income,
  (SELECT COUNT(*) FROM deal_financial_facts WHERE deal_id = 'e505cd1c-86b4-4d73-88e3-bc71ef342d94' AND fact_type = 'PERSONAL_FINANCIAL_STATEMENT') as pfs;
```

**Expected:** all four > 0. If PFS = 0 in particular, see PIV-2 — different bug.

### PIV-4 — Confirm the trigger context

```bash
# Look for the request that triggered the orchestrator at the orphan run timestamp
# (replace timestamp from PIV-1)
npx vercel logs --json --since '2026-04-23T20:15:00Z' --until '2026-04-23T20:25:00Z' \
  --project prj_cJ5hZ4lRRoVq5MqDTyP2fXVkbXlt \
  --team team_OxRhkUfwTxqKBjnly5rddLg1 \
  | grep -E 'orchestrateSpreads|enqueueSpreadRecompute|spread.run.started'
```

**Expected outcomes:**
- (a) **No orchestrator logs at all.** Means the orchestrator was called via a worker that doesn't go through Vercel logs (likely the doc-extraction post-callback). Spec proceeds — Batch 1's instrumentation will surface what's happening.
- (b) **Orchestrator started but no error logged.** Either the function timed out at the platform level or threw silently. Batch 1 instruments around the suspect path.
- (c) **Visible exception or timeout.** Excellent — capture exact error and use it as the spec's smoking gun. Modify Batch 1's surgical fix to address the specific exception.

---

## Batch 1 — Fix stuck-spread orphan pattern

### Symptom

After a doc-extraction callback (or other trigger), `orchestrateSpreads` runs:
1. ✅ Inserts a `deal_spread_runs` row with `status='queued'`, `started_at` set
2. ✅ Calls `enqueueSpreadRecompute` per active doc — placeholders get upserted to `queued` status with bumped versions
3. ❌ Either (a) crashes, (b) times out, or (c) `enqueueSpreadRecompute` fails to insert the actual `deal_spread_jobs` row
4. ❌ `deal_spread_runs.status` never advances from `queued` to `running` (the orchestrator's last update step never runs)
5. ❌ No job row exists for the worker to claim
6. ❌ Spread placeholder rows sit in `queued` forever
7. ❌ Aegis observes stale `updated_at` and surfaces "Timeout observer" findings

### Root cause hypothesis (validated by PIV)

The orchestrator at `src/lib/spreads/orchestrateSpreads.ts` has **no error handling around the per-doc enqueue loop or the post-loop run update**. If `enqueueSpreadRecompute` throws (which it can, when the underlying Supabase update fails or the unique partial index race fires unexpectedly), the orchestrator unwinds without (a) marking the run as failed and (b) cleaning up placeholder rows that were upserted earlier in the loop.

Additionally, the placeholder upsert in `enqueueSpreadRecompute` happens BEFORE the job insert. If the job insert fails after the placeholder is created, you get exactly the observed state: placeholders in `queued`, no job to process them.

### Fix — three changes

**Change 1: Wrap orchestrator in try/catch with run-status reconciliation.**

File: `src/lib/spreads/orchestrateSpreads.ts`

After the existing happy-path code, wrap the per-doc enqueue loop and final status update in a try/catch:

```ts
// ── 4. Preflight passed — enqueue spreads ──────────────────────────
const snapshot = preflightResult.snapshot;
const warnings = preflightResult.warnings;

const { data: runRow } = await (sb as any)
  .from("deal_spread_runs")
  .insert({
    deal_id: dealId,
    bank_id: bankId,
    run_reason: trigger,
    status: "queued",
    computed_snapshot_hash: snapshot.computedHash,
    started_at: new Date().toISOString(),
    created_by: actorUserId ?? null,
  })
  .select("id")
  .maybeSingle();

const runId = runRow?.id ? String(runRow.id) : "unknown";

// ... existing writeEvent for spreads.preflight_passed ...

// ── NEW: wrap doc loop + status update + ledger event ──
try {
  // ... existing activeDocs query and enqueue loop ...
  // ... existing STANDARD enqueue ...
  // ... existing run status -> 'running' update ...
  // ... existing spreads.orchestration_started writeEvent ...
} catch (orchErr: any) {
  // Mark run as failed with the actual error so it's visible
  await (sb as any)
    .from("deal_spread_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      preflight_blockers: null,
    })
    .eq("id", runId)
    .in("status", ["queued", "running"]);

  // Reconcile orphan placeholders: any spread rows in 'queued' for this deal
  // that aren't backed by an active job should be marked 'error'
  const { data: activeJobs } = await (sb as any)
    .from("deal_spread_jobs")
    .select("id")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .in("status", ["QUEUED", "RUNNING"]);

  if (!activeJobs || activeJobs.length === 0) {
    await (sb as any)
      .from("deal_spreads")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error: `Orchestration failed: ${String(orchErr?.message ?? orchErr).slice(0, 200)}`,
        error_code: "ORCHESTRATION_FAILED",
        error_details_json: { runId, error: String(orchErr?.message ?? orchErr) },
        updated_at: new Date().toISOString(),
      })
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("status", "queued");
  }

  // Emit Aegis warning so the failure is visible in the cockpit
  const { writeSystemEvent } = await import("@/lib/aegis");
  writeSystemEvent({
    event_type: "error",
    severity: "error",
    source_system: "spreads_orchestrator",
    deal_id: dealId,
    bank_id: bankId,
    error_class: "transient",
    error_code: "SPREAD_ORCHESTRATION_FAILED",
    error_message: `Orchestration failed: ${String(orchErr?.message ?? orchErr).slice(0, 200)}`,
    payload: { runId, dealId, error: String(orchErr?.message ?? orchErr).slice(0, 500) },
  }).catch(() => {});

  // Re-throw so the caller sees the error (consistent with current contract)
  throw orchErr;
}
```

**Why throw at the end:** the orchestrator's current contract returns `OrchestrateResult` on success; throwing on catastrophic failure is the existing implicit contract. We don't want to swallow errors silently — but we DO want to clean up before they propagate. The Aegis warning + run status update + spread reconciliation all happen first, then re-throw.

**Change 2: Move placeholder upsert to AFTER job insert in `enqueueSpreadRecompute`.**

File: `src/lib/financialSpreads/enqueueSpreadRecompute.ts`

Currently the order is: placeholder upsert → existing job check → job insert. This means if the job insert fails, you have orphan placeholders. Fix: do the placeholder upsert ONLY after a successful job insert (or merge into existing).

Restructure as follows:

```ts
// ─────── Step 1: Resolve target job (existing or new) ───────
const { data: existingJob } = await (sb as any)
  .from("deal_spread_jobs")
  .select("id, requested_spread_types")
  .eq("deal_id", args.dealId)
  .eq("bank_id", args.bankId)
  .in("status", ["QUEUED", "RUNNING"])
  .maybeSingle();

let targetJobId: string;

if (existingJob) {
  // Merge into existing
  const existingTypes = (existingJob.requested_spread_types ?? []) as string[];
  const merged = uniq([...existingTypes, ...readyTypes]);
  if (merged.length > existingTypes.length) {
    const { error: updateErr } = await (sb as any)
      .from("deal_spread_jobs")
      .update({
        requested_spread_types: merged,
        meta: {
          ...(args.meta ?? {}),
          owner_type: args.ownerType ?? "DEAL",
          owner_entity_id: args.ownerEntityId ?? null,
          merged_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingJob.id);
    if (updateErr) {
      return { ok: false as const, error: `merge_failed: ${updateErr.message}` };
    }
  }
  targetJobId = String(existingJob.id);
} else {
  // Insert new job
  const payload = {
    deal_id: args.dealId,
    bank_id: args.bankId,
    source_document_id: args.sourceDocumentId ?? null,
    requested_spread_types: readyTypes,
    status: "QUEUED",
    next_run_at: new Date().toISOString(),
    meta: {
      ...(args.meta ?? {}),
      owner_type: args.ownerType ?? "DEAL",
      owner_entity_id: args.ownerEntityId ?? null,
    },
    updated_at: new Date().toISOString(),
  };

  const { data: insertData, error: insertErr } = await (sb as any)
    .from("deal_spread_jobs")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (insertErr) {
    if (insertErr.code === "23505") {
      // Race: another concurrent enqueue won. Find their job and merge.
      const { data: raceJob } = await (sb as any)
        .from("deal_spread_jobs")
        .select("id, requested_spread_types")
        .eq("deal_id", args.dealId)
        .eq("bank_id", args.bankId)
        .in("status", ["QUEUED", "RUNNING"])
        .maybeSingle();

      if (raceJob) {
        const merged = uniq([
          ...((raceJob.requested_spread_types ?? []) as string[]),
          ...readyTypes,
        ]);
        await (sb as any)
          .from("deal_spread_jobs")
          .update({
            requested_spread_types: merged,
            updated_at: new Date().toISOString(),
          })
          .eq("id", raceJob.id);
        targetJobId = String(raceJob.id);
      } else {
        return { ok: false as const, error: "race_no_job_found" };
      }
    } else {
      return { ok: false as const, error: insertErr.message };
    }
  } else {
    if (!insertData?.id) {
      return { ok: false as const, error: "insert_returned_no_id" };
    }
    targetJobId = String(insertData.id);
  }
}

// ─────── Step 2: NOW upsert placeholders (only if job exists) ───────
try {
  await Promise.all(
    readyTypes.map((t) => {
      const tpl = getSpreadTemplate(t as SpreadType)!;
      return (sb as any)
        .from("deal_spreads")
        .upsert(
          {
            deal_id: args.dealId,
            bank_id: args.bankId,
            spread_type: t,
            spread_version: tpl.version,
            owner_type: resolveOwnerType(t, args.ownerType),
            owner_entity_id: args.ownerEntityId ?? SENTINEL_UUID,
            status: "queued",
            inputs_hash: null,
            rendered_json: { /* same as today */ },
            // ... same fields as today ...
          },
          { onConflict: "deal_id,bank_id,spread_type,spread_version,owner_type,owner_entity_id" } as any,
        );
    }),
  );
} catch (placeholderErr) {
  console.warn("[enqueueSpreadRecompute] placeholder upsert failed:", placeholderErr);
  // Job exists; placeholders failing is recoverable on next worker tick
}

return existingJob 
  ? { ok: true as const, enqueued: false as const, merged: true as const, jobId: targetJobId }
  : { ok: true as const, enqueued: true as const, jobId: targetJobId };
```

**Net effect:** if `deal_spread_jobs` insert fails, you now know via the returned error code, and the function returns `{ ok: false, error: ... }` instead of silently leaving orphan placeholders. The orchestrator's new try/catch will cleanup if the function throws or returns failure.

**Change 3: Add a janitor sweep for existing orphans.**

File: NEW: `src/lib/spreads/janitor/cleanupOrphanSpreads.ts`

```ts
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Reconciles orphan spread placeholders that have no backing job.
 *
 * An orphan is a `deal_spreads` row in 'queued' status where:
 * - `started_at IS NULL` (never picked up)
 * - `updated_at < NOW() - INTERVAL '5 minutes'` (not recently re-enqueued)
 * - No `deal_spread_jobs` row exists in QUEUED/RUNNING for the deal
 *
 * Marks orphans as 'error' with code ORPHANED_BY_FAILED_ORCHESTRATION.
 *
 * Idempotent and safe to run from a cron tick.
 */
export async function cleanupOrphanSpreads(): Promise<{
  ok: boolean;
  cleaned: number;
  error?: string;
}> {
  const sb = supabaseAdmin();

  try {
    // Find candidate orphans
    const { data: orphans, error } = await (sb as any).rpc("find_orphan_spreads", {
      stale_threshold_minutes: 5,
    });

    if (error) return { ok: false, cleaned: 0, error: error.message };
    if (!orphans || orphans.length === 0) return { ok: true, cleaned: 0 };

    // Mark them as error
    const ids = orphans.map((o: any) => o.id);
    await (sb as any)
      .from("deal_spreads")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error: "Orphaned by failed orchestration; no backing job found",
        error_code: "ORPHANED_BY_FAILED_ORCHESTRATION",
        updated_at: new Date().toISOString(),
      })
      .in("id", ids);

    return { ok: true, cleaned: orphans.length };
  } catch (e: any) {
    return { ok: false, cleaned: 0, error: e?.message ?? "unknown" };
  }
}
```

And the SQL function (DDL migration):

```sql
CREATE OR REPLACE FUNCTION find_orphan_spreads(
  stale_threshold_minutes INTEGER DEFAULT 5
)
RETURNS TABLE(id UUID, deal_id UUID, spread_type TEXT) AS $$
  SELECT s.id, s.deal_id, s.spread_type
  FROM deal_spreads s
  WHERE s.status = 'queued'
    AND s.started_at IS NULL
    AND s.updated_at < NOW() - (stale_threshold_minutes || ' minutes')::interval
    AND NOT EXISTS (
      SELECT 1 FROM deal_spread_jobs j
      WHERE j.deal_id = s.deal_id
        AND j.bank_id = s.bank_id
        AND j.status IN ('QUEUED', 'RUNNING')
    );
$$ LANGUAGE sql STABLE;
```

Wire into the existing worker tick at `src/app/api/jobs/worker/tick/route.ts`. Add a new branch that runs `cleanupOrphanSpreads()` periodically — call it once per tick when `type === 'ALL'`.

### Tests for Batch 1

- Unit test for `cleanupOrphanSpreads`: setup a deal with a queued spread + no job → expect 1 cleaned, status becomes `error`.
- Unit test for the orchestrator catch: mock `enqueueSpreadRecompute` to throw → expect run row updated to `failed`, expect spreads cleaned up, expect Aegis event written.
- Unit test for `enqueueSpreadRecompute` job-first ordering: mock job insert to fail → expect no placeholders created.

### Verification (V-1)

After deploy:
1. **Manual reproduction:** find a deal in `queued` orphan state OR force a new one by submitting a doc and watching the orphan get cleaned within 1 tick interval (~30 sec).
2. **Confirm cleanup:** `SELECT status FROM deal_spreads WHERE id = '<orphan>'` returns `error` not `queued` after the next worker tick.
3. **Confirm new orchestration is healthy:** trigger a new spread orchestration; confirm the `deal_spread_runs` row reaches `succeeded` or `failed` (not stuck at `queued`).

### Rollback

Single-commit revert. Cleaned-up `error` rows can stay as-is (cosmetic; future re-enqueue replaces them). If reverting:
```sql
-- Restore stuck rows if needed (rare)
UPDATE deal_spreads SET status = 'queued', error = null, error_code = null
WHERE error_code = 'ORPHANED_BY_FAILED_ORCHESTRATION' AND status = 'error';
```

---

## Batch 2 — Ownership entity display_name garbage (D1 closure)

### Symptom

`ownership_entities.display_name` for the personal entity on `e505cd1c-...` is:

```
"MICHAEL NEWMARK\nTaxpayer address"
```

The `\nTaxpayer address` is OCR/extraction garbage from a PDF label that bled into the name field. This makes the cockpit show ugly headers, breaks downstream entity resolution, and signals broken extraction.

### Root cause hypothesis

The classifier or entity-resolution pipeline (somewhere in `src/lib/extractors/` or `src/lib/classifier/`) takes the raw extracted name from a PFS or tax return and writes it to `ownership_entities.display_name` without sanitization. The `\n` survives because PDFs encode text positions sometimes with literal newlines, and the extractor's name field captured the PDF token "MICHAEL NEWMARK" plus the next-line label "Taxpayer address" as one continuous string.

### Fix — two changes

**Change 1: Sanitize at write time**

File: `src/lib/extractors/personalEntityResolver.ts` (or wherever the entity insert happens — find via grep `from("ownership_entities")` then `insert(`).

Add a sanitization function:

```ts
function sanitizeEntityName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Strip everything after a newline (label bleed pattern)
  const firstLine = raw.split(/\r?\n/)[0]!.trim();
  // Strip common label suffixes
  const labelPatterns = [
    /\s+(taxpayer|spouse|filer|name|address|ssn|date)\b.*$/i,
    /\s+(date of birth|dob|tax id)\b.*$/i,
  ];
  let cleaned = firstLine;
  for (const pat of labelPatterns) {
    cleaned = cleaned.replace(pat, "");
  }
  // Collapse internal whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  // Reject if too short or empty after cleaning
  if (cleaned.length < 2) return null;
  return cleaned;
}
```

Apply on every `display_name` write/upsert in this file. If the sanitized result is `null`, skip the entity creation (or write a placeholder like `Unnamed Entity`); don't write garbage.

**Change 2: One-shot backfill migration**

```sql
-- Migration: sanitize_ownership_entity_display_names
UPDATE ownership_entities
SET display_name = TRIM(SPLIT_PART(display_name, E'\n', 1)),
    updated_at = NOW()
WHERE display_name LIKE E'%\n%'
  OR display_name ~* 'taxpayer|spouse|filer'
  OR display_name LIKE '% address%';
```

Run as a one-shot — sanitizes all existing rows. Idempotent.

### Tests for Batch 2

- Unit test for `sanitizeEntityName`:
  - `"MICHAEL NEWMARK\nTaxpayer address"` → `"MICHAEL NEWMARK"`
  - `"Jane Doe Spouse"` → `"Jane Doe"`
  - `"  John   Smith  "` → `"John Smith"`
  - `"\n"` → `null`
  - `null` → `null`

### Verification (V-2)

```sql
-- After migration runs
SELECT COUNT(*) FROM ownership_entities WHERE display_name LIKE E'%\n%';
-- Expected: 0

SELECT id, display_name FROM ownership_entities 
WHERE deal_id = 'e505cd1c-86b4-4d73-88e3-bc71ef342d94';
-- Expected: display_name = "MICHAEL NEWMARK" (no garbage)
```

Then in the cockpit: borrower name section should show clean.

### Rollback

Migration is one-way (you've stripped data). If something genuinely useful was after the newline (unlikely — it was always labels), you'd need to re-extract. Risk is very low.

---

## Batch 3 — Readiness panel honest reporting

### Symptom

Cockpit Readiness panel shows "Spreads: Complete" even when 2 of 6 spread rows are stuck in `queued`.

### Root cause hypothesis

The readiness check at `src/lib/deals/readiness.ts` (or wherever `recomputeDealReady` lives) likely counts `deal_spreads` rows by deal_id without filtering for terminal states, OR only checks DEAL-owner spreads.

### Fix

Find the spreads-readiness logic. Update it to require:
- Every spread row that exists for the deal has `status IN ('ready', 'error', 'failed')` (terminal)
- If ANY spread is in `queued` or `generating` for more than 5 minutes, readiness for that category is `warning` not `complete`
- Surface category breakdown: e.g. "5/6 spreads ready, 1 stuck (PERSONAL_FINANCIAL_STATEMENT)"

### Verification (V-3)

Cockpit Readiness panel for a deal in the orphan-spread state should show:
- "Spreads: Warning (1 stuck)" instead of "Spreads: Complete"

After Batch 1 cleans up the orphan, Readiness panel updates to "Spreads: Complete (5 ready, 1 error)" or similar honest status.

---

## Batch 4 — Document the buddy-core-worker outbox forwarder dead path

### Discovery

While diagnosing the spread issue, I discovered that `services/buddy-core-worker/src/index.ts` ALSO speaks the wrong protocol to deployed Pulse MCP — same bug as the in-process fastlane (which FASTLANE-RETIRE addresses):

- Calls `pulseCall("buddy_event_ingest", {...})` — tool doesn't exist
- POSTs to `${PULSE_MCP_URL}/call` with `{tool, input}` body — wrong endpoint AND wrong body shape
- Sends BOTH `Authorization: Bearer` and `x-pulse-mcp-key` headers — neither auth pattern matches deployed Pulse's `tools/call` JSON-RPC contract

This means the Cloud Run worker's outbox forwarder has NEVER successfully delivered an event to Pulse since it was deployed. Outbox rows accumulate; `delivered_at` is presumably always null or always set via a different path I haven't traced.

### What this spec does NOT do

Fix it. The fix would mirror OMEGA-REPAIR rev 3.3:
- Replace `${PULSE_MCP_URL}/call` with `${PULSE_MCP_URL}/`
- Replace `{tool, input}` body with JSON-RPC `{jsonrpc, id, method: "tools/call", params: {name, arguments}}`
- Replace tool name `buddy_event_ingest` with `buddy_ledger_write` (or whatever `tools/list` confirms)
- Map field names to match the deployed schema (Buddy outbox event → Pulse `buddy_ledger_write` schema)

That's a separate spec — call it `BUDDY-CORE-WORKER-WIRE-REPAIR` — because:
1. It requires `tools/list` audit against deployed Pulse first (PIV)
2. The worker is in a separate repo deployment unit with its own release cycle
3. It needs Cloud Run env var verification (BUDDY_DB_URL, PULSE_MCP_URL, PULSE_MCP_KEY)
4. Test pack run is currently blocked on the spread orphan, not on outbox delivery

### What to do now

Add a TODO comment at the top of `services/buddy-core-worker/src/index.ts`:

```ts
/**
 * TODO(BUDDY-CORE-WORKER-WIRE-REPAIR, 2026-04-23):
 * The pulseCall function below speaks the wrong wire protocol to deployed
 * Pulse MCP. Same root cause as OMEGA-REPAIR rev 3.3 (which fixed the
 * Next.js Omega client) and FASTLANE-RETIRE (which deletes the in-process
 * fastlane).
 *
 * Wrong:
 *   POST ${PULSE_MCP_URL}/call with {tool, input} and Bearer auth
 * Right:
 *   POST ${PULSE_MCP_URL}/  with JSON-RPC {jsonrpc, id, method: "tools/call",
 *   params: {name: "buddy_ledger_write", arguments: {...}}}  and x-pulse-mcp-key auth
 *
 * The worker has been silently failing every event delivery since deploy.
 * Outbox rows accumulate. Fix requires:
 *   1. Audit deployed tools/list to confirm buddy_ledger_write schema
 *   2. Mirror OMEGA-REPAIR's wire fix in pulseCall + heartbeatTick + forwardEvent
 *   3. Field-map buddy_outbox_events row → buddy_ledger_write input
 *   4. Verify Cloud Run env vars (PULSE_MCP_URL, PULSE_MCP_KEY)
 *
 * See specs/omega-repair/SPEC.md rev 3.3 for the wire fix template.
 */
```

This is a 1-line file change. No code modification. Surfaces the issue in the codebase so the next person who reads this file understands why metrics show 0 deliveries.

---

## Commit strategy

Three Git commits, in this order:

1. **`feat(spreads): fix orphan placeholders + janitor cleanup + orchestrator catch (Batch 1)`**
   - Includes all of Batch 1 changes
   - Includes the `find_orphan_spreads` migration
   - Test it FIRST on the test deal — confirm orphans get cleaned

2. **`feat(extractors): sanitize ownership_entities.display_name + backfill (Batch 2)`**
   - Includes the sanitizer
   - Includes the backfill migration
   - Test it on test deal — confirm "MICHAEL NEWMARK" is clean

3. **`feat(readiness): honest spread status counting (Batch 3)`**
   - Updates the readiness logic
   - Test it visually in cockpit

4. **`docs(buddy-core-worker): TODO for BUDDY-CORE-WORKER-WIRE-REPAIR (Batch 4)`**
   - Single-file doc-only commit
   - No tests needed

Submit as 4 separate PRs OR one combined PR with 4 commits. Whichever is easier for review. Recommend separate PRs so revert is independent if any one batch surfaces issues.

---

## Outcomes table

| Outcome | What it looks like | Action |
|---|---|---|
| **A. Full success** | After all 4 batches deployed: orphan cleaned, name sanitized, readiness honest, TODO present | Done. Update roadmap with completion. |
| **B. Batch 1 surfaces unexpected exception** | Orchestrator catch fires with a real error message visible in Aegis | Investigate the actual error. Likely Supabase constraint or extraction issue. May need follow-up spec. |
| **C. Batch 1 doesn't reproduce** | Orphan never recurs after 5 minutes of testing | Either issue is fixed elsewhere OR our hypothesis was wrong. Ship Batches 2-4 anyway, document with findings. |
| **D. Batch 3 reveals readiness logic is more entangled than estimated** | The fix touches 5+ files | Stop Batch 3, leave for follow-up. Ship Batches 1, 2, 4. |
| **E. Batch 2 backfill migration affects > 100 rows** | Many entities had garbage names | Spot check 5 random rows for correctness BEFORE running migration in production. |

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Janitor sweep marks legitimate fast-running queued spreads as error | Low | 5-minute threshold gives plenty of headroom — most real spreads finish in seconds |
| Orchestrator catch swallows an error type we should NOT recover from | Low | Re-throws after cleanup, so caller still sees the error; only the cleanup is silent |
| Sanitizer over-trims a legitimate name like "Smith Address LLC" | Very low | The label patterns are specific (taxpayer/spouse/filer/etc); test list covers boundary cases |
| Readiness fix breaks deal acceptance gates downstream | Medium | Batch 3 only changes the UI label, not any gating logic. If gating logic also reads spread status, audit those callers before changing the readiness function. |
| Worker TODO comment is read as actionable and someone fixes it without doing the wire-repair PIV | Low | TODO references the spec name explicitly; reviewer will check |

---

## Build principles emerging from this

> **(8) Multi-step state mutations need a transaction or a janitor.** When a workflow upserts placeholder rows BEFORE inserting the job that will process them, a failure between the two steps leaves orphan placeholders. Either wrap both in a transaction (when possible) OR have a janitor sweep that detects and resolves orphans. The spread orchestration left placeholders without jobs because steps 1 and 2 weren't atomic. (STUCK-SPREADS, 2026-04-23)

> **(9) Silent error paths in orchestration produce phantom UIs.** When an orchestration function can crash without updating its run-status row, the UI shows "queued" forever. Every orchestrator must have a final `try/catch` that marks the run as failed AND emits an Aegis event for visibility. The spread orchestrator violated this: a mid-loop exception left the run in `queued` indefinitely. (STUCK-SPREADS, 2026-04-23)

> **(10) Readiness percentages must reflect the worst-case spread state, not the best-case.** A "Spreads: Complete" status while two spreads are stuck in queue is not a presentation bug — it's a correctness bug that hides real failures. Readiness should always surface the most pessimistic terminal state of any input it depends on. (STUCK-SPREADS, 2026-04-23)

---

## Hand-off

Execute Batch 1 first. Do NOT begin Batch 2 until Batch 1 is verified working. PIV-0 through PIV-4 are mandatory before Batch 1 commits — confirm reality before code change.

If any PIV fails, stop and surface — the spec's hypothesis was wrong, and I'd rather rewrite than ship fiction.

If Batch 1 ships clean, Batch 2 is independent and can proceed immediately.

Batches 3 and 4 can be done after Batches 1 + 2 are verified.

Total target: 4 commits to main, 3 PRs (or 1 combined PR with 4 commits). All landing on top of current `main` HEAD `bd8216b0`.
