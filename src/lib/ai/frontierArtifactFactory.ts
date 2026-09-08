import "server-only";

import { createHash } from "node:crypto";

import { runRole } from "./gateway";
import type { ArtifactType } from "./artifactVerification";
import type { FlaggedClaim } from "./verify";

export type ArtifactSection = { key: string; text: string };

export type FrontierArtifactResult = {
  sections: ArtifactSection[];
  /**
   * "flagged" means a CRITICAL finding survived the repair budget and the
   * artifact must not publish. Surviving warnings do not make an artifact
   * unpublishable — they are disclosed as conditions. See the account of the
   * severity contract above finishInstitutionalArtifact.
   */
  verdict: "pass" | "flagged";
  flaggedClaims: FlaggedClaim[];
  repaired: boolean;
  reviewPasses: number;
  /** Complete structured findings from the terminal independent review. */
  reviewIssues: ReviewIssue[];
  /**
   * Warnings that survived repair. The artifact publishes with these attached
   * as conditions for banker sign-off rather than being discarded.
   */
  advisoryIssues: ReviewIssue[];
  /**
   * Hash of the exact (artifactType, facts, sections) the reviewer saw.
   * Persisted with the verdict so a later run assembling identical content
   * reuses the judgement instead of re-rolling it. See reviewContentHash.
   */
  contentHash: string;
};

export type ReviewIssue = {
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
 *
 * ── The severity contract ───────────────────────────────────────────────
 *
 * Only a CRITICAL finding that survives the repair budget blocks publication.
 * Warnings that survive are returned as `advisoryIssues` and disclosed on the
 * deal as conditions.
 *
 * This used to filter `severity !== "info"`, which made a warning exactly as
 * fatal as a critical: the caller turned any non-empty list into a FatalError
 * that discarded the entire commissioning run. Three artifact gates each
 * behaved that way, and every one had to return an empty list for a bundle to
 * publish.
 *
 * The production record is unambiguous about what that cost. Across the whole
 * system: 916 runs, 0 published. Measured per-gate pass rates of 12/31 on
 * business plans and 5/13 on feasibility studies — around 39% each, so about
 * 6% for the conjunction. And since 2026-08-20 not one blocking finding was
 * rated critical: three warnings, one on a business plan and two on
 * feasibility studies, are the entire reason those runs died.
 *
 * A warning is the reviewer saying "a lender should know this", not "this
 * must not ship". Discarding a complete commissioning package over one is a
 * miscalibration, and it silently discarded the disclosure too — the finding
 * went into the failure string rather than in front of the banker who needed
 * it. persistArtifactFlags already writes these to the deal as conditions;
 * they now survive to be read.
 */
/**
 * Identity of a review: the artifact type, the evidence, and the prose.
 *
 * Two runs that produce byte-identical content have nothing new for a reviewer
 * to judge, so re-reviewing is a fresh roll of a ~39% die on evidence that has
 * not changed. Sections are hashed in key order so an incidental reordering
 * does not read as different content, and the evidence is hashed as given
 * (already a stable JSON string for the callers that pre-serialise it).
 */
export function reviewContentHash(input: {
  artifactType: ArtifactType;
  facts: Record<string, unknown> | string;
  sections: ArtifactSection[];
}): string {
  const factsText = typeof input.facts === "string" ? input.facts : JSON.stringify(input.facts);
  const sectionsText = JSON.stringify(
    [...input.sections]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((s) => [s.key, s.text]),
  );
  return createHash("sha256")
    .update(`${input.artifactType}\u0000${factsText}\u0000${sectionsText}`)
    .digest("hex");
}

export async function finishInstitutionalArtifact(input: {
  artifactType: ArtifactType;
  facts: Record<string, unknown> | string;
  sections: ArtifactSection[];
  dealId: string;
  npiTagged?: boolean;
}): Promise<FrontierArtifactResult> {
  const npiTagged = input.npiTagged ?? true;
  const contentHash = reviewContentHash(input);
  let sections = input.sections;
  let repaired = false;
  let reviewPasses = 0;
  let remaining: ReviewIssue[] = [];

  // Bound the lane while allowing the reviewer to verify each targeted repair.
  // Three repair cycles prevent a single imperfect rewrite from discarding an
  // otherwise recoverable institutional package.
  for (let cycle = 0; cycle <= 3; cycle += 1) {
    const issues = await review({ ...input, sections, npiTagged });
    reviewPasses += 1;
    // Repair still attempts everything above info — a warning worth fixing is
    // worth fixing. What changed is what happens to one that survives.
    remaining = issues.filter((issue) => issue.severity !== "info");
    if (remaining.length === 0) {
      return {
        sections, verdict: "pass", flaggedClaims: [], repaired, reviewPasses,
        reviewIssues: [], advisoryIssues: [], contentHash,
      };
    }
    if (cycle === 3) break;

    let repair;
    try {
      repair = await runRole("underwriter", {
        systemInstruction: REPAIR_SYSTEM,
        prompt: [
          `ARTIFACT TYPE: ${input.artifactType}`,
          "IMMUTABLE EVIDENCE AND CALCULATIONS:",
          typeof input.facts === "string" ? input.facts : JSON.stringify(input.facts, null, 2),
          "CURRENT SECTIONS:",
          JSON.stringify(sections, null, 2),
          "INDEPENDENT REVIEW FINDINGS:",
          JSON.stringify(remaining, null, 2),
          `REPAIR CYCLE: ${cycle + 1} OF 3`,
          "Return the complete repaired section set.",
        ].join("\n\n"),
        responseSchema: REPAIR_SCHEMA,
        purpose: `${input.artifactType}_targeted_repair_${cycle + 1}`,
        dealId: input.dealId,
        npiTagged,
        maxOutputTokens: 8_192,
        timeoutMs: 75_000,
      });
    } catch {
      break;
    }

    const repairedSections = parseSections(repair.text, sections);
    if (!repairedSections) {
      remaining = [{
        sectionKey: "artifact",
        claim: "(artifact repair output invalid)",
        reason: "The automated repair did not preserve the complete artifact section contract.",
        severity: "critical",
        category: "credit_policy",
        repairInstruction: "Regenerate the complete section contract.",
      }];
      break;
    }
    sections = repairedSections;
    repaired = true;
  }

  // The repair budget is spent. Split what survived: criticals block, warnings
  // are disclosed.
  const blocking = remaining.filter((issue) => issue.severity === "critical");
  const advisory = remaining.filter((issue) => issue.severity === "warning");

  return {
    sections,
    verdict: blocking.length > 0 ? "flagged" : "pass",
    // Every surviving finding is still persisted as a condition, blocking or
    // not — the banker sees the warnings either way.
    flaggedClaims: remaining.map(({ claim, reason, severity }) => ({ claim, reason, severity })),
    repaired,
    reviewPasses,
    reviewIssues: blocking,
    advisoryIssues: advisory,
    // The hash of what was SUBMITTED. A repair rewrites the sections, so the
    // published artifact may differ from what this hash covers; callers reuse
    // a verdict only when the content they are about to submit matches, which
    // is exactly this value.
    contentHash,
  };
}
