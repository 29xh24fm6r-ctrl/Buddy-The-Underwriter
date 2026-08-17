import "server-only";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — verifier pass for the EXISTING credit-memo
 * narrative pipeline (narrativeAssembly.ts). That generator is untouched —
 * it already makes exactly one aiJson call per (deal, input_hash) and
 * caches the result (Invariant #4: exactly one generator per artifact).
 * This adds the "at most one verifier" half: one verifyArtifactAndFlag
 * call across the whole narrative bundle, using the same deterministic
 * facts (buildNarrativeInput's output) the generator itself was given —
 * never the narrative text as its own "fact."
 *
 * Skips verification entirely when generation fell back to
 * FALLBACK_NARRATIVES — there's no real claim to fact-check in "Narrative
 * generation unavailable."
 */

import type { CanonicalCreditMemoV1 } from "./types";
import { buildNarrativeInput, FALLBACK_NARRATIVES, type MemoNarratives } from "./narrativeAssembly";
import { persistArtifactFlags } from "@/lib/ai/artifactVerification";
import { finishInstitutionalArtifact } from "@/lib/ai/frontierArtifactFactory";

type SB = { from: (t: string) => any };

const SECTION_LABELS: Record<keyof MemoNarratives, string> = {
  executive_summary: "Executive Summary",
  income_analysis: "Income Analysis",
  repayment_analysis: "Repayment Analysis",
  property_description: "Property Description",
  borrower_background: "Borrower Background",
  borrower_experience: "Borrower Experience",
  guarantor_strength: "Guarantor Strength",
};

function isFallback(narratives: MemoNarratives): boolean {
  return (Object.keys(FALLBACK_NARRATIVES) as Array<keyof MemoNarratives>).every(
    (k) => narratives[k] === FALLBACK_NARRATIVES[k],
  );
}

function buildDraftText(narratives: MemoNarratives): string {
  return (Object.keys(SECTION_LABELS) as Array<keyof MemoNarratives>)
    .filter((k) => narratives[k] && narratives[k] !== FALLBACK_NARRATIVES[k])
    .map((k) => `${SECTION_LABELS[k]}:\n${narratives[k]}`)
    .join("\n\n");
}

export async function verifyMemoNarratives(args: {
  dealId: string;
  bankId: string;
  memo: CanonicalCreditMemoV1;
  narratives: MemoNarratives;
  sb: SB;
}): Promise<({
  verdict: "pass" | "flagged";
  flaggedClaims: import("@/lib/ai/verify").FlaggedClaim[];
  conditionsCreated: number;
  conditionsSkipped: number;
  narratives: MemoNarratives;
  repaired: boolean;
}) | null> {
  const { dealId, bankId, memo, narratives, sb } = args;

  if (isFallback(narratives)) return null;

  const draftText = buildDraftText(narratives);
  if (!draftText) return null;

  const facts = buildNarrativeInput(memo);

  const sections = (Object.keys(SECTION_LABELS) as Array<keyof MemoNarratives>).map((key) => ({
    key,
    text: narratives[key],
  }));
  const finished = await finishInstitutionalArtifact({
    dealId, artifactType: "credit_memo", facts, sections, npiTagged: true,
  });
  const conditions = await persistArtifactFlags({
    dealId, bankId, artifactType: "credit_memo", sectionKey: "narratives",
    flaggedClaims: finished.flaggedClaims, sb,
  });
  return {
    verdict: finished.verdict,
    flaggedClaims: finished.flaggedClaims,
    ...conditions,
    narratives: Object.fromEntries(
      finished.sections.map((section) => [section.key, section.text]),
    ) as MemoNarratives,
    repaired: finished.repaired,
  };
}
