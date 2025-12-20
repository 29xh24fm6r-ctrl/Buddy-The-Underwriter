import { PolicyRuleRow, RuleEvaluation, UWContext } from "./types";
import { evalPredicate } from "./predicateEngine";

function scopeApplies(scope: any, ctx: UWContext): boolean {
  if (!scope || typeof scope !== "object") return true;
  for (const k of Object.keys(scope)) {
    const allowed = scope[k];
    const val = (ctx as any)[k];
    if (Array.isArray(allowed) && allowed.length > 0) {
      if (!allowed.includes(val)) return false;
    }
  }
  return true;
}

function normalizeMitigants(x: any): RuleEvaluation["mitigants"] {
  if (!Array.isArray(x)) return [];
  return x
    .map((m) => ({
      key: String(m?.key || "").trim(),
      label: String(m?.label || "").trim(),
      priority: m?.priority !== undefined ? Number(m.priority) : undefined,
      note: m?.note ? String(m.note) : undefined,
    }))
    .filter((m) => m.key && m.label);
}

export function evaluateRules(
  rules: PolicyRuleRow[],
  ctx: UWContext,
  evidenceByRuleId: Record<string, RuleEvaluation["evidence"]>
): RuleEvaluation[] {
  const out: RuleEvaluation[] = [];

  for (const r of rules) {
    if (!r.active) continue;
    if (!scopeApplies(r.scope, ctx)) continue;

    const hit = evalPredicate(r.predicate, ctx);

    const d = r.decision || {};
    const triggeredResult = (d.result || "warn") as RuleEvaluation["result"]; // default warn
    const result: RuleEvaluation["result"] = hit ? triggeredResult : "pass";

    const message =
      hit
        ? String(d.message || r.title || "Policy rule triggered")
        : String(d.pass_message || "Pass");

    // Warn+continue:
    // - "suggests_exception" only if decision requests it OR severity hard + fail
    const suggests_exception = Boolean(
      hit && (d.requires_exception || (r.severity === "hard" && triggeredResult === "fail"))
    );

    const mitigants = hit ? normalizeMitigants((r as any).mitigants) : [];

    out.push({
      rule_id: r.id,
      rule_key: r.rule_key,
      title: r.title,
      severity: r.severity,
      result,
      message,
      suggests_exception,
      mitigants,
      evidence: evidenceByRuleId[r.id] || [],
    });
  }

  return out;
}
