# T-08 — Governance Writer-Existence Audit (spec)

**Status:** Ready for Claude Code execution
**Authored:** 2026-04-20
**Supersedes:** T-08 section in `specs/phase-84-audit-remediation.md` (v2 smoke-test framing)
**Ticket type:** Audit-only conversion (matches T-03 + T-05 pattern)

---

## Why this exists

The v2 spec framed T-08 as "infrastructure shipped but never exercised live → run a smoke script." T-08 pre-work showed this framing was wrong. Of 6 governance tables, only 1 (`deal_decisions`) has a writer reachable from a normal banker workflow, and that writer is gated on a reconciliation status that 0 deals currently have. The other 5 tables have no writer in the repo, an unreachable writer, or an orphaned schema.

Inserting synthetic rows to satisfy "≥ 1 row in each table" would pollute the truth source: every future audit, dashboard, ML training run, or compliance review would have to remember to filter out smoke fixtures. We don't ship band-aids.

T-08 converts to an audit ticket. Output: a writer-existence map for each governance table, plus 5–6 concrete Phase 84.1 ticket stubs that can each be executed independently to make a specific table genuinely live.

---

## Pre-work findings already verified by Opus (do not re-verify; cite in audit doc)

### Empty governance tables (as of 2026-04-20 15:30 UTC)
```
agent_approval_events:        0 rows
agent_skill_evolutions:       0 rows
borrower_request_campaigns:   0 rows
canonical_action_executions:  0 rows
deal_decisions:               0 rows
draft_borrower_requests:      0 rows
```

### Reconciliation gate is the immediate blocker for `deal_decisions`
9 test deals queried via `is_test = true`:
- 8 have `deal_reconciliation_results.overall_status = NULL` (never run)
- 1 (`0279ed32-...` = ChatGPT Fix 15) has `overall_status = 'CONFLICTS'`
- 0 deals across all banks have `CLEAN` or `FLAGS`

`actions/route.ts:approve` returns 422 for both NULL and `CONFLICTS`. No deal can pass the gate today. This is its own Phase 84.1 ticket (T-08-A).

### Spec endpoint paths verified against repo
```
✓ FOUND   src/app/api/deals/[dealId]/actions/route.ts
✗ MISSING src/app/api/admin/agent-approvals/route.ts
✓ FOUND   src/app/api/deals/[dealId]/actions/execute/route.ts
✗ MISSING src/app/api/deals/[dealId]/draft-borrower-request/route.ts
✓ FOUND   src/app/api/deals/[dealId]/borrower-request/route.ts
            (writes borrower_invites + borrower_request_packs, NOT draft_borrower_requests)
```

### Schemas captured (informs writer requirements)
Full column list in section "Per-table writer requirements" below.

---

## Execution plan for Claude Code

### Step 0 — Pull and confirm baseline
```bash
git pull
```
Confirm working tree clean. Confirm origin/main tip matches the most recent T-07 commit (`f498e4d3` per T-07 closure).

### Step 1 — Per-table writer/reader grep
Run **once per table**, in your shell terminal (NOT the Supabase SQL editor — that bug bit T-05 + T-08 pre-work already):

```bash
TABLE=deal_decisions

echo "=== Writers for $TABLE ==="
grep -rn "from(\"$TABLE\")\.insert\|from(\"$TABLE\")\.update\|from(\"$TABLE\")\.upsert\|INSERT INTO $TABLE\|INSERT INTO public\.$TABLE\|UPDATE $TABLE\|UPDATE public\.$TABLE" \
  src/ supabase/migrations/ 2>/dev/null \
  | grep -v __tests__ | grep -v ".test." | grep -v "/archive/"

echo "=== Readers for $TABLE ==="
grep -rn "from(\"$TABLE\")\.select\|FROM $TABLE\|FROM public\.$TABLE\|JOIN $TABLE\|JOIN public\.$TABLE" \
  src/ 2>/dev/null \
  | grep -v __tests__ | grep -v ".test." | grep -v "/archive/" | head -40
```

Repeat for each:
- `deal_decisions`
- `agent_approval_events`
- `canonical_action_executions`
- `draft_borrower_requests`
- `agent_skill_evolutions`
- `borrower_request_campaigns`

Capture full grep output for each table. Don't filter results — the audit doc shows all hits and classifies them.

