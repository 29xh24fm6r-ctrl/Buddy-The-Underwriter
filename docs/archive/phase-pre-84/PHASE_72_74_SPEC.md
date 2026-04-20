# Phase 72–74 — Workflow Visibility, Operator Control, and Output Contracts

## Status: SPEC COMPLETE — Ready for Implementation

## Nature: EXTENSION (not replacement)

---

## Core Principle

```
Buddy does not gain a new runtime.

Buddy gains visibility, structure, and governance
over the runtime it already has.
```

**Existing engines that MUST NOT be replaced:**
- `runMission()` — `src/lib/research/runMission.ts`
- `executeCanonicalAction()` — `src/core/actions/execution/executeCanonicalAction.ts`
- `AgentOrchestrator` — `src/lib/agents/orchestrator.ts`
- `getBuddyCanonicalState()` — `src/core/state/BuddyCanonicalStateAdapter.ts`

---

# Phase 72 — Workflow Registry + Operator Console

## 72A — Workflow Registry (STRICTLY NON-EXECUTABLE)

**Location:** `src/lib/agentWorkflows/registry.ts`

### HARD RULES

```
Registry MUST NOT:
- import execution code
- call execution code
- dispatch workflows
- reference Supabase client
```

### Schema

```ts
export type WorkflowDefinition = {
  code: string;                       // e.g. "research_bundle_generation"
  label: string;                      // Human-readable name
  description: string;                // What it does (audit-readable)
  sourceTable: string;                // DB table that stores runs
  sourceIdColumn: string;             // PK column name
  statusColumn: string;               // Column holding run status
  statusValues: readonly string[];    // Valid status enum
  costMetrics: {
    hasTokens: boolean;               // Whether table tracks token counts
    hasCostUsd: boolean;              // Whether table tracks USD cost
    tokenColumns?: { input: string; output: string };
    costColumn?: string;
    metricsJsonPath?: string;         // e.g. "metrics" for JSONB extraction
  };
  requiresCanonicalState: boolean;    // Must anchor to getBuddyCanonicalState()
  triggerType: "user" | "system" | "both";
  ownerSystem: string;                // e.g. "research", "extraction", "reconciliation", "lifecycle"
};
```

### Registry Entries (Initial)

| code | sourceTable | requiresCanonicalState |
|------|-------------|----------------------|
| `research_bundle_generation` | `buddy_research_missions` | true |
| `document_extraction` | `deal_extraction_runs` | false |
| `cross_doc_reconciliation` | `deal_reconciliation_results` | true |
| `canonical_action_execution` | `canonical_action_executions` | true |
| `borrower_request_campaign` | `borrower_request_campaigns` | true |
| `borrower_draft_request` | `draft_borrower_requests` | true |

### Guard Tests

File: `src/lib/agentWorkflows/__tests__/registryGuard.test.ts`

1. Registry file has ZERO non-type imports from execution code
2. No registry entry references `SupabaseClient`
3. Every `sourceTable` exists in known migration set
4. Every entry with `requiresCanonicalState: true` has a corresponding workflow that calls `getBuddyCanonicalState()`
5. Registry is a frozen object (cannot be mutated at runtime)

---

## 72B — Operator Console View (MANDATORY UNIFICATION)

**Decision: Postgres VIEW — no shadow table, no client joins.**

### Migration: `supabase/migrations/YYYYMMDD_agent_workflow_runs_view.sql`

