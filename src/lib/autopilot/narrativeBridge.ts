import "server-only";

import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import { assembleNarratives } from "@/lib/creditMemo/canonical/narrativeAssembly";
import type { AssembleNarrativesResult } from "@/lib/creditMemo/canonical/narrativeAssembly";

export type NarrativeBridgeResult = {
  ok: boolean;
  memo_built: boolean;
  narrative_sections_generated: number;
  narrative_ai_error?: string;
  message: string;
};

/**
 * S8 pipeline stage: bridges the truth-snapshot pipeline to the existing,
 * mature canonical credit-memo system (buildCanonicalCreditMemo +
 * assembleNarratives) instead of building new "narrative"/"evidence" Agent
 * subclasses — those placeholder types in agents/types.ts describe a
 * different, unimplemented concept from what this bridge wires up.
 *
 * Deliberately does NOT re-run evaluateMemoInputReadiness's full gate here:
 * that evaluator needs financial-facts/research/conflict data assembled by
 * buildMemoInputPackage, which resolves its bank scope via
 * ensureDealBankAccess — a Clerk-session-gated helper with ~220 call sites
 * across the app. Re-deriving that data without auth, or adding an
 * auth-bypass to a security-sensitive shared helper, is out of scope for
 * this bridge. buildCanonicalCreditMemo already degrades gracefully
 * (Principle #16: null fields render as "Pending —" placeholders, not
 * fabricated values) when memo inputs are incomplete, so an autopilot-
 * triggered narrative draft is still safe to produce; the banker-facing
 * memo-inputs completeness gate remains the authority for what's required
 * before a memo can actually be submitted to underwriting.
 */
export async function runNarrativeBridge(
  dealId: string,
  bankId: string,
  deps: {
    buildMemo?: typeof buildCanonicalCreditMemo;
    assembleNarr?: (args: { memo: any }) => Promise<AssembleNarrativesResult>;
  } = {},
): Promise<NarrativeBridgeResult> {
  const buildMemo = deps.buildMemo ?? buildCanonicalCreditMemo;
  const assembleNarr = deps.assembleNarr ?? assembleNarratives;

  const memoResult = await buildMemo({ dealId, bankId, renderMode: "internal_diagnostic" });

  if (!memoResult.ok) {
    return {
      ok: false,
      memo_built: false,
      narrative_sections_generated: 0,
      message: `Memo build failed: ${memoResult.error}`,
    };
  }

  const narrativeResult = await assembleNarr({ memo: memoResult.memo });
  const sectionsGenerated = Object.keys(narrativeResult.narratives).length;

  return {
    ok: !narrativeResult.aiError,
    memo_built: true,
    narrative_sections_generated: sectionsGenerated,
    narrative_ai_error: narrativeResult.aiError,
    message: narrativeResult.aiError
      ? `Memo built; narrative generation fell back due to: ${narrativeResult.aiError}`
      : `Memo built with ${sectionsGenerated} narrative section(s) generated`,
  };
}
