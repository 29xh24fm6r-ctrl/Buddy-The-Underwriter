# Phase 72–74 Cursor-Ready Tickets

Each ticket = one PR. File-by-file changes specified.

---

## Ticket 1: 72A — Workflow Registry (Pure Data)

**Branch:** `feat/phase-72a-workflow-registry`

### Create: `src/lib/agentWorkflows/registry.ts`

```ts
/**
 * Workflow Registry — STRICTLY NON-EXECUTABLE
 *
 * This file is a documentation layer for OCC auditability.
 * It MUST NOT import execution code, Supabase, or dispatch workflows.
 *
 * Auditors must be able to read workflows without reading code.
 */

export type CostMetrics = {
  hasTokens: boolean;
  hasCostUsd: boolean;
  tokenColumns?: { input: string; output: string };
  costColumn?: string;
  metricsJsonPath?: string;
};

export type WorkflowDefinition = {
  code: string;
  label: string;
  description: string;
  sourceTable: string;
  sourceIdColumn: string;
  statusColumn: string;
  statusValues: readonly string[];
  costMetrics: CostMetrics;
  requiresCanonicalState: boolean;
  triggerType: "user" | "system" | "both";
  ownerSystem: string;
};

export const WORKFLOW_REGISTRY = Object.freeze({
  research_bundle_generation: {
    code: "research_bundle_generation",
    label: "Research Bundle Generation",
    description:
      "Discovers sources, extracts facts, derives inferences, and compiles narrative for a deal research mission.",
    sourceTable: "buddy_research_missions",
    sourceIdColumn: "id",
    statusColumn: "status",
    statusValues: ["queued", "running", "complete", "failed", "cancelled"] as const,
    costMetrics: {
      hasTokens: false,
      hasCostUsd: false,
      metricsJsonPath: "metrics",
    },
    requiresCanonicalState: true,
    triggerType: "user" as const,
    ownerSystem: "research",
  },

  document_extraction: {
    code: "document_extraction",
    label: "Document Extraction",
    description:
      "Runs OCR + optional structured assist on uploaded documents, producing extraction run records with validated output.",
    sourceTable: "deal_extraction_runs",
    sourceIdColumn: "id",
    statusColumn: "status",
    statusValues: ["queued", "running", "succeeded", "failed", "routed_to_review"] as const,
    costMetrics: {
      hasTokens: true,
      hasCostUsd: true,
      metricsJsonPath: "metrics",
      tokenColumns: { input: "metrics->>'tokens_in'", output: "metrics->>'tokens_out'" },
      costColumn: "metrics->>'cost_estimate_usd'",
    },
    requiresCanonicalState: false,
    triggerType: "system" as const,
    ownerSystem: "extraction",
  },

  cross_doc_reconciliation: {
    code: "cross_doc_reconciliation",
    label: "Cross-Document Reconciliation",
    description:
      "Runs cross-document consistency checks and records hard failures, soft flags, and overall reconciliation status.",
    sourceTable: "deal_reconciliation_results",
    sourceIdColumn: "id",
    statusColumn: "overall_status",
    statusValues: ["CLEAN", "FLAGS", "CONFLICTS"] as const,
    costMetrics: {
      hasTokens: false,
      hasCostUsd: false,
    },
    requiresCanonicalState: true,
    triggerType: "system" as const,
    ownerSystem: "reconciliation",
  },

  canonical_action_execution: {
    code: "canonical_action_execution",
    label: "Canonical Action Execution",
    description:
      "Executes a canonical next-action (conditions, covenants, pricing, memo, etc.) and records the audit trail.",
    sourceTable: "canonical_action_executions",
    sourceIdColumn: "id",
    statusColumn: "execution_status",
    statusValues: ["created", "queued", "already_exists", "noop", "failed"] as const,
    costMetrics: {
      hasTokens: false,
      hasCostUsd: false,
    },
    requiresCanonicalState: true,
    triggerType: "both" as const,
    ownerSystem: "lifecycle",
  },

  borrower_request_campaign: {
    code: "borrower_request_campaign",
    label: "Borrower Request Campaign",
    description:
      "Orchestrates outbound borrower request campaigns with reminder scheduling and status tracking.",
    sourceTable: "borrower_request_campaigns",
    sourceIdColumn: "id",
    statusColumn: "status",
    statusValues: [
      "draft", "queued", "sent", "in_progress", "completed", "expired", "cancelled",
    ] as const,
    costMetrics: {
      hasTokens: false,
      hasCostUsd: false,
    },
    requiresCanonicalState: true,
    triggerType: "both" as const,
    ownerSystem: "borrower",
  },

  borrower_draft_request: {
    code: "borrower_draft_request",
    label: "Borrower Draft Request",
    description:
      "Auto-generated draft request for missing documents. Requires underwriter approval before sending to borrower.",
    sourceTable: "draft_borrower_requests",
    sourceIdColumn: "id",
    statusColumn: "status",
    statusValues: ["pending_approval", "approved", "sent", "rejected"] as const,
    costMetrics: {
      hasTokens: false,
      hasCostUsd: false,
    },
    requiresCanonicalState: true,
    triggerType: "system" as const,
    ownerSystem: "borrower",
  },
} as const satisfies Record<string, WorkflowDefinition>);

export type WorkflowCode = keyof typeof WORKFLOW_REGISTRY;

export function getWorkflowDefinition(code: string): WorkflowDefinition | undefined {
  return (WORKFLOW_REGISTRY as Record<string, WorkflowDefinition>)[code];
}

export function getAllWorkflowCodes(): WorkflowCode[] {
  return Object.keys(WORKFLOW_REGISTRY) as WorkflowCode[];
}
```

