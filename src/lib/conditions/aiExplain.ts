// AI Condition Explainer
// CRITICAL: AI explains state, NEVER decides it

export type ConditionWithStatus = {
  id: string;
  title: string;
  description?: string;
  severity: "REQUIRED" | "IMPORTANT" | "FYI";
  source: "SBA" | "BANK" | "AI" | "REGULATORY";
  satisfied: boolean;
  evidence?: any[];
  reason?: string;
};

export function aiExplainCondition(
  condition: ConditionWithStatus,
  ctx: { attachments: any[]; requirements?: any; preflight?: any }
): string {
  // If satisfied, explain what resolved it
  if (condition.satisfied) {
    return generateSatisfiedExplanation(condition);
  }

  // If not satisfied, explain what's needed
  return generateOutstandingExplanation(condition, ctx);
}

function generateSatisfiedExplanation(condition: ConditionWithStatus): string {
  const baseExplanations: Record<string, string> = {
    SBA: "This SBA requirement has been satisfied. The required documentation was received and verified against SBA standards.",
    BANK: "This bank requirement has been completed. All necessary information has been collected and reviewed.",
    REGULATORY: "This regulatory requirement has been met. Compliance documentation is on file.",
    AI: "Based on the information provided, this item appears to be addressed. Please verify with your underwriter.",
  };

  const base = baseExplanations[condition.source] || "This condition has been satisfied.";

  // Add evidence details if available
  if (condition.evidence && condition.evidence.length > 0) {
    const docTypes = condition.evidence
      .map((e) => e.doc_type)
      .filter(Boolean)
      .join(", ");
    if (docTypes) {
      return `${base} Documents received: ${docTypes}.`;
    }
  }

  return base;
}

function generateOutstandingExplanation(
  condition: ConditionWithStatus,
  ctx: { attachments: any[]; requirements?: any; preflight?: any }
): string {
  const severity = condition.severity;
  const source = condition.source;

  // Required conditions need clear, actionable guidance
  if (severity === "REQUIRED") {
    if (source === "SBA") {
      return generateSbaGuidance(condition, ctx);
    }
    if (source === "BANK") {
      return generateBankGuidance(condition);
    }
  }

  // Important conditions get helpful context
  if (severity === "IMPORTANT") {
    return `This is an important item that should be addressed to ensure a smooth closing process. ${
      condition.reason || "Please review with your loan officer."
    }`;
  }

  // FYI conditions are informational
  if (severity === "FYI") {
    return `This is informational only and does not block closing. ${
      condition.reason || "Keep this in mind as you prepare for closing."
    }`;
  }

  return condition.reason || "This condition is pending completion.";
}

function generateSbaGuidance(
  condition: ConditionWithStatus,
  ctx: { attachments: any[] }
): string {
  const docType = condition.title;

  // Check if similar docs were uploaded but not classified yet
  const unclassifiedDocs = ctx.attachments.filter(
    (a: any) => !a.meta?.classification || a.meta?.classification?.doc_type === "UNKNOWN"
  );

  if (unclassifiedDocs.length > 0) {
    return `This SBA requirement is still outstanding. ${
      condition.reason || ""
    } Note: You have ${
      unclassifiedDocs.length
    } document(s) that haven't been classified yet - one of these might satisfy this requirement once processed.`;
  }

  return `This SBA requirement is still outstanding. ${
    condition.reason || ""
  } Please upload the required documentation through your borrower portal.`;
}

function generateBankGuidance(condition: ConditionWithStatus): string {
  const title = condition.title.toLowerCase();

  // Contextual guidance based on condition type
  if (title.includes("insurance")) {
    return "Insurance documentation is required before closing. Please provide a certificate of insurance naming the bank as loss payee.";
  }

  if (title.includes("appraisal")) {
    return "A current appraisal is required for this transaction. Your loan officer will order this on your behalf.";
  }

  if (title.includes("title")) {
    return "Title work is in progress. Your loan officer is coordinating with the title company.";
  }

  if (title.includes("credit")) {
    return "Credit analysis is underway. Your application is being reviewed by our underwriting team.";
  }

  return `This bank requirement is pending. ${
    condition.reason || "Your loan officer will provide guidance on next steps."
  }`;
}

// Generate borrower-friendly summary
export function aiGenerateClosingSummary(
  conditions: ConditionWithStatus[],
  readiness: {
    ready: boolean;
    required_remaining: number;
    important_remaining: number;
    completion_pct: number;
  }
): string {
  const { ready, required_remaining, important_remaining, completion_pct } = readiness;

  if (ready) {
    return `🎉 Great news! All required conditions have been satisfied. Your loan is ${completion_pct}% complete and ready to move forward to closing. ${
      important_remaining > 0
        ? `There are ${important_remaining} important item(s) that would be helpful to address before closing.`
        : "Everything looks good!"
    }`;
  }

  if (required_remaining === 1) {
    return `You're almost there! Just 1 more required item to complete. Your loan is ${completion_pct}% ready.`;
  }

  if (required_remaining <= 3) {
    return `You're making great progress! ${required_remaining} required items remaining. Your loan is ${completion_pct}% complete.`;
  }

  return `Your loan application is ${completion_pct}% complete. ${required_remaining} required conditions need to be addressed to move forward to closing.`;
}

// Prioritize conditions for borrower action
export function aiPrioritizeConditions(
  conditions: ConditionWithStatus[]
): ConditionWithStatus[] {
  return conditions
    .filter((c) => !c.satisfied)
    .sort((a, b) => {
      // Required first
      if (a.severity === "REQUIRED" && b.severity !== "REQUIRED") return -1;
      if (a.severity !== "REQUIRED" && b.severity === "REQUIRED") return 1;

      // Then important
      if (a.severity === "IMPORTANT" && b.severity === "FYI") return -1;
      if (a.severity === "FYI" && b.severity === "IMPORTANT") return 1;

      // Within same severity, SBA first
      if (a.source === "SBA" && b.source !== "SBA") return -1;
      if (a.source !== "SBA" && b.source === "SBA") return 1;

      return 0;
    });
}
