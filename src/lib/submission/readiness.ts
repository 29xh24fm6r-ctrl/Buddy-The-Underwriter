export function computeSubmissionReadiness(input: {
  preflight: any;
  forms: any;
  narrative: any;
  requirements: any;
}) {
  const blockers: string[] = [];

  if (!input.preflight?.passed) {
    blockers.push("Preflight failed - resolve blocking issues");
  }

  if (input.forms?.status !== "READY") {
    blockers.push("Forms validation failed - fix form errors");
  }

  const missingDocs = input.requirements?.summary?.required_missing ?? 0;
  if (missingDocs > 0) {
    blockers.push(`Missing ${missingDocs} required document(s)`);
  }

  if (!input.narrative || Object.keys(input.narrative).length === 0) {
    blockers.push("Credit narrative not generated");
  }

  const score = input.preflight?.score ?? 0;
  const readinessLevel = 
    score >= 90 ? "EXCELLENT" :
    score >= 75 ? "GOOD" :
    score >= 50 ? "FAIR" : "POOR";

  return {
    ready: blockers.length === 0,
    blockers,
    score,
    readinessLevel,
  };
}
