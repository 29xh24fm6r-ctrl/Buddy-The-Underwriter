import "server-only";

/**
 * Stage entry gates — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR3 §5.2.
 *
 * Gates READ existing readiness signals (deal_underwrite_guard_states,
 * deal_checklist_items, brokerage_closing_conditions) — they never write
 * to them, and never touch the internal deals.stage/LifecycleStage
 * machinery those tables feed.
 *
 * A concrete, schema-grounded gate is defined for the transitions the spec
 * itself illustrates plus the handful this codebase has confirmed signals
 * for (document readiness, underwrite-guard severity, closing conditions).
 * Every other transition falls back to DEFAULT_GATE (no open blocking
 * task) rather than fabricated stage-specific business rules this
 * repository has no verified source of truth for — an honest scope
 * boundary, not an oversight.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import type { BrokerageStage } from "./stages";

export type GateResult = {
  canAdvance: boolean;
  missingRequirements: string[];
};

type GateCheckFn = (dealId: string, sb: SB) => Promise<GateResult>;

async function noOpenBlockingTasks(dealId: string, sb: SB): Promise<GateResult> {
  const { data } = await sb
    .from("brokerage_tasks")
    .select("id, title")
    .eq("deal_id", dealId)
    .eq("blocking", true)
    .in("status", ["open", "in_progress", "blocked"]);

  const rows = (data ?? []) as Array<{ id: string; title: string }>;
  if (rows.length === 0) return { canAdvance: true, missingRequirements: [] };
  return { canAdvance: false, missingRequirements: rows.map((r) => `Open blocking task: ${r.title}`) };
}

async function documentsComplete(dealId: string, sb: SB): Promise<GateResult> {
  const { data } = await sb
    .from("deal_checklist_items")
    .select("title")
    .eq("deal_id", dealId)
    .eq("required", true)
    .eq("status", "missing");

  const missing = (data ?? []) as Array<{ title: string }>;
  const base = await noOpenBlockingTasks(dealId, sb);
  if (missing.length === 0 && base.canAdvance) return { canAdvance: true, missingRequirements: [] };
  return {
    canAdvance: false,
    missingRequirements: [...missing.map((m) => `Missing required document: ${m.title}`), ...base.missingRequirements],
  };
}

async function underwriteGuardNotBlocked(dealId: string, sb: SB): Promise<GateResult> {
  const { data } = await sb
    .from("deal_underwrite_guard_states")
    .select("severity")
    .eq("deal_id", dealId)
    .maybeSingle();

  const base = await noOpenBlockingTasks(dealId, sb);
  const severity = (data as { severity?: string } | null)?.severity;
  if (severity === "BLOCKED") {
    return { canAdvance: false, missingRequirements: ["Underwriting guard is BLOCKED", ...base.missingRequirements] };
  }
  return base;
}

async function underwriteGuardReady(dealId: string, sb: SB): Promise<GateResult> {
  const { data } = await sb
    .from("deal_underwrite_guard_states")
    .select("severity")
    .eq("deal_id", dealId)
    .maybeSingle();

  const base = await noOpenBlockingTasks(dealId, sb);
  const severity = (data as { severity?: string } | null)?.severity;
  if (severity !== "READY") {
    return { canAdvance: false, missingRequirements: ["Underwriting guard is not READY", ...base.missingRequirements] };
  }
  return base;
}

async function closingConditionsSatisfied(dealId: string, sb: SB): Promise<GateResult> {
  const { data } = await sb
    .from("brokerage_closing_conditions")
    .select("title")
    .eq("deal_id", dealId)
    .eq("status", "open");

  const open = (data ?? []) as Array<{ title: string }>;
  const base = await noOpenBlockingTasks(dealId, sb);
  if (open.length === 0 && base.canAdvance) return { canAdvance: true, missingRequirements: [] };
  return {
    canAdvance: false,
    missingRequirements: [...open.map((c) => `Open closing condition: ${c.title}`), ...base.missingRequirements],
  };
}

const GATES: Partial<Record<string, GateCheckFn>> = {
  "application->document_collection": noOpenBlockingTasks,
  "document_collection->financial_analysis": documentsComplete,
  "lender_strategy->submitted": underwriteGuardNotBlocked,
  "underwriting->commitment": underwriteGuardReady,
  "commitment->closing": closingConditionsSatisfied,
  "closing->funded": closingConditionsSatisfied,
};

export async function checkStageGate(
  fromStage: BrokerageStage,
  toStage: BrokerageStage,
  dealId: string,
  sb: SB = supabaseAdmin(),
): Promise<GateResult> {
  const gate = GATES[`${fromStage}->${toStage}`] ?? noOpenBlockingTasks;
  return gate(dealId, sb);
}
