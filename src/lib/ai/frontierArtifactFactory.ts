import "server-only";

import { runRole } from "./gateway";
import type { ArtifactType } from "./artifactVerification";
import type { FlaggedClaim } from "./verify";

export type ArtifactSection = { key: string; text: string };

export type FrontierArtifactResult = {
  sections: ArtifactSection[];
  verdict: "pass" | "flagged";
  flaggedClaims: FlaggedClaim[];
  repaired: boolean;
  reviewPasses: number;
};

type ReviewIssue = {
  sectionKey: string;
  claim: string;
  reason: string;
  severity: "info" | "warning" | "critical";
  category:
    | "unsupported_fact"
    | "numeric_inconsistency"
    | "missing_analysis"
    | "generic_language"
    | "credit_policy"
    | "cross_artifact_conflict";
  repairInstruction: string;
};

const REVIEW_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sectionKey: { type: "string" },
          claim: { type: "string" },
          reason: { type: "string" },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          category: {
            type: "string",
            enum: [
              "unsupported_fact",
              "numeric_inconsistency",
              "missing_analysis",
              "generic_language",
              "credit_policy",
              "cross_artifact_conflict",
            ],
          },
          repairInstruction: { type: "string" },
        },
        required: [
          "sectionKey",
          "claim",
          "reason",
          "severity",
          "category",
          "repairInstruction",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["issues"],
  additionalProperties: false,
};

const REPAIR_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          text: { type: "string" },
        },
        required: ["key", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["sections"],
  additionalProperties: false,
};

const REVIEW_SYSTEM = [
  "You are the independent senior credit officer for an institutional commercial lending platform.",
  "Review the artifact against the immutable evidence and deterministic calculations supplied.",
  "Find unsupported claims, numeric inconsistencies, missing repayment analysis, generic filler, policy gaps, and contradictions between sections.",
  "Do not rewrite the artifact and do not invent facts. Return no issue for a mere stylistic preference.",
  "A pass requires decision-useful, borrower-specific analysis that clearly separates evidence, assumptions, and conclusions.",
].join(" ");

const REPAIR_SYSTEM = [
  "You are Buddy's primary senior commercial underwriter.",
  "Repair the supplied artifact using only the immutable evidence and deterministic calculations.",
  "Follow every repair instruction that is supported by the evidence.",
  "Never invent a number, person, credential, market fact, or policy conclusion.",
  "If evidence is absent, state the limitation concisely instead of filling space.",
  "Return every original section key exactly once, including unchanged sections.",
].join(" ");

function parseIssues(text: string): ReviewIssue[] {
  try {
    const value = JSON.parse(text) as { issues?: ReviewIssue[]; flaggedClaims?: FlaggedClaim[] };
    if (Array.isArray(value.issues)) return value.issues;
    // Backward-compatible with the original fact-checker contract while
    // deployments and tests move to the richer institutional review shape.
    if (Array.isArray(value.flaggedClaims)) {
      return value.flaggedClaims.map((flag) => ({
        sectionKey: "artifact",
        claim: flag.claim,
        reason: flag.reason,
        severity: flag.severity,
        category: "unsupported_fact",
        repairInstruction: `Remove or correct the unsupported claim: ${flag.claim}`,
      }));
    }
    return [];
  } catch {
    return [{
      sectionKey: "artifact",
      claim: "(review output unparseable)",
      reason: "The independent quality review did not return valid structured output.",
      severity: "critical",
      category: "credit_policy",
      repairInstruction: "Regenerate the review before releasing the artifact.",
    }];
  }
}

function parseSections(text: string, original: ArtifactSection[]): ArtifactSection[] | null {
  try {
    const value = JSON.parse(text) as { sections?: ArtifactSection[] };
    if (!Array.isArray(value.sections)) return null;
    const expected = new Set(original.map((section) => section.key));
    const repaired = value.sections.filter(
      (section) => expected.has(section.key) && typeof section.text === "string" && section.text.trim(),
    );
    if (repaired.length !== expected.size || new Set(repaired.map((s) => s.key)).size !== expected.size) {
      return null;
    }
    return repaired;
  } catch {
    return null;
  }
}