### Step 2 — RPC writer check
Some writers are RPCs not direct inserts. Check Postgres for any function that inserts into governance tables:

```sql
SELECT 
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  CASE 
    WHEN pg_get_functiondef(p.oid) ~* 'insert into (public\.)?deal_decisions' THEN 'deal_decisions'
    WHEN pg_get_functiondef(p.oid) ~* 'insert into (public\.)?agent_approval_events' THEN 'agent_approval_events'
    WHEN pg_get_functiondef(p.oid) ~* 'insert into (public\.)?canonical_action_executions' THEN 'canonical_action_executions'
    WHEN pg_get_functiondef(p.oid) ~* 'insert into (public\.)?draft_borrower_requests' THEN 'draft_borrower_requests'
    WHEN pg_get_functiondef(p.oid) ~* 'insert into (public\.)?agent_skill_evolutions' THEN 'agent_skill_evolutions'
    WHEN pg_get_functiondef(p.oid) ~* 'insert into (public\.)?borrower_request_campaigns' THEN 'borrower_request_campaigns'
    ELSE NULL
  END as writes_table
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) ~* 'insert into (public\.)?(deal_decisions|agent_approval_events|canonical_action_executions|draft_borrower_requests|agent_skill_evolutions|borrower_request_campaigns)'
ORDER BY function_name;
```

Capture full output. RPC writers count as writers — note them in the audit doc next to the code-path writers.

### Step 3 — Reconciliation gate analysis
Pre-work showed 9 test deals are blocked. Confirm whether ANY deal has ever passed the gate:

```sql
-- Distribution across all deals (test + real)
SELECT 
  d.is_test,
  COUNT(*) AS total_deals,
  COUNT(*) FILTER (WHERE drr.overall_status IS NULL) AS never_run,
  COUNT(*) FILTER (WHERE drr.overall_status = 'CLEAN') AS clean,
  COUNT(*) FILTER (WHERE drr.overall_status = 'FLAGS') AS flags,
  COUNT(*) FILTER (WHERE drr.overall_status = 'CONFLICTS') AS conflicts
FROM deals d
LEFT JOIN deal_reconciliation_results drr ON drr.deal_id = d.id
GROUP BY d.is_test
ORDER BY d.is_test;

-- Look at any reconciliation runs that DID complete to understand what state they produced
SELECT 
  overall_status,
  COUNT(*) AS cnt,
  MIN(created_at) AS earliest,
  MAX(created_at) AS latest
FROM deal_reconciliation_results
GROUP BY overall_status
ORDER BY cnt DESC;
```

Capture both outputs. If `CLEAN` count is 0 across all deals ever, that's the headline finding for T-08-A.

### Step 4 — Phase archaeology
Find when each governance table's schema landed and which phase intended to write it. For each table:

```bash
TABLE=deal_decisions

# Migration that created the table
grep -rln "CREATE TABLE.*$TABLE\b\|CREATE TABLE IF NOT EXISTS.*$TABLE\b" supabase/migrations/ 2>/dev/null | head -3

# AAR or spec files referencing the table
grep -rln "$TABLE" docs/archive/ 2>/dev/null | head -5
```

Repeat for each table. Capture the migration filename + any AAR hits.

If you find a relevant AAR (e.g. `AAR_PHASE_75_*.md`), open it briefly — note in the audit doc which phase originally scoped the writer. Don't re-summarize the whole AAR; one sentence per table is enough ("Schema added by Phase 75 governance group; writer was scoped for Phase 76 but never shipped").

### Step 5 — Write the audit doc
**Pre-staged skeleton at `docs/archive/phase-84/T08-governance-writers-audit.md`** — already committed by Opus. Open it and fill in the marked sections. Do NOT restructure; the format matters for cross-ticket consistency.

### Step 6 — Single combined commit
One commit, message: `Phase 84 T-08 — convert to audit-only (writer-existence map + Phase 84.1 stubs)`. Contents:
1. Filled-in audit doc at `docs/archive/phase-84/T08-governance-writers-audit.md`
2. AAR at `docs/archive/phase-84/AAR_PHASE_84_T08.md`
3. Spec correction in `specs/phase-84-audit-remediation.md` T-08 section: replace the "Implementation" block with a brief "Converted to audit-only — see `docs/archive/phase-84/T08-governance-writers-audit.md` for findings + Phase 84.1 ticket stubs" pointer

