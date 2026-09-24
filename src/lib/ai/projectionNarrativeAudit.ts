import type { ArtifactSection, ReviewIssue } from "./frontierArtifactFactory";
import { savedFundingSchedule } from "./protectedFundingSchedule";
import { downsideDisclosure, BASE_CASE_LIMITATION } from "./packageNarrativeEvidence";

/** Mechanical coverage check, independent of the model review's severity
 * judgement. It never computes projections or invents a policy threshold. */
export function auditProjectionNarrative(factsInput: Record<string, unknown> | string, sections: ArtifactSection[]): ReviewIssue[] {
  let facts: any;
  try { facts = typeof factsInput === "string" ? JSON.parse(factsInput) : factsInput; } catch { return []; }
  const scenarios = facts?.authoritativeFinancials?.projectionModel?.sensitivityScenarios ?? facts?.projectionPackage?.sensitivityScenarios ?? facts?.sensitivity_scenarios ?? facts?.sensitivityScenarios;
  if (!Array.isArray(scenarios)) return [];
  const downside = scenarios.find((s: any) => s?.name === "downside");
  if (!downside || downside.passesSBAThreshold !== false) return [];
  const values = [downside.dscrYear1, downside.dscrYear2, downside.dscrYear3];
  if (!values.every((v: unknown) => typeof v === "number" && Number.isFinite(v))) return [];
  const disclosure = downsideDisclosure(scenarios);
  return sections.filter(s => /recommendation|executive|financial|risk|repayment|income_analysis|sensitivity|projections_assumptions/i.test(s.key) ||
    /\b(?:DSCR|debt.service coverage|margin.of.safety|repayment (?:capacity|strength)|financial resilience)\b/i.test(s.text)).flatMap(section => {
    const hasNumbers = values.every((v: number) => new RegExp(`(?<![\\d.])${v.toFixed(2).replace(".", "\\.")}(?!\\d)`).test(section.text));
    const hasFailure = /(?:downside|stress)[^.\n]*(?:fail|below|breach|shortfall|insufficient|not\s+(?:meet|cover)|cannot\s+(?:meet|cover))|(?:fail|below|breach|shortfall|insufficient)[^.\n]*(?:coverage|debt service)/i.test(section.text);
    return hasNumbers && hasFailure ? [] : [{ sectionKey: section.key, claim: "Incomplete downside repayment disclosure",
      reason: "The canonical downside scenario fails coverage. Decision sections must disclose the three-year path rather than relying on the first year.",
      severity: "critical" as const, category: "missing_analysis" as const,
      repairInstruction: `Include this authoritative disclosure and reconcile the surrounding recommendation with it: ${disclosure} ${BASE_CASE_LIMITATION} Preserve all source figures.` }];
  });
}

/** An operations funding allocation must contain a complete, labeled schedule.
 * Exact anchors avoid accepting a repeated amount under the wrong use (or an
 * unrelated payroll number as the missing working-capital allocation). */
export function auditFundingNarrative(factsInput: Record<string, unknown> | string, sections: ArtifactSection[]): ReviewIssue[] {
  const anchor = savedFundingSchedule(factsInput);
  if (!anchor) return [];
  const normalize = (text: string) => text.replace(/\*|_/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return sections.filter(section => section.key === "operations_plan" && !normalize(section.text).includes(normalize(anchor))).map(section => ({
    sectionKey: section.key, claim: "Incomplete or mislabeled operations funding allocation",
    reason: "The operations plan must reconcile every saved source and use, including working capital, with its original label and total.",
    severity: "critical", category: "numeric_inconsistency",
    repairInstruction: `Correct the funding paragraph and include this complete authoritative schedule verbatim: ${anchor} Remove conflicting amounts or generic labels elsewhere in this section. Preserve illustrative or unverified qualifications in the source labels.`,
  }));
}