async function review(input: {
  artifactType: ArtifactType;
  facts: Record<string, unknown> | string;
  sections: ArtifactSection[];
  dealId: string;
  npiTagged: boolean;
}): Promise<ReviewIssue[]> {
  const result = await runRole("verifier", {
    systemInstruction: REVIEW_SYSTEM,
    prompt: [
      `ARTIFACT TYPE: ${input.artifactType}`,
      "IMMUTABLE EVIDENCE AND CALCULATIONS:",
      typeof input.facts === "string" ? input.facts : JSON.stringify(input.facts, null, 2),
      "ARTIFACT SECTIONS:",
      JSON.stringify(input.sections, null, 2),
      "Return all material issues. Return an empty issues array only if this is release-ready.",
    ].join("\n\n"),
    responseSchema: REVIEW_SCHEMA,
    purpose: `${input.artifactType}_institutional_review`,
    dealId: input.dealId,
    npiTagged: input.npiTagged,
    maxOutputTokens: 8192,
    // Keep the release review inside the synchronous artifact route's wall
    // clock budget. A slow reviewer must fail closed as a flagged artifact,
    // not consume the entire Vercel function lifetime.
    timeoutMs: 60_000,
  });
  return parseIssues(result.text);
}

/**
 * Three-model artifact finishing lane. Gemini produces/evidences the initial
 * artifact upstream; Claude independently reviews it; GPT repairs only the
 * diagnosed defects; Claude then performs the release review. Human work is
 * reserved for issues that survive the repair cycle.
 */
export async function finishInstitutionalArtifact(input: {
  artifactType: ArtifactType;
  facts: Record<string, unknown> | string;
  sections: ArtifactSection[];
  dealId: string;
  npiTagged?: boolean;
}): Promise<FrontierArtifactResult> {
  const npiTagged = input.npiTagged ?? true;
  const firstIssues = await review({ ...input, npiTagged });
  const actionable = firstIssues.filter((issue) => issue.severity !== "info");
  if (actionable.length === 0) {
    return { sections: input.sections, verdict: "pass", flaggedClaims: [], repaired: false, reviewPasses: 1 };
  }

  let repair;
  try {
    repair = await runRole("underwriter", {
    systemInstruction: REPAIR_SYSTEM,
    prompt: [
      `ARTIFACT TYPE: ${input.artifactType}`,
      "IMMUTABLE EVIDENCE AND CALCULATIONS:",
      typeof input.facts === "string" ? input.facts : JSON.stringify(input.facts, null, 2),
      "CURRENT SECTIONS:",
      JSON.stringify(input.sections, null, 2),
      "INDEPENDENT REVIEW FINDINGS:",
      JSON.stringify(actionable, null, 2),
      "Return the complete repaired section set.",
    ].join("\n\n"),
    responseSchema: REPAIR_SCHEMA,
    purpose: `${input.artifactType}_targeted_repair`,
    dealId: input.dealId,
    npiTagged,
    maxOutputTokens: 8_192,
    timeoutMs: 75_000,
    });
  } catch {
    return {
      sections: input.sections,
      verdict: "flagged",
      flaggedClaims: actionable.map(({ claim, reason, severity }) => ({ claim, reason, severity })),
      repaired: false,
      reviewPasses: 1,
    };
  }

  const repairedSections = parseSections(repair.text, input.sections);
  if (!repairedSections) {
    return {
      sections: input.sections,
      verdict: "flagged",
      flaggedClaims: [{
        claim: "(artifact repair output invalid)",
        reason: "The automated repair did not preserve the complete artifact section contract.",
        severity: "critical",
      }],
      repaired: false,
      reviewPasses: 1,
    };
  }

  const finalIssues = await review({ ...input, sections: repairedSections, npiTagged });
  const remaining = finalIssues.filter((issue) => issue.severity !== "info");
  return {
    sections: repairedSections,
    verdict: remaining.length ? "flagged" : "pass",
    flaggedClaims: remaining.map(({ claim, reason, severity }) => ({ claim, reason, severity })),
    repaired: true,
    reviewPasses: 2,
  };
}
