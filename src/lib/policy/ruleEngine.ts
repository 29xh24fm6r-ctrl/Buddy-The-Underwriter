/**
 * SBA Rule Engine - JSON Logic Evaluator for Eligibility
 * 
 * Evaluates sba_policy_rules.condition_json against deal facts.
 * 
 * Condition DSL Examples:
 * 
 * Simple equality:
 * { "fact": "business.is_for_profit", "op": "eq", "value": true }
 * 
 * Numeric comparison:
 * { "fact": "financials.dscr", "op": "gte", "value": 1.25 }
 * 
 * Set membership:
 * { "fact": "use_of_proceeds", "op": "in", "value": ["working_capital", "equipment"] }
 * 
 * Logical AND:
 * { "all": [
 *     { "fact": "business.is_for_profit", "op": "eq", "value": true },
 *     { "fact": "business.annual_revenue", "op": "lte", "value": 30000000 }
 *   ]
 * }
 * 
 * Logical OR:
 * { "any": [
 *     { "fact": "business.naics", "op": "starts_with", "value": "11" },
 *     { "fact": "business.naics", "op": "starts_with", "value": "23" }
 *   ]
 * }
 */

// ============================================================================
// Types
// ============================================================================

export interface RuleCondition {
  // Simple condition
  fact?: string;
  op?: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains" | "starts_with" | "exists";
  value?: any;
  
  // Logical combinators
  all?: RuleCondition[];
  any?: RuleCondition[];
  not?: RuleCondition;
}

export interface EvaluationResult {
  result: "PASS" | "FAIL" | "UNKNOWN";
  confidence: number;
  explanation: string;
  missing_facts: string[];
}

// ============================================================================
// Helper: Get nested fact value
// ============================================================================

function getFactValue(facts: Record<string, any>, path: string): any {
  const keys = path.split(".");
  let value = facts;
  
  for (const key of keys) {
    if (value == null || typeof value !== "object") {
      return undefined;
    }
    value = value[key];
  }
  
  return value;
}

// ============================================================================
// Core: Evaluate single condition
// ============================================================================

function evaluateCondition(
  condition: RuleCondition,
  facts: Record<string, any>
): { pass: boolean; missing: string[] } {
  // Logical combinators
  if (condition.all) {
    const results = condition.all.map((c) => evaluateCondition(c, facts));
    const allPass = results.every((r) => r.pass);
    const missing = results.flatMap((r) => r.missing);
    return { pass: allPass, missing };
  }

  if (condition.any) {
    const results = condition.any.map((c) => evaluateCondition(c, facts));
    const anyPass = results.some((r) => r.pass);
    const missing = results.every((r) => r.missing.length > 0)
      ? results[0].missing // If all branches have missing facts, report first
      : [];
    return { pass: anyPass, missing };
  }

  if (condition.not) {
    const result = evaluateCondition(condition.not, facts);
    return { pass: !result.pass, missing: result.missing };
  }

  // Simple condition
  if (!condition.fact) {
    throw new Error("Invalid condition: missing 'fact'");
  }

  const factValue = getFactValue(facts, condition.fact);
  const { op = "eq", value } = condition;

  // Check if fact exists
  if (op === "exists") {
    return { pass: factValue !== undefined, missing: factValue === undefined ? [condition.fact] : [] };
  }

  // If fact is missing, can't evaluate
  if (factValue === undefined) {
    return { pass: false, missing: [condition.fact] };
  }

  // Evaluate operator
  let pass = false;

  switch (op) {
    case "eq":
      pass = factValue === value;
      break;
    case "ne":
      pass = factValue !== value;
      break;
    case "gt":
      pass = factValue > value;
      break;
    case "gte":
      pass = factValue >= value;
      break;
    case "lt":
      pass = factValue < value;
      break;
    case "lte":
      pass = factValue <= value;
      break;
    case "in":
      pass = Array.isArray(value) && value.includes(factValue);
      break;
    case "not_in":
      pass = Array.isArray(value) && !value.includes(factValue);
      break;
    case "contains":
      pass = typeof factValue === "string" && factValue.includes(value);
      break;
    case "starts_with":
      pass = typeof factValue === "string" && factValue.startsWith(value);
      break;
    default:
      throw new Error(`Unknown operator: ${op}`);
  }

  return { pass, missing: [] };
}

// ============================================================================
// Main: Evaluate Rule
// ============================================================================

export function evaluateRule(
  condition: RuleCondition,
  facts: Record<string, any>,
  explanation: string = ""
): EvaluationResult {
  try {
    const { pass, missing } = evaluateCondition(condition, facts);

    if (missing.length > 0) {
      return {
        result: "UNKNOWN",
        confidence: 0,
        explanation: `Cannot determine eligibility. Missing facts: ${missing.join(", ")}`,
        missing_facts: missing,
      };
    }

    return {
      result: pass ? "PASS" : "FAIL",
      confidence: 1.0,
      explanation: pass
        ? explanation || "Rule condition satisfied"
        : explanation || "Rule condition not satisfied",
      missing_facts: [],
    };
  } catch (err) {
    console.error("Rule evaluation error:", err);
    return {
      result: "UNKNOWN",
      confidence: 0,
      explanation: `Evaluation error: ${err instanceof Error ? err.message : String(err)}`,
      missing_facts: [],
    };
  }
}

// ============================================================================
// Batch: Evaluate all rules for a program
// ============================================================================

export async function evaluateAllRules(
  program: "7a" | "504",
  facts: Record<string, any>
): Promise<Record<string, EvaluationResult>> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();

  // Fetch all rules for program
  const { data: rules, error } = await sb
    .from("sba_policy_rules")
    .select("*")
    .eq("program", program);

  if (error) {
    console.error("Failed to load SBA rules:", error);
    return {};
  }

  const results: Record<string, EvaluationResult> = {};

  for (const rule of rules || []) {
    const condition = rule.condition_json as RuleCondition;
    const result = evaluateRule(condition, facts, rule.explanation);
    results[rule.rule_key] = result;
  }

  return results;
}

// ============================================================================
// Helper: Extract missing facts across all rules
// ============================================================================

export function getMissingFacts(
  results: Record<string, EvaluationResult>
): string[] {
  const missing = new Set<string>();
  
  for (const result of Object.values(results)) {
    for (const fact of result.missing_facts) {
      missing.add(fact);
    }
  }
  
  return Array.from(missing);
}

// ============================================================================
// Helper: Prioritize next question (which fact unlocks most rules?)
// ============================================================================

export function getNextCriticalFact(
  results: Record<string, EvaluationResult>
): { fact: string; impact: number } | null {
  const factImpact = new Map<string, number>();

  // Count how many UNKNOWN rules each fact appears in
  for (const result of Object.values(results)) {
    if (result.result === "UNKNOWN") {
      for (const fact of result.missing_facts) {
        factImpact.set(fact, (factImpact.get(fact) || 0) + 1);
      }
    }
  }

  if (factImpact.size === 0) return null;

  // Return fact with highest impact
  const entries = Array.from(factImpact.entries()).sort((a, b) => b[1] - a[1]);
  return { fact: entries[0][0], impact: entries[0][1] };
}
