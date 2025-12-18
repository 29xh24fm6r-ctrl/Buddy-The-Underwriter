export type AgentRecommendation = {
  agent: string;
  action: string;
  recommendation: any;
  confidence: number;
  requires_approval: boolean;
};

export async function runAgents(input: {
  application_id: string;
  preflight: any;
  requirements: any;
  forms: any;
}): Promise<AgentRecommendation[]> {
  const recommendations: AgentRecommendation[] = [];

  // 1. Preflight Watchdog Agent
  if (!input.preflight?.passed) {
    const blockingIssues = input.preflight?.blocking_issues ?? [];
    
    recommendations.push({
      agent: "PreflightWatchdog",
      action: "Recommend fixes for blocking issues",
      recommendation: {
        issues: blockingIssues.map((issue: any) => ({
          code: issue.code,
          message: issue.message,
          how_to_fix: issue.how_to_fix,
          sop_citation: issue.sop?.citation,
        })),
        priority: "HIGH",
      },
      confidence: 1.0,
      requires_approval: false,
    });
  }

  // 2. Document Completeness Agent
  const missingDocs = input.requirements?.summary?.required_missing ?? 0;
  if (missingDocs > 0) {
    const missingItems = input.requirements?.requirements
      ?.filter((r: any) => r.required && r.status === "MISSING")
      .slice(0, 5);

    recommendations.push({
      agent: "DocumentCompletenessAgent",
      action: "Request missing required documents",
      recommendation: {
        missing_count: missingDocs,
        missing_items: missingItems?.map((item: any) => ({
          id: item.id,
          title: item.title,
          doc_types: item.doc_types,
        })),
        priority: "MEDIUM",
      },
      confidence: 1.0,
      requires_approval: false,
    });
  }

  // 3. Forms Quality Agent
  const formErrors = input.forms?.validation_errors?.filter((e: any) => e.severity === "ERROR") ?? [];
  if (formErrors.length > 0) {
    recommendations.push({
      agent: "FormsQualityAgent",
      action: "Request form corrections",
      recommendation: {
        error_count: formErrors.length,
        errors: formErrors.slice(0, 5).map((e: any) => ({
          path: e.path,
          message: e.message,
        })),
        priority: "HIGH",
      },
      confidence: 1.0,
      requires_approval: false,
    });
  }

  // 4. SBA Optimization Agent (Low confidence, requires approval)
  const score = input.preflight?.score ?? 0;
  if (score >= 75 && score < 90) {
    recommendations.push({
      agent: "SBAOptimizationAgent",
      action: "Suggest improvements to increase readiness score",
      recommendation: {
        current_score: score,
        target_score: 90,
        suggestions: [
          "Review and resolve all warnings in preflight results",
          "Ensure all optional documents are provided for stronger application",
          "Verify business name consistency across all documents",
        ],
        priority: "LOW",
      },
      confidence: 0.7,
      requires_approval: true,
    });
  }

  // 5. Auto-Approval Agent (NEVER auto-submits, only recommends)
  if (input.preflight?.passed && missingDocs === 0 && formErrors.length === 0 && score >= 90) {
    recommendations.push({
      agent: "AutoApprovalAgent",
      action: "Recommend for underwriter review",
      recommendation: {
        readiness: "EXCELLENT",
        score,
        all_checks_passed: true,
        message: "Application meets all SBA requirements and is ready for underwriter review.",
        priority: "INFO",
      },
      confidence: 0.95,
      requires_approval: true, // CRITICAL: Never auto-approve
    });
  }

  return recommendations;
}