### Create: `src/lib/agentWorkflows/types.ts`

```ts
/**
 * Types for the unified agent workflow run view.
 * Maps to the `agent_workflow_runs` Postgres VIEW.
 */

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

export type AgentWorkflowRunFilter = {
  deal_id?: string;
  workflow_code?: string;
  status?: string;
  limit?: number;
};
```

### Create: `src/lib/agentWorkflows/index.ts`

```ts
export { WORKFLOW_REGISTRY, getWorkflowDefinition, getAllWorkflowCodes } from "./registry";
export type { WorkflowDefinition, WorkflowCode, CostMetrics } from "./registry";
export type { AgentWorkflowRun, AgentWorkflowRunFilter } from "./types";
```

### Create: `src/lib/agentWorkflows/__tests__/registryGuard.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REGISTRY_PATH = path.resolve("src/lib/agentWorkflows/registry.ts");

describe("guard:workflow-registry", () => {
  const source = fs.readFileSync(REGISTRY_PATH, "utf8");

  it("has zero imports from execution code", () => {
    assert.ok(!source.match(/import.*from.*runMission/), "must not import runMission");
    assert.ok(!source.match(/import.*from.*executeCanonicalAction/), "must not import executeCanonicalAction");
    assert.ok(!source.match(/import.*from.*orchestrator/), "must not import orchestrator");
  });

  it("does not reference SupabaseClient", () => {
    assert.ok(!source.match(/SupabaseClient/), "must not reference SupabaseClient");
    assert.ok(!source.match(/createClient/), "must not reference createClient");
  });

  it("does not import from supabase or server modules", () => {
    assert.ok(!source.match(/import.*from.*supabase/i), "must not import supabase");
    assert.ok(!source.match(/import.*server-only/), "must not import server-only");
  });

  it("registry is frozen (Object.freeze)", () => {
    assert.ok(source.includes("Object.freeze"), "WORKFLOW_REGISTRY must be frozen");
  });

  it("every entry has required fields", () => {
    // Dynamic import would require ESM; use regex for guard
    const requiredFields = [
      "code", "label", "description", "sourceTable",
      "sourceIdColumn", "statusColumn", "statusValues",
      "costMetrics", "requiresCanonicalState", "triggerType", "ownerSystem",
    ];
    for (const field of requiredFields) {
      const count = (source.match(new RegExp(`${field}:`, "g")) || []).length;
      assert.ok(count >= 6, `every entry must have '${field}' (found ${count} occurrences, expected >= 6)`);
    }
  });
});
```

**Test command:** `node --import tsx --test src/lib/agentWorkflows/__tests__/registryGuard.test.ts`

---

## Ticket 2: 72B — Operator Console VIEW + API + UI

**Branch:** `feat/phase-72b-operator-console`
**Depends on:** Ticket 1

### Create: `supabase/migrations/YYYYMMDD_agent_workflow_runs_view.sql`

Use the VIEW SQL from the spec. Key adjustments from codebase exploration:

- `deal_reconciliation_results` has NO `bank_id` column → cast `NULL::uuid`
- `deal_extraction_runs` has NO `bank_id` column → cast `NULL::uuid`
- `draft_borrower_requests` has NO `bank_id` column → cast `NULL::uuid`
- `buddy_research_missions` cost is NOT in a top-level column → extract from JSONB if `metrics` exists, else NULL
- `deal_extraction_runs` tokens are in `metrics` JSONB

```sql
-- Unified agent workflow runs view
-- Phase 72B: Operator Console