```sql
CREATE OR REPLACE VIEW agent_workflow_runs AS

-- Research missions
SELECT
  id,
  deal_id,
  bank_id,
  'research_bundle_generation'::text AS workflow_code,
  status,
  created_at,
  (metrics->>'cost_estimate_usd')::numeric AS cost_usd,
  NULL::integer AS input_tokens,
  NULL::integer AS output_tokens,
  NULL::text AS model_used
FROM buddy_research_missions

UNION ALL

-- Document extraction runs
SELECT
  id,
  deal_id,
  NULL::uuid AS bank_id,
  'document_extraction'::text,
  status,
  created_at,
  (metrics->>'cost_estimate_usd')::numeric,
  (metrics->>'tokens_in')::integer,
  (metrics->>'tokens_out')::integer,
  NULL::text
FROM deal_extraction_runs

UNION ALL

-- Reconciliation results
SELECT
  id,
  deal_id,
  NULL::uuid AS bank_id,
  'cross_doc_reconciliation'::text,
  overall_status,
  created_at,
  NULL::numeric,
  NULL::integer,
  NULL::integer,
  NULL::text
FROM deal_reconciliation_results

UNION ALL

-- Canonical action executions
SELECT
  id,
  deal_id,
  bank_id,
  action_code,
  execution_status,
  created_at,
  NULL::numeric,
  NULL::integer,
  NULL::integer,
  NULL::text
FROM canonical_action_executions

UNION ALL

-- Borrower request campaigns
SELECT
  id,
  deal_id,
  bank_id,
  'borrower_request_campaign'::text,
  status,
  created_at,
  NULL::numeric,
  NULL::integer,
  NULL::integer,
  NULL::text
FROM borrower_request_campaigns

UNION ALL

-- Draft borrower requests
SELECT
  id,
  deal_id,
  NULL::uuid AS bank_id,
  'borrower_draft_request'::text,
  status,
  created_at,
  NULL::numeric,
  NULL::integer,
  NULL::integer,
  NULL::text
FROM draft_borrower_requests;
```

### TypeScript Types

File: `src/lib/agentWorkflows/types.ts`

```ts
export type AgentWorkflowRun = {
  id: string;
  deal_id: string;
  bank_id: string | null;
  workflow_code: string;
  status: string;
  created_at: string;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  model_used: string | null;
};
```

### API Route

`GET /api/ops/agent-runs`

- requireSuperAdmin
- Accepts query params: `deal_id`, `workflow_code`, `status`, `limit` (default 50)
- Returns `AgentWorkflowRun[]` from the VIEW
- Fail-safe: returns `[]` on error, never 500

### UI Route

`/ops/agents` — new page under existing ops dashboard

- Table view with columns: workflow, deal, status, cost, tokens, timestamp
- Filter by workflow_code and status
- Link to deal cockpit
- Refresh button (no polling)

---

## 72C — Cost Tracking Promotion

### Rule: Store BOTH tokens and USD

For tables that currently store cost in JSONB `metrics`, promote to top-level columns via migration:

**Migration:** `supabase/migrations/YYYYMMDD_promote_cost_columns.sql`

Tables to alter:
- `buddy_research_missions`: Add `cost_usd`, `input_tokens`, `output_tokens`, `model_used`
- `deal_extraction_runs`: Already has in `metrics` JSONB — add top-level `cost_usd`, `input_tokens`, `output_tokens`

**Backfill:** Extract from existing `metrics` JSONB into new columns (one-time UPDATE).

**Rule:**
```
Tokens = source of truth (durable)
USD = audit snapshot at time of execution (point-in-time)
```

---

# Phase 73 — Borrower Communication Governance

## 73A — Missing Items Follow-Up (Canonical State Anchor)

### CRITICAL RULE

All borrower follow-up workflows MUST derive missing items from canonical state:

```ts
const state = await getBuddyCanonicalState(dealId);
const blockers = state.blockers;
// Filter for document-related blockers
```

**NOT** by querying gap tables directly. Canonical state is the single source of truth.

## 73B — Approval Snapshot Columns

### Migration: `supabase/migrations/YYYYMMDD_approval_snapshots.sql`

Add immutable audit columns to `draft_borrower_requests`:

```sql
ALTER TABLE draft_borrower_requests
  ADD COLUMN IF NOT EXISTS approved_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS sent_snapshot JSONB;
```

**Semantics:**
- `approved_snapshot`: Frozen copy of `{ draft_subject, draft_message, evidence }` at approval time
- `sent_snapshot`: Frozen copy of exactly what was delivered to borrower

