import "server-only";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — the projections-assumptions narrative, the
 * one net-new artifact in this spec (the other three — credit memo,
 * business plan, feasibility — already had generators; this one didn't).
 *
 * Mirrors the M3 glass-box two-call template exactly: a `generator`-role
 * call narrates the deal's CURRENT (override: null) B4.1.3/4 methodology
 * projection — projectDscrForVariant's output, including its own
 * already-human-readable `components` summary, which already states
 * whether the officer-comp add-back was folded, subsumed by the
 * guaranteed-payments add-back, or left observational — as immutable facts
 * (Program Invariant #1: never recompute anything here, including the
 * fold-in decision itself, which projectDscrForVariant already delegates
 * to applyOfficerCompFoldIn with its own guaranteed-payments double-count
 * guard; re-deriving that decision here would risk drifting from it). A
 * separate verifyArtifactAndFlag
 * call then independently fact-checks the narrative; any critical flag
 * degrades the whole artifact (no Frankenstein narratives) and opens a
 * banker task via the shared helper.
 *
 * Only the deal's current effective slate is narrated, not every axis
 * variant the methodology picker preview shows — narrating all variants
 * would multiply the generator+verifier call count per axis and blow the
 * route-budget/cost invariants for no real benefit (a banker reads one
 * narrative for the slate that's actually in effect).
 */
// ai-disclaimer-surface: memo — enforced by scripts/guards/guard-ai-disclaimer.mjs

import { runRole } from "@/lib/ai/gateway";
import { getDisclaimer } from "@/lib/ai/disclaimers";
import { finishInstitutionalArtifact } from "@/lib/ai/frontierArtifactFactory";
import { persistArtifactFlags } from "@/lib/ai/artifactVerification";
import { loadProjectionInputsForDeal } from "@/lib/methodology/loadProjectionInputs";
import { projectDscrForVariant } from "@/lib/methodology/projectDscrForVariant";

type SB = { from: (t: string) => any };

export type ProjectionsAssumptionsNarrative =
  | { status: "unavailable"; message: string }
  | { status: "degraded"; message: string; disclaimer: string }
  | { status: "ready"; narrative: string; disclaimer: string };

const GENERATOR_SYSTEM_INSTRUCTION =
  "You are narrating a commercial loan's debt-service-coverage projection " +
  "for a bank underwriter. You are given a set of immutable, already-" +
  "computed figures (EBITDA, officer-compensation add-back treatment, " +
  "NCADS, proposed annual debt service, and the resulting projected DSCR) " +
  "and the methodology choices behind them. Explain, in plain professional " +
  "English, what was computed and why the officer-compensation add-back " +
  "was or wasn't folded into cash flow available for debt service. Use " +
  "only the exact figures and methodology labels given — never invent a " +
  "number, never recompute anything, and never state or imply a credit " +
  "decision or approval.";

const NARRATIVE_SCHEMA = {
  type: "object",
  properties: {
    narrative: { type: "string" },
  },
  required: ["narrative"],
  additionalProperties: false,
} as const;

function buildPrompt(facts: Record<string, unknown>): string {
  return [
    "FACTS (immutable, already computed — do not question or recompute these):",
    JSON.stringify(facts, null, 2),
    "",
    "Write a short (3-5 sentence) narrative explaining this DSCR projection " +
      "and the officer-compensation fold-in treatment to a bank underwriter.",
  ].join("\n");
}

export async function generateProjectionsAssumptionsNarrative(
  dealId: string,
  bankId: string,
  sb: SB,
): Promise<ProjectionsAssumptionsNarrative> {
  const inputs = await loadProjectionInputsForDeal(dealId, bankId, sb);
  if (!inputs.projectable) {
    return { status: "unavailable", message: inputs.reason };
  }
  const { facts: taxFacts, formType, currentSlate, proposedAds } = inputs;

  const projection = projectDscrForVariant({
    facts: taxFacts,
    formType,
    currentSlate,
    override: null,
    proposedAds,
  });

  const facts: Record<string, unknown> = {
    methodologySlate: currentSlate,
    formType,
    projectedEbitda: projection.projectedEbitda,
    projectedOfficerCompAddback: projection.projectedOfficerCompAddback,
    projectedNcads: projection.projectedNcads,
    proposedAnnualDebtService: proposedAds,
    projectedDscr: projection.projectedDscr,
    components: projection.components,
  };

  try {
    const generated = await runRole("underwriter", {
      prompt: buildPrompt(facts),
      systemInstruction: GENERATOR_SYSTEM_INSTRUCTION,
      responseSchema: NARRATIVE_SCHEMA,
      purpose: "projections_assumptions_narrate",
      dealId,
      npiTagged: true,
    });

    const parsed = JSON.parse(generated.text) as { narrative?: string };
    const draftText = typeof parsed.narrative === "string" ? parsed.narrative : "";

    if (!draftText) {
      return {
        status: "degraded",
        message: "We couldn't generate a projections narrative just now.",
        disclaimer: getDisclaimer("memo"),
      };
    }

    const finished = await finishInstitutionalArtifact({
      dealId,
      artifactType: "projections_assumptions",
      facts,
      sections: [{ key: "dscr_stack", text: draftText }],
      npiTagged: true,
    });
    await persistArtifactFlags({
      dealId, bankId, artifactType: "projections_assumptions", sectionKey: "dscr_stack",
      flaggedClaims: finished.flaggedClaims, sb,
    });

    const hasCriticalFlag = finished.flaggedClaims.some((f) => f.severity === "critical");
    if (finished.verdict === "flagged" && hasCriticalFlag) {
      return {
        status: "degraded",
        message: "We're double-checking this projections narrative before showing it to you.",
        disclaimer: getDisclaimer("memo"),
      };
    }

    return {
      status: "ready",
      narrative: finished.sections[0]?.text ?? draftText,
      disclaimer: getDisclaimer("memo"),
    };
  } catch (err) {
    console.error("[projections-assumptions] generator/verifier call failed:", err);
    return {
      status: "degraded",
      message: "We couldn't generate a projections narrative just now.",
      disclaimer: getDisclaimer("memo"),
    };
  }
}