### Step 7 — Completion event
```sql
INSERT INTO buddy_system_events (event_type, severity, source_system, resolution_status, payload)
VALUES ('deploy', 'info', 'phase_84', 'resolved',
  jsonb_build_object(
    'kind', 'phase.84.t08.completed',
    'ticket_type', 'audit_only',
    'spec_deviation', 'v2 framed T-08 as smoke test; pre-work showed governance writers do not exist or are unreachable. Synthetic fixture inserts rejected. Generated Phase 84.1 ticket stubs instead.',
    'tables_with_reachable_writer', <fill_from_audit>,
    'tables_missing_writer', <fill_from_audit>,
    'reconciliation_gate_blocking', true,
    'reconciliation_clean_deals_ever', <fill_from_step_3>,
    'phase_84_1_tickets_generated', <fill_count>
  ))
RETURNING id;
```
Replace `<fill_*>` placeholders with actual numbers from the audit. Capture the returned `id`.

### Step 8 — Verify on origin/main + post back
- Audit doc blob SHA via GitHub API at `ref: main`
- AAR blob SHA
- Spec correction commit SHA  
- Completion event id

---

## AAR template (use this verbatim structure)

`docs/archive/phase-84/AAR_PHASE_84_T08.md`

```markdown
# AAR — Phase 84 T-08 — Governance Writer-Existence Audit

**Date:** 2026-04-20
**Ticket:** T-08 (Wave 3 — Restore advisory + governance, converted to audit-only)
**Scope:** Audit existence and reachability of writers for 6 governance tables
**Commit:** <single combined commit SHA>
**Audit doc:** docs/archive/phase-84/T08-governance-writers-audit.md
**Completion event:** buddy_system_events id <id>

## 1. Why this converted to audit-only

v2 spec framed T-08 as a smoke test against assumed-existing writers. Pre-work proved:
1. 5 of 6 governance tables have no writer in the repo OR have writers unreachable from any banker workflow
2. The 1 table with a working writer (deal_decisions) is gated on reconciliation status; 0 deals across all banks currently meet the gate
3. Spec endpoint paths assumed by v2 don't all exist (admin/agent-approvals missing; draft-borrower-request misnamed as borrower-request which is a different system)

Synthetic fixture inserts were considered (Option B in the planning conversation) and rejected: future queries against governance tables would always need to filter `WHERE source != 'phase_84_t08_smoke'`. Polluting the truth source to satisfy a checklist criterion is the kind of band-aid we don't ship.

## 2. Pre-work findings (verbatim)

### Governance table state
<paste the empty-table query output verbatim>

### Reconciliation gate
<paste the reconciliation distribution query output verbatim>

### Endpoint inventory
<paste the FOUND/MISSING list>

## 3. Writer-existence map summary

<one-line per table — full detail lives in T08-governance-writers-audit.md>

| Table | Writer status | Reachable today | Phase 84.1 ticket |
|---|---|---|---|
| deal_decisions | ✓ exists | ✗ blocked by recon gate | T-08-A |
| agent_approval_events | <fill> | <fill> | T-08-B |
| canonical_action_executions | <fill> | <fill> | T-08-C |
| draft_borrower_requests | <fill> | <fill> | T-08-D |
| agent_skill_evolutions | <fill> | <fill> | T-08-E |
| borrower_request_campaigns | <fill> | <fill> | T-08-F |

## 4. Phase 84.1 tickets generated

<numbered list with one-paragraph summary of each ticket — full spec lives in audit doc>

1. **T-08-A** — Run reconciliation to CLEAN on a canary deal (unblocks deal_decisions)
2. **T-08-B** — Build agent_approval_events writer
3. **T-08-C** — Build canonical_action_executions writer
4. **T-08-D** — Build draft_borrower_requests AI-draft pipeline
5. **T-08-E** — Decide: build or retire agent_skill_evolutions
6. **T-08-F** — Build borrower_request_campaigns writer (downstream of T-08-C)

## 5. Spec deviations

1. **Full ticket converted to audit-only.** v2 prescribed a smoke script; pre-work showed there are no writers to smoke. Same conversion pattern applied to T-03 and T-05.
2. **Synthetic fixture insert path rejected.** Inserting marker rows would have satisfied v2's literal "≥ 1 row in each table" criterion but polluted the governance truth source. Option C chosen over Option B for long-term success.
3. **v2 endpoint paths were speculative.** `/api/admin/agent-approvals` doesn't exist; `/api/deals/[dealId]/draft-borrower-request` doesn't exist; the actual `borrower-request` route writes to a different system (Phase 73 portal links, not Phase 75 AI-draft governance).
4. **Reconciliation gate is the systemic unblocker.** Discovering this is the single most actionable output of T-08; produced T-08-A as the highest-leverage Phase 84.1 ticket.

## 6. Phase 84.1 backlog additions

All 6 T-08-A through T-08-F tickets queued. Detailed scope in audit doc.

Plus a meta-finding worth tracking separately:
- **Wave 3 governance work is structurally incomplete.** Phases 72–77 added schemas + adapter layers but the actual write paths were never finished. Phase 84.1 should consider whether to (a) finish each writer individually, (b) deprecate orphan schemas, or (c) consolidate the governance layer into a single coherent design before further build.
```