CREATE OR REPLACE VIEW agent_workflow_runs AS

SELECT
  id,
  deal_id,
  bank_id,
  'research_bundle_generation'::text AS workflow_code,
  status,
  created_at,
  NULL::numeric AS cost_usd,
  NULL::integer AS input_tokens,
  NULL::integer AS output_tokens,
  NULL::text AS model_used
FROM buddy_research_missions

UNION ALL

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

COMMENT ON VIEW agent_workflow_runs IS
  'Unified view across all agent workflow run tables. Phase 72B Operator Console.';
```

### Create: `src/app/api/ops/agent-runs/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSuperAdmin } from "@/lib/auth/requireSuperAdmin"; // use existing pattern

export async function GET(req: NextRequest) {
  try {
    const adminCheck = await requireSuperAdmin();
    if (!adminCheck.ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const dealId = url.searchParams.get("deal_id");
    const workflowCode = url.searchParams.get("workflow_code");
    const status = url.searchParams.get("status");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

    const sb = createServiceClient();
    let query = sb.from("agent_workflow_runs").select("*").order("created_at", { ascending: false }).limit(limit);

    if (dealId) query = query.eq("deal_id", dealId);
    if (workflowCode) query = query.eq("workflow_code", workflowCode);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;

    if (error) {
      console.error("[ops/agent-runs] query error:", error.message);
      return NextResponse.json({ runs: [] });
    }

    return NextResponse.json({ runs: data ?? [] });
  } catch (err) {
    console.error("[ops/agent-runs] unexpected error:", err);
    return NextResponse.json({ runs: [] });
  }
}
```

### Create: `src/app/ops/agents/page.tsx`

Standard `"use client"` page:
- Fetch from `/api/ops/agent-runs`
- Table: workflow_code | deal_id (link) | status (badge) | cost_usd | tokens (in/out) | created_at
- Filter dropdowns: workflow_code (from registry), status
- Refresh button
- Use existing ShellPage wrapper from `/ops/`
- Follow existing ops page patterns (see `/ops/intake/`, `/ops/reminders/`)

### Modify: ops navigation

Add "Agent Runs" link to the ops nav/layout (find existing nav pattern in `/ops/` layout or page).

---

## Ticket 3: 72C — Cost Column Promotion

**Branch:** `feat/phase-72c-cost-columns`
**Depends on:** Ticket 2

### Create: `supabase/migrations/YYYYMMDD_promote_cost_columns.sql`

```sql
-- Phase 72C: Promote cost metrics from JSONB to top-level columns

-- buddy_research_missions
ALTER TABLE buddy_research_missions
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS model_used TEXT;

-- deal_extraction_runs
ALTER TABLE deal_extraction_runs
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER;

-- Backfill extraction runs from metrics JSONB
UPDATE deal_extraction_runs
SET
  cost_usd = (metrics->>'cost_estimate_usd')::numeric,
  input_tokens = (metrics->>'tokens_in')::integer,
  output_tokens = (metrics->>'tokens_out')::integer
WHERE metrics IS NOT NULL
  AND cost_usd IS NULL;

-- Update the VIEW to prefer promoted columns
CREATE OR REPLACE VIEW agent_workflow_runs AS

SELECT
  id, deal_id, bank_id,
  'research_bundle_generation'::text AS workflow_code,
  status, created_at,
  cost_usd,
  input_tokens,
  output_tokens,
  model_used
FROM buddy_research_missions

UNION ALL

SELECT
  id, deal_id, NULL::uuid AS bank_id,
  'document_extraction'::text,
  status, created_at,
  COALESCE(cost_usd, (metrics->>'cost_estimate_usd')::numeric),
  COALESCE(input_tokens, (metrics->>'tokens_in')::integer),
  COALESCE(output_tokens, (metrics->>'tokens_out')::integer),
  NULL::text
FROM deal_extraction_runs

UNION ALL

SELECT
  id, deal_id, NULL::uuid AS bank_id,
  'cross_doc_reconciliation'::text,
  overall_status, created_at,
  NULL::numeric, NULL::integer, NULL::integer, NULL::text
FROM deal_reconciliation_results

UNION ALL

SELECT
  id, deal_id, bank_id,
  action_code,
  execution_status, created_at,
  NULL::numeric, NULL::integer, NULL::integer, NULL::text
FROM canonical_action_executions

UNION ALL

SELECT
  id, deal_id, bank_id,
  'borrower_request_campaign'::text,
  status, created_at,
  NULL::numeric, NULL::integer, NULL::integer, NULL::text
FROM borrower_request_campaigns

UNION ALL

SELECT
  id, deal_id, NULL::uuid AS bank_id,
  'borrower_draft_request'::text,
  status, created_at,
  NULL::numeric, NULL::integer, NULL::integer, NULL::text
FROM draft_borrower_requests;
```

### Modify: `src/lib/research/runMission.ts`

After mission completes, write promoted columns:

```ts
// After existing mission completion logic, add:
await sb.from("buddy_research_missions").update({
  cost_usd: totalCostUsd,
  input_tokens: totalInputTokens,
  output_tokens: totalOutputTokens,
  model_used: modelId,
}).eq("id", missionId);
```

Find the exact completion point (around line ~480 where status is set to `'complete'`).

### Modify: `src/lib/extraction/runRecord.ts`

After extraction run finalizes, write promoted columns alongside `metrics` JSONB.

---

## Ticket 4: 73B+73C — Approval Snapshots + Approval Events

**Branch:** `feat/phase-73-approval-governance`
**Depends on:** None (independent)

### Create: `supabase/migrations/YYYYMMDD_approval_snapshots.sql`

```sql
-- Phase 73B: Add immutable approval snapshots to draft_borrower_requests

ALTER TABLE draft_borrower_requests
  ADD COLUMN IF NOT EXISTS approved_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS sent_snapshot JSONB;

COMMENT ON COLUMN draft_borrower_requests.approved_snapshot IS
  'Frozen copy of {draft_subject, draft_message, evidence} at approval time. Immutable after write.';
COMMENT ON COLUMN draft_borrower_requests.sent_snapshot IS
  'Frozen copy of exactly what was delivered to borrower. Immutable after write.';
```

### Create: `supabase/migrations/YYYYMMDD_agent_approval_events.sql`

```sql
-- Phase 73C: Immutable approval event log (SR 11-7 compliance)

CREATE TABLE IF NOT EXISTS agent_approval_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'revoked')),
  decided_by TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_json JSONB NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_events_entity
  ON agent_approval_events(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_approval_events_decided_by
  ON agent_approval_events(decided_by);

ALTER TABLE agent_approval_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON agent_approval_events FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read"
  ON agent_approval_events FOR SELECT
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE agent_approval_events IS
  'Immutable audit log of approval/rejection decisions for agent-generated content. SR 11-7 compliance.';
```

### Create: `src/lib/agentWorkflows/approval.ts`

```ts
import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";

export type ApprovalDecision = "approved" | "rejected" | "revoked";

export type RecordApprovalInput = {
  entityType: string;
  entityId: string;
  decision: ApprovalDecision;
  decidedBy: string;
  snapshotJson: Record<string, unknown>;
  reason?: string;
};

/**
 * Record an immutable approval event.
 * MUST be called before any outbound borrower communication.
 */
export async function recordApprovalEvent(
  sb: SupabaseClient,
  input: RecordApprovalInput,
): Promise<{ ok: boolean; eventId?: string; error?: string }> {
  const { data, error } = await sb.from("agent_approval_events").insert({
    entity_type: input.entityType,
    entity_id: input.entityId,
    decision: input.decision,
    decided_by: input.decidedBy,
    snapshot_json: input.snapshotJson,
    reason: input.reason,
  }).select("id").single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, eventId: data.id };
}