**Enforcement:** Application code MUST populate `approved_snapshot` when status transitions to `'approved'`, and `sent_snapshot` when status transitions to `'sent'`.

## 73C — Approval Events Table (SR 11-7 Compliance)

### Migration: `supabase/migrations/YYYYMMDD_agent_approval_events.sql`

```sql
CREATE TABLE IF NOT EXISTS agent_approval_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,         -- 'draft_borrower_request', 'borrower_campaign', etc.
  entity_id UUID NOT NULL,           -- FK to the entity being approved
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'revoked')),
  decided_by TEXT NOT NULL,          -- Clerk user ID
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_json JSONB NOT NULL,      -- Exact content at time of decision
  reason TEXT,                       -- Optional: rejection/revocation reason
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_approval_events_entity
  ON agent_approval_events(entity_type, entity_id);

CREATE INDEX idx_approval_events_decided_by
  ON agent_approval_events(decided_by);
```

### HARD RULE

```
No outbound borrower communication is permitted
without a corresponding agent_approval_events record
where decision = 'approved'.
```

**Enforcement:** The send path (email, portal notification, SMS) MUST query `agent_approval_events` and verify an approved record exists for the entity before dispatching. This is a **runtime check**, not just a status column check.

---

# Phase 74 — Output Contracts (Enforced)

## HARD RULE

```
No AI-generated content may persist to canonical tables
without passing its Zod output contract.
```

## 74A — Contract Registry

**Location:** `src/lib/agentWorkflows/contracts/`

One file per workflow output:

| File | Validates |
|------|-----------|
| `researchNarrative.contract.ts` | Research mission narrative sections |
| `borrowerDraft.contract.ts` | Draft borrower request content |
| `extractionOutput.contract.ts` | Extraction run structured output |
| `memoSection.contract.ts` | Credit memo narrative sections |

Each contract exports:

```ts
import { z } from "zod";

export const ResearchNarrativeContract = z.object({
  // schema
});

export type ResearchNarrativeOutput = z.infer<typeof ResearchNarrativeContract>;

export function validateResearchNarrative(data: unknown): {
  ok: boolean;
  data?: ResearchNarrativeOutput;
  errors?: z.ZodError;
  severity: "block" | "warn";
};
```

## 74B — Tiered Validation

**Decision: Tiered (block + warn)**

```ts
type ValidationResult = {
  ok: boolean;
  severity: "block" | "warn";
  errors?: z.ZodError;
};
```

### Behavior:

| Severity | Persistence | Status Column |
|----------|-------------|---------------|
| `block` | REJECTED — do not persist | `validation_status = 'failed'` |
| `warn` | PERSIST with flag | `validation_status = 'warning'` |
| (none) | PERSIST normally | `validation_status = 'clean'` |

### Critical vs Non-Critical:

- **Critical (block):** Missing required fields, wrong types, empty content where content expected
- **Non-critical (warn):** Content length anomalies, optional fields missing, formatting issues

---

# Phase 75 — Guard Layer

## REQUIRED — No phase ships without guards

### Guard Test Files

| File | Guards |
|------|--------|
| `src/lib/agentWorkflows/__tests__/registryGuard.test.ts` | Registry purity, no execution imports |
| `src/lib/agentWorkflows/__tests__/approvalGuard.test.ts` | No auto-send paths, approval event required |
| `src/lib/agentWorkflows/__tests__/contractGuard.test.ts` | Every workflow has a contract, contracts parse cleanly |
| `src/lib/agentWorkflows/__tests__/canonicalStateGuard.test.ts` | Workflows marked `requiresCanonicalState` actually call it |

### Example Guards

```ts
// registryGuard.test.ts
it("registry has zero execution imports", () => {
  const source = fs.readFileSync("src/lib/agentWorkflows/registry.ts", "utf8");
  expect(source).not.toMatch(/import.*from.*runMission/);
  expect(source).not.toMatch(/import.*from.*executeCanonicalAction/);
  expect(source).not.toMatch(/import.*from.*orchestrator/);
  expect(source).not.toMatch(/import.*from.*supabase/i);
});

// approvalGuard.test.ts
it("no workflow auto-sends borrower messages", () => {
  // Scan all files in borrower communication paths
  // Verify every send call is preceded by approval check
});

// contractGuard.test.ts
it("every registered workflow has a corresponding output contract", () => {
  // For each registry entry, verify contract file exists
});
```