---

## Per-table writer requirements (reference for the audit doc)

Use these schemas as the "what would a writer have to populate" reference when classifying writer existence + scoping Phase 84.1 tickets.

### `deal_decisions` (writer EXISTS, gated)
```
id                     uuid PK     default gen_random_uuid()
deal_id                uuid NOT NULL
bank_id                uuid NOT NULL
decision               text NOT NULL          -- 'approved' | 'declined' | 'escalate'
decided_by             text NOT NULL          -- Clerk userId
decided_at             timestamptz NOT NULL   default now()
reconciliation_status  text NULLABLE          -- 'CLEAN' | 'FLAGS' (CONFLICTS blocks before insert)
evidence               jsonb NOT NULL         default '{}'
notes                  text NULLABLE
created_at             timestamptz NOT NULL   default now()
```
Writer: `src/app/api/deals/[dealId]/actions/route.ts:182,198,212`. Gated on `deal_reconciliation_results.overall_status NOT IN (NULL, 'CONFLICTS')`.

### `agent_approval_events` (writer existence: TBD by grep)
```
id              uuid PK     default gen_random_uuid()
entity_type     text NOT NULL          -- what kind of entity is being approved
entity_id       uuid NOT NULL          -- pointer to that entity
decision        text NOT NULL          -- 'approved' | 'rejected' | etc
decided_by      text NOT NULL          -- Clerk userId
decided_at      timestamptz NOT NULL   default now()
snapshot_json   jsonb NOT NULL         -- snapshot of entity at decision time (audit trail)
reason          text NULLABLE
created_at      timestamptz NOT NULL   default now()
```
Intent: human-in-the-loop approval log for AI-proposed actions. Polymorphic (`entity_type` + `entity_id`).

### `canonical_action_executions` (writer existence: TBD by grep)
```
id                  uuid PK     default gen_random_uuid()
deal_id             uuid NOT NULL
bank_id             uuid NOT NULL
action_code         text NOT NULL          -- canonical action identifier
source              text NOT NULL          default 'canonical_action'
target_system       text NOT NULL          -- which downstream system executed it
target_record_id    text NULLABLE          -- id in target system
execution_status    text NOT NULL          -- 'pending' | 'succeeded' | 'failed' | etc
executed_by         text NOT NULL          -- Clerk userId or system actor
actor_type          text NOT NULL          -- 'human' | 'agent' | 'system'
error_text          text NULLABLE
created_at          timestamptz NOT NULL   default now()
```
Intent: every canonical action that gets executed (manually or by agent) leaves a trail.