/**
 * Verify that an approved event exists for an entity.
 * MUST be called before dispatching any outbound communication.
 */
export async function verifyApprovalExists(
  sb: SupabaseClient,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("agent_approval_events")
    .select("id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("decision", "approved")
    .limit(1);

  return (data?.length ?? 0) > 0;
}
```

### Modify: borrower send paths

Find all places that transition `draft_borrower_requests.status` to `'approved'` or `'sent'` and:

1. On `approved`: populate `approved_snapshot` + call `recordApprovalEvent()`
2. On `sent`: populate `sent_snapshot`
3. Before any actual send (email/SMS/portal): call `verifyApprovalExists()`

Likely files to modify:
- Borrower request campaign send logic
- Draft borrower request approval endpoints
- `src/lib/borrower-reminders/processor.ts` (if it sends directly)

### Create: `src/lib/agentWorkflows/__tests__/approvalGuard.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("guard:approval-enforcement", () => {
  it("approval.ts exports verifyApprovalExists", () => {
    const source = fs.readFileSync(
      path.resolve("src/lib/agentWorkflows/approval.ts"), "utf8"
    );
    assert.ok(source.includes("export async function verifyApprovalExists"));
  });

  it("approval.ts exports recordApprovalEvent", () => {
    const source = fs.readFileSync(
      path.resolve("src/lib/agentWorkflows/approval.ts"), "utf8"
    );
    assert.ok(source.includes("export async function recordApprovalEvent"));
  });

  it("no auto-send without approval check in borrower reminders", () => {
    const processorPath = path.resolve("src/lib/borrower-reminders/processor.ts");
    if (fs.existsSync(processorPath)) {
      const source = fs.readFileSync(processorPath, "utf8");
      // If processor sends messages, it must reference approval verification
      if (source.includes("sendBorrowerCampaign") || source.includes("twilio")) {
        assert.ok(
          source.includes("verifyApproval") || source.includes("approval"),
          "borrower reminder processor must check approval before sending"
        );
      }
    }
  });
});
```

---

## Ticket 5: 74A+74B — Output Contracts + Tiered Validation

**Branch:** `feat/phase-74-output-contracts`
**Depends on:** None (independent)

### Create: `src/lib/agentWorkflows/contracts/researchNarrative.contract.ts`

```ts
import { z } from "zod";

export const ResearchNarrativeContract = z.object({
  section_key: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(10, "Narrative body must be at least 10 characters"),
  sources_cited: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1).optional(),
});

