/**
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1 — Phase 7
 *
 * Competitor source-support adapter. For competitors NAMED in the competitive
 * research claims, emit a per-competitor source candidate (manual URL path).
 * Status stays needs_review until accepted; competitor claims without sources
 * remain caveated. NEVER fabricates competitor facts — it only derives the
 * competitor NAME from the existing claim and proposes how to source it.
 * Pure module.
 */

import type { EvidenceRowInput } from "../committeeBlockerResolution";
import type { SourceCandidate } from "./types";

/** Pull a likely competitor display name from the head of a competitive claim. */
function competitorNameFromClaim(claim: string): string | null {
  const head = claim.split(/[:.\n]/)[0].trim();
  if (head.length < 2 || head.length > 80) return null;
  // Reject obviously narrative heads (sentences), keep short proper-noun-ish names.
  if (/\s(is|are|provides|offers|competes|specializ|with|the)\b/i.test(head)) return null;
  return head;
}

export function planCompetitorSources(
  competitiveRows: EvidenceRowInput[],
  maxCompetitors = 6,
): SourceCandidate[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const r of competitiveRows ?? []) {
    const name = competitorNameFromClaim((r.claim ?? "").trim());
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      names.push(name);
    }
    if (names.length >= maxCompetitors) break;
  }

  if (names.length === 0) {
    // Named competitors not cleanly parseable → one grouped candidate.
    if ((competitiveRows ?? []).some((r) => (r.claim ?? "").trim().length > 0)) {
      return [
        {
          label: "Competitive source support (grouped)",
          source_url: null,
          source_type: "company_primary",
          recommended_for_sections: ["Competitive Landscape"],
          requirement_keys: ["competitive_support"],
          rationale: "Attach a verifiable source (competitor website / press / trade publication) for the named competitors, or mark the competitive analysis analyst-accepted / caveated.",
          limitations: ["Competitor claims without a source remain caveated; never auto-accepted."],
        },
      ];
    }
    return [];
  }

  return names.map((name) => ({
    label: `Source support for competitor: ${name}`,
    source_url: null,
    source_type: "company_primary",
    recommended_for_sections: ["Competitive Landscape"],
    requirement_keys: ["competitive_support"],
    rationale: `Attach a verifiable source for the named competitor "${name}" (its website / press / trade publication), or caveat the claim.`,
    limitations: [
      "Competitor name derived from the research claim — verify before reliance.",
      "Claim remains needs_review / caveated until a source is attached and analyst-accepted.",
    ],
  }));
}
