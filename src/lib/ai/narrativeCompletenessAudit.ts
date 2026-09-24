import { narrativeCompletenessFindings, type NarrativeRequirements } from "@/lib/brokerage/trident/narrativeAcceptance";
import type { ArtifactSection, ReviewIssue } from "./frontierArtifactFactory";

/** Structural release failures must be repairable even when the AI reviewer misses them. */
export function auditNarrativeCompleteness(sections: ArtifactSection[], requirements?: NarrativeRequirements): ReviewIssue[] {
  return narrativeCompletenessFindings(sections, requirements).map(finding => ({
    sectionKey: finding.key,
    claim: "Required narrative section is incomplete",
    reason: `${finding.key} contains ${finding.words} words; publication requires at least ${finding.minimum} words of plain prose${finding.presentationSafe ? "." : " without serialized model output."}`,
    severity: "critical",
    category: "missing_analysis",
    repairInstruction: `Write at least ${finding.minimum} words of decision-useful plain prose for this section, using only the supplied evidence. Explain supported findings, assumptions, missing evidence and its decision impact. Do not invent facts, pad with filler, include JSON/code fences, or imply that missing evidence has been verified. Preserve authoritative figures and required downside disclosures.`,
  }));
}