export type ResearchNarrativeOutput = z.infer<typeof ResearchNarrativeContract>;

export function validateResearchNarrative(data: unknown): {
  ok: boolean;
  data?: ResearchNarrativeOutput;
  errors?: z.ZodError;
  severity: "block" | "warn";
} {
  const result = ResearchNarrativeContract.safeParse(data);
  if (result.success) return { ok: true, data: result.data, severity: "warn" };

  // Missing required fields = block; other issues = warn
  const hasMissingRequired = result.error.issues.some(
    (i) => i.code === "invalid_type" && i.received === "undefined"
  );
  return {
    ok: false,
    errors: result.error,
    severity: hasMissingRequired ? "block" : "warn",
  };
}
```

### Create: `src/lib/agentWorkflows/contracts/borrowerDraft.contract.ts`

```ts
import { z } from "zod";

export const BorrowerDraftContract = z.object({
  draft_subject: z.string().min(1, "Subject is required"),
  draft_message: z.string().min(20, "Message must be at least 20 characters"),
  missing_document_type: z.string().min(1),
  evidence: z.array(z.record(z.unknown())).optional(),
});

export type BorrowerDraftOutput = z.infer<typeof BorrowerDraftContract>;

export function validateBorrowerDraft(data: unknown): {
  ok: boolean;
  data?: BorrowerDraftOutput;
  errors?: z.ZodError;
  severity: "block" | "warn";
} {
  const result = BorrowerDraftContract.safeParse(data);
  if (result.success) return { ok: true, data: result.data, severity: "warn" };

  const hasMissingRequired = result.error.issues.some(
    (i) => i.code === "invalid_type" && i.received === "undefined"
  );
  return {
    ok: false,
    errors: result.error,
    severity: hasMissingRequired ? "block" : "warn",
  };
}
```

### Create: `src/lib/agentWorkflows/contracts/extractionOutput.contract.ts`

Zod contract for extraction structured output. Shape depends on existing `structuredJsonParser.ts` output — read that file to derive the schema.

### Create: `src/lib/agentWorkflows/contracts/memoSection.contract.ts`

Zod contract for credit memo narrative sections. Shape depends on existing `buildCanonicalCreditMemo` output — read memo builder to derive.

### Create: `src/lib/agentWorkflows/contracts/index.ts`

Barrel export all contracts.

### Create: `src/lib/agentWorkflows/__tests__/contractGuard.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const CONTRACTS_DIR = path.resolve("src/lib/agentWorkflows/contracts");

