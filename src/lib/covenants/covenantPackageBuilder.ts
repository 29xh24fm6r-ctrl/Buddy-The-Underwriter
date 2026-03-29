import "server-only";

/**
 * Phase 55 — Covenant Package Builder (Orchestrator)
 *
 * Pass 1: Deterministic rule engine → thresholds
 * Pass 2: (Future) Gemini narrative pass → language + calibrations
 * Persist to DB.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { runCovenantRuleEngine, type RuleEngineInput } from "./covenantRuleEngine";
import { COVENANT_RULE_CONFIG } from "./covenantRuleConfig";
import type { CovenantPackage, DealType } from "./covenantTypes";
import crypto from "node:crypto";

export type BuildPackageInput = {
  dealId: string;
  riskGrade: string;
  dealType: DealType;
  actualDscr: number | null;
  actualLeverage: number | null;
  actualDebtYield: number | null;
  actualOccupancy: number | null;
  actualGlobalCashFlow: number | null;
  loanAmount: number | null;
  propertyType?: string | null;
  snapshotHash?: string | null;
};

export async function buildCovenantPackage(
  input: BuildPackageInput,
): Promise<CovenantPackage> {
  // Pass 1: Deterministic rule engine
  const rawSet = runCovenantRuleEngine({
    riskGrade: input.riskGrade,
    dealType: input.dealType,
    actualDscr: input.actualDscr,
    actualLeverage: input.actualLeverage,
    actualDebtYield: input.actualDebtYield,
    actualOccupancy: input.actualOccupancy,
    actualGlobalCashFlow: input.actualGlobalCashFlow,
    loanAmount: input.loanAmount,
    propertyType: input.propertyType,
  });

  // Build rationale
  const rationale = `Covenant package for a ${input.dealType.replace(/_/g, " ")} deal rated ${input.riskGrade}. ` +
    `DSCR floor set at ${rawSet.financial.find((c) => c.category === "dscr")?.threshold?.toFixed(2) ?? "N/A"}x ` +
    `based on current coverage of ${input.actualDscr?.toFixed(2) ?? "N/A"}x. ` +
    `${rawSet.financial.length} financial, ${rawSet.reporting.length} reporting, ` +
    `${rawSet.behavioral.length} behavioral, and ${rawSet.springing.length} springing covenants recommended.`;

  const snapshotHash = input.snapshotHash ?? crypto.randomUUID().slice(0, 16);

  const pkg: CovenantPackage = {
    dealId: input.dealId,
    generatedAt: new Date().toISOString(),
    riskGrade: input.riskGrade,
    dealType: input.dealType,
    financial: rawSet.financial,
    reporting: rawSet.reporting,
    affirmativeNegative: rawSet.behavioral,
    springing: rawSet.springing,
    rationale,
    customizations: [],
    bankerNotes: "",
    snapshotHash,
    ruleEngineVersion: COVENANT_RULE_CONFIG.version,
  };

  // Persist
  const sb = supabaseAdmin();
  await sb.from("buddy_covenant_packages").insert({
    deal_id: input.dealId,
    generated_at: pkg.generatedAt,
    risk_grade: input.riskGrade,
    deal_type: input.dealType,
    financial_covenants: rawSet.financial as any,
    reporting_covenants: rawSet.reporting as any,
    behavioral_covenants: rawSet.behavioral as any,
    springing_covenants: rawSet.springing as any,
    rationale,
    customizations: [] as any,
    banker_notes: "",
    snapshot_hash: snapshotHash,
    rule_engine_version: COVENANT_RULE_CONFIG.version,
    status: "draft",
  });

  return pkg;
}
