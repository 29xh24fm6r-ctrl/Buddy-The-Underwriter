/**
 * Types for the unified agent workflow run view.
 * Maps to the `agent_workflow_runs` Postgres VIEW.
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
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
