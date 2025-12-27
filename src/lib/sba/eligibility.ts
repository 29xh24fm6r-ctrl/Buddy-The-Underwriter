/**
 * SBA Eligibility Engine
 * 
 * Evaluates deals against machine-readable SBA policy rules.
 * Provides instant feedback on pass/fail + suggested fixes.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type RuleSeverity = "HARD_STOP" | "REQUIRES_MITIGATION" | "ADVISORY";
export type SBAProgram = "7A" | "504" | "BOTH";

export type SBARuleCondition = {
  all?: SBARuleCondition[];
  any?: SBARuleCondition[];
  field?: string;
  eq?: any;
  neq?: any;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  in?: any[];
  not_in?: any[];
};

export type SBARule = {
  id: string;
  program: SBAProgram;
  rule_key: string;
  category: string;
  condition_json: SBARuleCondition;
  title: string;
  explanation: string;
  borrower_friendly_explanation?: string;
  fix_suggestions?: Array<{ issue: string; fix: string; example: string }>;
  sop_reference: string;
  severity: RuleSeverity;
};

export type RuleEvaluationResult = {
  rule: SBARule;
  passes: boolean;
  field_values: Record<string, any>;
  failure_reason?: string;
  suggested_fixes?: Array<{ issue: string; fix: string; example: string }>;
};

export type EligibilityReport = {
  deal_id: string;
  program: SBAProgram;
  overall_eligible: boolean;
  hard_stops: RuleEvaluationResult[];
  mitigations_required: RuleEvaluationResult[];
  advisories: RuleEvaluationResult[];
  passed_rules: RuleEvaluationResult[];
  evaluated_at: Date;
};

/**
 * Evaluate deal against all SBA rules for a program
 */
export async function evaluateSBAEligibility({
  dealId,
  program = "7A",
  dealData,
}: {
  dealId: string;
  program?: SBAProgram;
  dealData: Record<string, any>; // Deal fields to evaluate
}): Promise<EligibilityReport> {
  const sb = supabaseAdmin();

  // 1. Fetch applicable rules
  const { data: rules } = await sb
    .from("sba_policy_rules")
    .select("*")
    .or(`program.eq.${program},program.eq.BOTH`)
    .order("severity", { ascending: false }); // HARD_STOP first

  if (!rules || rules.length === 0) {
    throw new Error(`No SBA rules found for program ${program}`);
  }

  // 2. Evaluate each rule
  const results: RuleEvaluationResult[] = rules.map((rule) =>
    evaluateRule(rule as SBARule, dealData)
  );

  // 3. Categorize by severity
  const hard_stops = results.filter((r) => !r.passes && r.rule.severity === "HARD_STOP");
  const mitigations_required = results.filter(
    (r) => !r.passes && r.rule.severity === "REQUIRES_MITIGATION"
  );
  const advisories = results.filter((r) => !r.passes && r.rule.severity === "ADVISORY");
  const passed_rules = results.filter((r) => r.passes);

  const overall_eligible = hard_stops.length === 0;

  // 4. Store evaluation results
  await Promise.all(
    results.map((r) =>
      sb.from("deal_sba_rule_evaluations").insert({
        deal_id: dealId,
        rule_id: r.rule.id,
        passes: r.passes,
        field_values: r.field_values,
        failure_reason: r.failure_reason,
        suggested_fixes: r.suggested_fixes,
        auto_evaluated: true,
      })
    )
  );

  return {
    deal_id: dealId,
    program,
    overall_eligible,
    hard_stops,
    mitigations_required,
    advisories,
    passed_rules,
    evaluated_at: new Date(),
  };
}

/**
 * Evaluate single rule against deal data
 */
function evaluateRule(rule: SBARule, data: Record<string, any>): RuleEvaluationResult {
  const passes = evaluateCondition(rule.condition_json, data);
  const field_values = extractFieldValues(rule.condition_json, data);

  let failure_reason: string | undefined;
  let suggested_fixes: typeof rule.fix_suggestions | undefined;

  if (!passes) {
    failure_reason = generateFailureReason(rule, field_values);
    suggested_fixes = rule.fix_suggestions;
  }

  return {
    rule,
    passes,
    field_values,
    failure_reason,
    suggested_fixes,
  };
}

