/**
 * Workflow Registry — STRICTLY NON-EXECUTABLE
 *
 * This file is a documentation layer for OCC auditability.
 * It MUST NOT import execution code, Supabase, or dispatch workflows.
 *
 * Auditors must be able to read workflows without reading code.
 *
 * Run guard: node --import tsx --test src/lib/agentWorkflows/__tests__/registryGuard.test.ts
 */

// ── Types ───────────────────────────────────────────────────────────

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

// ── Registry ────────────────────────────────────────────────────────

export const WORKFLOW_REGISTRY = Object.freeze({
  research_bundle_generation: {
    code: "research_bundle_generation",
    label: "Research Bundle Generation",
    description:
      "Discovers sources, extracts facts, derives inferences, and compiles narrative for a deal research mission.",
    sourceTable: "buddy_research_missions",
    sourceIdColumn: "id",
    statusColumn: "status",
    statusValues: [
      "queued",
      "running",
      "complete",
      "failed",
      "cancelled",
    ] as const,
    costMetrics: {
      hasTokens: true,
      hasCostUsd: true,
      tokenColumns: { input: "input_tokens", output: "output_tokens" },
      costColumn: "cost_usd",
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
    statusValues: [
      "queued",
      "running",
      "succeeded",
      "failed",
      "routed_to_review",
    ] as const,
    costMetrics: {
      hasTokens: true,
      hasCostUsd: true,
      tokenColumns: { input: "input_tokens", output: "output_tokens" },
      costColumn: "cost_usd",
      metricsJsonPath: "metrics",
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
    statusValues: [
      "created",
      "queued",
      "already_exists",
      "noop",
      "failed",
    ] as const,
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
      "draft",
      "queued",
      "sent",
      "in_progress",
      "completed",
      "expired",
      "cancelled",
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
    statusValues: [
      "pending_approval",
      "approved",
      "sent",
      "rejected",
    ] as const,
    costMetrics: {
      hasTokens: false,
      hasCostUsd: false,
    },
    requiresCanonicalState: true,
    triggerType: "system" as const,
    ownerSystem: "borrower",
  },
} as const satisfies Record<string, WorkflowDefinition>);

// ── Helpers ─────────────────────────────────────────────────────────

export type WorkflowCode = keyof typeof WORKFLOW_REGISTRY;

export function getWorkflowDefinition(
  code: string,
): WorkflowDefinition | undefined {
  return (WORKFLOW_REGISTRY as Record<string, WorkflowDefinition>)[code];
}

export function getAllWorkflowCodes(): WorkflowCode[] {
  return Object.keys(WORKFLOW_REGISTRY) as WorkflowCode[];
}