### `draft_borrower_requests` (writer existence: TBD; almost certainly missing)
```
id                       uuid PK     default gen_random_uuid()
deal_id                  uuid NOT NULL
condition_id             uuid NULLABLE          -- FK to a deal condition
missing_document_type    text NOT NULL
draft_subject            text NOT NULL          -- AI-drafted email subject
draft_message            text NOT NULL          -- AI-drafted email body
evidence                 jsonb NOT NULL         default '[]'
status                   text NOT NULL          default 'pending_approval'
approved_by              text NULLABLE
approved_at              timestamptz NULLABLE
rejected_by              text NULLABLE
rejected_at              timestamptz NULLABLE
rejection_reason         text NULLABLE
sent_at                  timestamptz NULLABLE
sent_via                 text NULLABLE          -- 'email' | 'sms' | etc
created_at               timestamptz NOT NULL   default now()
updated_at               timestamptz NOT NULL   default now()
approved_snapshot        jsonb NULLABLE         -- frozen content at approval
sent_snapshot            jsonb NULLABLE         -- frozen content at send
```
Intent: AI drafts a borrower request → human approves → system sends. Distinct from `borrower-request` route which creates portal upload links.

### `agent_skill_evolutions` (writer existence: TBD; possible orphan)
```
id                uuid PK     default gen_random_uuid()
agent_id          text NOT NULL
fact_key          text NOT NULL
document_type     text NOT NULL
source            text NOT NULL
context           text NOT NULL
proposed_change   jsonb NOT NULL
applied           boolean NOT NULL    default false
approved_by       text NULLABLE
approved_at       timestamptz NULLABLE
rejected          boolean NOT NULL    default false
rejected_by       text NULLABLE
rejected_at       timestamptz NULLABLE
created_at        timestamptz NOT NULL   default now()
```
Intent: agent self-improvement loop. May be a Phase 72/73 holdover that's no longer in product scope.

### `borrower_request_campaigns` (writer existence: TBD; downstream of canonical_action_executions)
```
id                       uuid PK     default gen_random_uuid()
deal_id                  uuid NOT NULL
bank_id                  uuid NOT NULL
canonical_execution_id   uuid NULLABLE          -- FK back to canonical_action_executions
action_code              text NOT NULL
status                   text NOT NULL
borrower_name            text NULLABLE
borrower_phone           text NULLABLE
borrower_email           text NULLABLE
portal_link_id           bigint NULLABLE
last_sent_at             timestamptz NULLABLE
completed_at             timestamptz NULLABLE
created_by               text NOT NULL
created_at               timestamptz NOT NULL   default now()
```
Intent: track multi-step borrower outreach campaigns (likely tied to T-08-C canonical_action_executions writer).

---

## Phase 84.1 ticket stub format (what to write into the audit doc)

For each Phase 84.1 ticket generated, the audit doc should include this format. Use it as a template — populate the bracketed sections from your grep findings:

```markdown
### T-08-X — <short title>

**Table affected:** <table_name>
**Status discovered:** <one of: writer exists but blocked / writer exists but unreachable / no writer found / orphaned schema>

**Findings from audit:**
- <bullet points from your grep + RPC search results>

**Required to make live:**
- <list of code paths that need to exist or be wired>
- <list of upstream prerequisites>
- <list of any schema gaps you noticed during writer scoping>

**Estimated scope:** <small / medium / large / multi-week feature>

**Out of scope for 84.1 if:** <conditions under which this should be deferred or canceled — e.g., product confirms feature deprecated>

**Acceptance criteria:**
- <specific, queryable criteria — e.g., "≥ 1 row in agent_approval_events sourced from a real human approval action (not synthetic)">

**Phase reference (from archaeology):** <which prior phase originally scoped this; e.g., "Phase 75 Governance Group">
```

---

## Execution boundary

Do not:
- Insert any synthetic rows into governance tables, even temporarily
- Modify reconciliation results or force any deal to CLEAN status
- Build any of the missing writers (those are Phase 84.1 work)
- Modify the actions/route.ts behavior to bypass the reconciliation gate
- Touch the `borrower-request` route to make it write to `draft_borrower_requests`
- Touch the actions/execute subroute (out of scope; investigate as part of T-08-C ticket spec only)

Do:
- Run all greps + SQL queries verbatim
- Capture full output (don't pre-filter)
- Classify every writer/reader hit honestly
- Flag any writer that exists but is gated/disabled by a feature flag (different ticket from "no writer")
- Note any schema field that has no obvious writer counterpart (e.g., if `approved_snapshot` is on the table but no code populates it, that's a finding worth tracking)

If the audit surfaces something that changes the conversion conclusion (e.g., you find a healthy writer for a table I assumed was empty, or a reconciliation result that already exists for some non-test deal that we missed), STOP and post the finding before proceeding. Don't quietly adjust the audit to match expectations.
