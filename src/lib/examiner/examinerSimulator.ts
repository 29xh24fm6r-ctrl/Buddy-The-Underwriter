export function simulateExaminerReview(events: any[]) {
  const flags: string[] = [];

  if (!events.some(e => e.kind === "etran.package.generated")) {
    flags.push("E-Tran package not generated");
  }

  if (!events.some(e => e.kind === "facts.ingested")) {
    flags.push("Source documents not verified");
  }

  return {
    risk_level: flags.length ? "MODERATE" : "LOW",
    flags
  };
}
