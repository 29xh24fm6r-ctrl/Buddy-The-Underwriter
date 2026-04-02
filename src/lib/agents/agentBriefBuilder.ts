/**
 * Agent Brief Builder — Phase 66B Agent Choreography
 *
 * Server module. Builds structured briefs for agent handoffs, filtering
 * data by visibility scope so borrower-visible handoffs never leak
 * banker-only rationale.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentName } from "./types";
import type { VisibilityScope } from "./controlPlane";
import type { TaskContract } from "./agentTaskContracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BriefInput {
  dealId: string;
  bankId: string;
  fromAgent: AgentName;
  toAgent: AgentName;
  visibility: VisibilityScope;
  taskContract: TaskContract;
}

export interface HandoffBrief {
  dealContext: Record<string, unknown>;
  relevantFindings: unknown[];
  constraints: string[];
  redactedFields: string[];
}

// ---------------------------------------------------------------------------
// Banker-only fields that must be stripped for borrower visibility
// ---------------------------------------------------------------------------

const BANKER_ONLY_FIELDS = new Set([
  "internal_risk_notes",
  "committee_comments",
  "pricing_rationale",
  "override_reason",
  "credit_score",
  "derogatory_details",
  "policy_exceptions",
  "risk_tier_justification",
  "banker_recommendation",
  "internal_memo_draft",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadDealContext(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<Record<string, unknown>> {
  const { data: deal } = await sb
    .from("deals")
    .select("id, bank_id, borrower_name, loan_amount, loan_type, status, naics_code, created_at")
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .single();

  return (deal as Record<string, unknown>) ?? {};
}

async function loadRelevantFindings(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
  agentName: AgentName,
): Promise<unknown[]> {
  const { data } = await sb
    .from("agent_findings")
    .select("*")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("agent_name", agentName)
    .order("created_at", { ascending: false })
    .limit(20);

  return data ?? [];
}

function redactForVisibility(
  context: Record<string, unknown>,
  findings: unknown[],
  visibility: VisibilityScope,
  contractRedactionRules: string[],
): { filteredContext: Record<string, unknown>; filteredFindings: unknown[]; redactedFields: string[] } {
  if (visibility === "banker" || visibility === "committee" || visibility === "system") {
    // Full access — no redaction needed.
    return { filteredContext: context, filteredFindings: findings, redactedFields: [] };
  }

  // Borrower visibility — strip banker-only fields.
  const allRedactions = new Set([...BANKER_ONLY_FIELDS, ...contractRedactionRules]);
  const redactedFields: string[] = [];
  const filteredContext: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (allRedactions.has(key)) {
      redactedFields.push(key);
    } else {
      filteredContext[key] = value;
    }
  }

  const filteredFindings = (findings as Record<string, unknown>[]).map((f) => {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(f)) {
      if (allRedactions.has(key)) {
        redactedFields.push(key);
      } else {
        filtered[key] = value;
      }
    }
    return filtered;
  });

  return { filteredContext, filteredFindings, redactedFields: [...new Set(redactedFields)] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a structured handoff brief, scoped to the appropriate visibility.
 */
export async function buildHandoffBrief(
  sb: SupabaseClient,
  input: BriefInput,
): Promise<HandoffBrief> {
  const [rawContext, rawFindings] = await Promise.all([
    loadDealContext(sb, input.dealId, input.bankId),
    loadRelevantFindings(sb, input.dealId, input.bankId, input.fromAgent),
  ]);

  const { filteredContext, filteredFindings, redactedFields } = redactForVisibility(
    rawContext,
    rawFindings,
    input.visibility,
    input.taskContract.borrowerSafeRedactionRules,
  );

  const constraints: string[] = [];
  if (input.visibility === "borrower") {
    constraints.push("Output must be borrower-safe — no internal risk commentary");
  }
  if (input.taskContract.freshnessRequirement === "realtime") {
    constraints.push("Data must be fetched in real-time, not cached");
  }
  if (!input.taskContract.cancellable) {
    constraints.push("Task cannot be cancelled once started");
  }

  return {
    dealContext: filteredContext,
    relevantFindings: filteredFindings,
    constraints,
    redactedFields,
  };
}