---

# Decision Log (Answers to Open Questions)

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Registry execution-aware? | **NO** — pure data only | Prevents drift into dual runtime |
| 2 | Operator console unification? | **Postgres VIEW** | Single truth, zero duplication, aligns with ledger |
| 3 | Approval gate design? | **Status column + approval_events table** | SR 11-7 requires immutable approval record |
| 4 | Cost tracking? | **Store BOTH tokens and USD** | Tokens=durable, USD=audit snapshot |
| 5 | Voice system integration? | **DO NOT auto-trigger** — suggest draft only | Human-in-the-loop control |
| 6 | Output validation? | **Tiered (block + warn)** | Critical failures block, warnings persist with flag |
| 7 | Borrower audit trail? | **Store full snapshots** (approved + sent) | Exact content at each state transition |

---

# File Manifest

## New Files

| Path | Phase | Purpose |
|------|-------|---------|
| `src/lib/agentWorkflows/registry.ts` | 72A | Pure data workflow registry |
| `src/lib/agentWorkflows/types.ts` | 72B | AgentWorkflowRun type |
| `src/lib/agentWorkflows/index.ts` | 72 | Barrel export |
| `src/lib/agentWorkflows/__tests__/registryGuard.test.ts` | 75 | Registry purity guards |
| `src/lib/agentWorkflows/__tests__/approvalGuard.test.ts` | 75 | No-auto-send guards |
| `src/lib/agentWorkflows/__tests__/contractGuard.test.ts` | 75 | Contract coverage guards |
| `src/lib/agentWorkflows/__tests__/canonicalStateGuard.test.ts` | 75 | Canonical state anchor guards |
| `src/lib/agentWorkflows/contracts/researchNarrative.contract.ts` | 74 | Research output contract |
| `src/lib/agentWorkflows/contracts/borrowerDraft.contract.ts` | 74 | Borrower draft contract |
| `src/lib/agentWorkflows/contracts/extractionOutput.contract.ts` | 74 | Extraction output contract |
| `src/lib/agentWorkflows/contracts/memoSection.contract.ts` | 74 | Memo section contract |
| `src/app/api/ops/agent-runs/route.ts` | 72B | Operator console API |
| `src/app/ops/agents/page.tsx` | 72B | Operator console UI |
| `supabase/migrations/YYYYMMDD_agent_workflow_runs_view.sql` | 72B | Unified VIEW |
| `supabase/migrations/YYYYMMDD_promote_cost_columns.sql` | 72C | Cost column promotion |
| `supabase/migrations/YYYYMMDD_approval_snapshots.sql` | 73B | Snapshot columns on draft_borrower_requests |
| `supabase/migrations/YYYYMMDD_agent_approval_events.sql` | 73C | Approval events table |

## Modified Files

| Path | Phase | Change |
|------|-------|--------|
| `src/lib/research/runMission.ts` | 72C | Write cost to promoted columns after mission |
| `src/lib/extraction/runRecord.ts` | 72C | Write cost to promoted columns after extraction |
| `src/app/ops/layout.tsx` (or nav) | 72B | Add "Agent Runs" nav link |
| Borrower send paths | 73C | Add approval event check before dispatch |

---

# Implementation Order

```
72A  →  Registry (pure data, no deps)
72B  →  VIEW migration + types + API + UI
72C  →  Cost column promotion + backfill
73B  →  Approval snapshot columns
73C  →  Approval events table + enforcement
73A  →  Wire missing-items to canonical state
74A  →  Output contracts (Zod schemas)
74B  →  Tiered validation wiring
75   →  Guard tests (all phases)
```

Each phase can be a separate PR. 72A is the foundation — everything else depends on it.
