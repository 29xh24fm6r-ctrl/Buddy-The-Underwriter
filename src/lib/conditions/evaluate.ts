// Deterministic Condition Evaluator
// PRIME DIRECTIVE: AI explains, but rules decide

export type ConditionEvaluationResult = {
  satisfied: boolean;
  evidence?: any[];
  reason?: string;
  auto_resolved?: boolean;
};

export type EvaluationContext = {
  attachments: any[];
  requirements?: any;
  preflight?: any;
  eligibility?: any;
  forms?: any;
};

export function evaluateCondition(
  condition: any,
  ctx: EvaluationContext
): ConditionEvaluationResult {
  // SBA-sourced conditions: Check for required document evidence
  if (condition.source === "SBA") {
    return evaluateSbaCondition(condition, ctx);
  }

  // Bank-specific conditions: Custom bank requirements
  if (condition.source === "BANK") {
    return evaluateBankCondition(condition, ctx);
  }

  // AI-detected conditions: Derived from patterns
  if (condition.source === "AI") {
    return evaluateAiCondition(condition, ctx);
  }

  // Default: Not satisfied
  return { satisfied: false, reason: "Condition type not recognized" };
}

function evaluateSbaCondition(
  condition: any,
  ctx: EvaluationContext
): ConditionEvaluationResult {
  const requiredDocType = condition.evidence?.doc_type;
  const requiredTaxYear = condition.evidence?.tax_year;

  if (!requiredDocType) {
    return { satisfied: false, reason: "No document type specified" };
  }

  // Find matching documents
  const matchedDocs = ctx.attachments.filter((a: any) => {
    const classification = a.meta?.classification;
    if (!classification) return false;

    // Check document type match
    const typeMatch = classification.doc_type === requiredDocType;
    if (!typeMatch) return false;

    // If tax year required, check it too
    if (requiredTaxYear) {
      return classification.tax_year === requiredTaxYear;
    }

    return true;
  });

  if (matchedDocs.length > 0) {
    return {
      satisfied: true,
      evidence: matchedDocs.map((d) => ({
        attachment_id: d.id,
        doc_type: d.meta?.classification?.doc_type,
        tax_year: d.meta?.classification?.tax_year,
        received_at: d.uploaded_at,
      })),
      reason: `Required document received: ${requiredDocType}${
        requiredTaxYear ? ` (${requiredTaxYear})` : ""
      }`,
      auto_resolved: true,
    };
  }

  return {
    satisfied: false,
    reason: `Awaiting document: ${requiredDocType}${
      requiredTaxYear ? ` for tax year ${requiredTaxYear}` : ""
    }`,
  };
}

function evaluateBankCondition(
  condition: any,
  ctx: EvaluationContext
): ConditionEvaluationResult {
  // Bank-specific logic based on condition code
  const code = condition.condition_code;

  // Example: Credit approval
  if (code === "CREDIT_APPROVAL") {
    // Check if credit memo generated and preflight passed
    const passed = ctx.preflight?.passed ?? false;
    return {
      satisfied: passed,
      reason: passed
        ? "Credit analysis completed and passed"
        : "Credit analysis in progress",
    };
  }

  // Example: Insurance certificate
  if (code === "INSURANCE_CERT") {
    const insuranceDocs = ctx.attachments.filter(
      (a: any) => a.meta?.classification?.doc_type === "INSURANCE_CERTIFICATE"
    );
    return {
      satisfied: insuranceDocs.length > 0,
      evidence: insuranceDocs,
      reason:
        insuranceDocs.length > 0
          ? "Insurance certificate received"
          : "Awaiting insurance certificate",
    };
  }

  return { satisfied: false, reason: "Bank condition pending review" };
}

function evaluateAiCondition(
  condition: any,
  ctx: EvaluationContext
): ConditionEvaluationResult {
  // AI-detected conditions are always informational
  // They help guide but don't block
  return {
    satisfied: false,
    reason: "AI-detected condition - requires human review",
  };
}

// Batch evaluate all conditions for an application
export function evaluateAllConditions(
  conditions: any[],
  ctx: EvaluationContext
): Map<string, ConditionEvaluationResult> {
  const results = new Map<string, ConditionEvaluationResult>();

  for (const condition of conditions) {
    results.set(condition.id, evaluateCondition(condition, ctx));
  }

  return results;
}

// Calculate overall closing readiness
export function calculateClosingReadiness(
  conditions: any[],
  evaluations: Map<string, ConditionEvaluationResult>
): {
  ready: boolean;
  required_remaining: number;
  important_remaining: number;
  total_remaining: number;
  completion_pct: number;
} {
  let requiredRemaining = 0;
  let importantRemaining = 0;
  let totalRemaining = 0;

  for (const condition of conditions) {
    const evaluation = evaluations.get(condition.id);
    if (!evaluation?.satisfied) {
      totalRemaining++;
      if (condition.severity === "REQUIRED") requiredRemaining++;
      if (condition.severity === "IMPORTANT") importantRemaining++;
    }
  }

  const totalConditions = conditions.length;
  const satisfied = totalConditions - totalRemaining;
  const completionPct = totalConditions > 0 ? (satisfied / totalConditions) * 100 : 0;

  return {
    ready: requiredRemaining === 0,
    required_remaining: requiredRemaining,
    important_remaining: importantRemaining,
    total_remaining: totalRemaining,
    completion_pct: Math.round(completionPct),
  };
}
