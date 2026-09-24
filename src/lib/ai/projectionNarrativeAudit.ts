import type { ArtifactSection, ReviewIssue } from "./frontierArtifactFactory";

/** Mechanical coverage check, independent of the model review's severity
 * judgement. It never computes projections or invents a policy threshold. */
export function auditProjectionNarrative(factsInput: Record<string, unknown> | string, sections: ArtifactSection[]): ReviewIssue[] {
  let facts: any;
  try { facts = typeof factsInput === "string" ? JSON.parse(factsInput) : factsInput; } catch { return []; }
  const scenarios = facts?.projectionPackage?.sensitivityScenarios ?? facts?.sensitivity_scenarios;
  if (!Array.isArray(scenarios)) return [];
  const downside = scenarios.find((s: any) => s?.name === "downside");
  if (!downside || downside.passesSBAThreshold !== false) return [];
  const values = [downside.dscrYear1, downside.dscrYear2, downside.dscrYear3];
  if (!values.every((v: unknown) => typeof v === "number" && Number.isFinite(v))) return [];
  const disclosure = `Downside DSCR: Year 1 ${values[0].toFixed(2)}x, Year 2 ${values[1].toFixed(2)}x, Year 3 ${values[2].toFixed(2)}x. The saved downside scenario fails the model's coverage threshold; base-case strength does not eliminate this repayment risk.`;
  return sections.filter(s => /recommendation|executive|financial|risk/i.test(s.key)).flatMap(section => {
    const hasNumbers = values.every((v: number) => new RegExp(`(?<![\\d.])${v.toFixed(2).replace(".", "\\.")}(?!\\d)`).test(section.text));
    const hasFailure = /(?:fail|below|breach|shortfall|insufficient|not\s+(?:meet|cover)|cannot\s+(?:meet|cover))/i.test(section.text);
    return hasNumbers && hasFailure ? [] : [{ sectionKey: section.key, claim: "Incomplete downside repayment disclosure",
      reason: "The canonical downside scenario fails coverage. Decision sections must disclose the three-year path rather than relying on the first year.",
      severity: "critical" as const, category: "missing_analysis" as const,
      repairInstruction: `Include this authoritative disclosure and reconcile the surrounding recommendation with it: ${disclosure} Preserve all source figures and do not describe the downside as robust or viable across the projection period.` }];
  });
}
