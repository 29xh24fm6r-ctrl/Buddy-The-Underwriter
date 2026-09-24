import { fundingScheduleText } from "./packageNarrativeEvidence";

const FUNDING_HEADING = "\n\nFunding schedule (saved assumptions):\n";

/** The appended schedule is evidence, not generated analysis or word-count filler. */
export function withoutProtectedFundingSchedule(text: string): string {
  return text.split(FUNDING_HEADING)[0];
}

export function savedFundingSchedule(factsInput: Record<string, unknown> | string): string | null {
  let facts: any;
  try { facts = typeof factsInput === "string" ? JSON.parse(factsInput) : factsInput; } catch { return null; }
  const schedule = facts?.authoritativeFinancials?.sourcesAndUses ?? facts?.sources_and_uses ?? facts?.projectionPackage?.sourcesAndUses ?? facts?.sourcesAndUses;
  if (!schedule || !Array.isArray(schedule.sources) || !Array.isArray(schedule.uses) ||
      ![schedule.totalSources, schedule.totalUses].every(Number.isFinite) ||
      ![...schedule.sources, ...schedule.uses].every(row => typeof row.label === "string" && Number.isFinite(row.amount))) return null;
  return fundingScheduleText(schedule);
}

/** Restore exact source evidence before every review and after every rewrite.
 * Conflicting claims in the surrounding prose remain subject to review. */
export function protectFundingSchedule<T extends { key: string; text: string }>(facts: Record<string, unknown> | string, sections: T[]): T[] {
  const schedule = savedFundingSchedule(facts);
  if (!schedule) return sections;
  return sections.map(section => section.key === "operations_plan"
    ? { ...section, text: `${withoutProtectedFundingSchedule(section.text).trim()}${FUNDING_HEADING}${schedule}` }
    : section);
}