describe("guard:contracts", () => {
  it("contracts directory exists", () => {
    assert.ok(fs.existsSync(CONTRACTS_DIR));
  });

  it("every contract file exports a validate function", () => {
    const files = fs.readdirSync(CONTRACTS_DIR).filter(f => f.endsWith(".contract.ts"));
    assert.ok(files.length >= 4, `expected at least 4 contract files, found ${files.length}`);
    for (const file of files) {
      const source = fs.readFileSync(path.join(CONTRACTS_DIR, file), "utf8");
      assert.ok(
        source.includes("export function validate"),
        `${file} must export a validate function`
      );
    }
  });

  it("every contract uses zod", () => {
    const files = fs.readdirSync(CONTRACTS_DIR).filter(f => f.endsWith(".contract.ts"));
    for (const file of files) {
      const source = fs.readFileSync(path.join(CONTRACTS_DIR, file), "utf8");
      assert.ok(source.includes('from "zod"'), `${file} must import from zod`);
    }
  });

  it("no contract imports execution code", () => {
    const files = fs.readdirSync(CONTRACTS_DIR).filter(f => f.endsWith(".contract.ts"));
    for (const file of files) {
      const source = fs.readFileSync(path.join(CONTRACTS_DIR, file), "utf8");
      assert.ok(!source.includes("supabase"), `${file} must not reference supabase`);
      assert.ok(!source.includes("server-only"), `${file} must not import server-only`);
    }
  });
});
```

---

## Ticket 6: 75 — Canonical State Guard

**Branch:** `feat/phase-75-canonical-state-guard`
**Depends on:** Ticket 1

### Create: `src/lib/agentWorkflows/__tests__/canonicalStateGuard.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WORKFLOW_REGISTRY } from "../registry";

describe("guard:canonical-state", () => {
  const workflowsRequiringState = Object.values(WORKFLOW_REGISTRY).filter(
    (w) => w.requiresCanonicalState
  );

  it("at least 4 workflows require canonical state", () => {
    assert.ok(
      workflowsRequiringState.length >= 4,
      `expected >= 4, got ${workflowsRequiringState.length}`
    );
  });

  it("document_extraction does NOT require canonical state", () => {
    assert.strictEqual(WORKFLOW_REGISTRY.document_extraction.requiresCanonicalState, false);
  });

  it("research_bundle_generation requires canonical state", () => {
    assert.strictEqual(WORKFLOW_REGISTRY.research_bundle_generation.requiresCanonicalState, true);
  });

  it("canonical_action_execution requires canonical state", () => {
    assert.strictEqual(WORKFLOW_REGISTRY.canonical_action_execution.requiresCanonicalState, true);
  });

  it("registry file does not contain getBuddyCanonicalState call (pure data)", () => {
    const source = fs.readFileSync(
      path.resolve("src/lib/agentWorkflows/registry.ts"), "utf8"
    );
    assert.ok(
      !source.includes("getBuddyCanonicalState"),
      "registry must not call getBuddyCanonicalState — it is pure data"
    );
  });
});
```

---

## Summary: PR Order

```
PR 1: 72A  — Workflow Registry          (0 deps, pure data)
PR 2: 73   — Approval Governance        (0 deps, migration + server code)
PR 3: 74   — Output Contracts           (0 deps, pure Zod)
PR 4: 72B  — Operator Console           (depends on PR 1)
PR 5: 72C  — Cost Column Promotion      (depends on PR 4)
PR 6: 75   — Guard Tests                (depends on PR 1 + PR 2 + PR 3)
```

PRs 1, 2, and 3 can be developed **in parallel** — they have no dependencies on each other.