/**
 * Recursively evaluate JSON Logic condition
 */
function evaluateCondition(condition: SBARuleCondition, data: Record<string, any>): boolean {
  // Handle logical operators
  if (condition.all) {
    return condition.all.every((c) => evaluateCondition(c, data));
  }
  if (condition.any) {
    return condition.any.some((c) => evaluateCondition(c, data));
  }

  // Handle field comparisons
  if (condition.field) {
    const value = data[condition.field];

    if (condition.eq !== undefined) return value === condition.eq;
    if (condition.neq !== undefined) return value !== condition.neq;
    if (condition.gt !== undefined) return value > condition.gt;
    if (condition.gte !== undefined) return value >= condition.gte;
    if (condition.lt !== undefined) return value < condition.lt;
    if (condition.lte !== undefined) return value <= condition.lte;
    if (condition.in !== undefined) return condition.in.includes(value);
    if (condition.not_in !== undefined) return !condition.not_in.includes(value);
  }

  // Default: pass if no condition specified
  return true;
}

/**
 * Extract field values used in condition
 */
function extractFieldValues(
  condition: SBARuleCondition,
  data: Record<string, any>
): Record<string, any> {
  const fields: Record<string, any> = {};

  function extract(c: SBARuleCondition) {
    if (c.all) c.all.forEach(extract);
    if (c.any) c.any.forEach(extract);
    if (c.field) {
      fields[c.field] = data[c.field];
    }
  }

  extract(condition);
  return fields;
}

/**
 * Generate human-readable failure reason
 */
function generateFailureReason(rule: SBARule, values: Record<string, any>): string {
  const cond = rule.condition_json;

  // Simple field check
  if (cond.field) {
    const value = values[cond.field];
    const fieldName = cond.field.replace(/_/g, " ");

    if (cond.gte !== undefined) {
      return `${fieldName} is ${value}, must be >= ${cond.gte}`;
    }
    if (cond.lte !== undefined) {
      return `${fieldName} is ${value}, must be <= ${cond.lte}`;
    }
    if (cond.not_in !== undefined) {
      return `${fieldName} is "${value}", which is not allowed`;
    }
    if (cond.in !== undefined) {
      return `${fieldName} is "${value}", must be one of: ${cond.in.join(", ")}`;
    }
  }

  // Fallback to rule explanation
  return rule.explanation;
}

/**
 * Format eligibility report for display
 */
export function formatEligibilityReport(report: EligibilityReport): string {
  let output = `**SBA ${report.program} Eligibility Report**\n\n`;

  if (report.overall_eligible) {
    output += `✅ **ELIGIBLE** - No hard stops detected\n\n`;
  } else {
    output += `❌ **NOT ELIGIBLE** - ${report.hard_stops.length} hard stop(s)\n\n`;
  }

  if (report.hard_stops.length > 0) {
    output += `**🚫 Hard Stops (Must Fix):**\n`;
    report.hard_stops.forEach((r) => {
      output += `- **${r.rule.title}**: ${r.failure_reason}\n`;
      if (r.suggested_fixes && r.suggested_fixes.length > 0) {
        r.suggested_fixes.forEach((fix) => {
          output += `  → Fix: ${fix.fix}\n`;
        });
      }
    });
    output += `\n`;
  }

  if (report.mitigations_required.length > 0) {
    output += `**⚠️ Mitigations Required:**\n`;
    report.mitigations_required.forEach((r) => {
      output += `- **${r.rule.title}**: ${r.failure_reason}\n`;
    });
    output += `\n`;
  }

  if (report.advisories.length > 0) {
    output += `**ℹ️ Advisory Items:**\n`;
    report.advisories.forEach((r) => {
      output += `- ${r.rule.title}\n`;
    });
    output += `\n`;
  }

  output += `**✅ Passed Rules:** ${report.passed_rules.length}\n`;

  return output;
}
