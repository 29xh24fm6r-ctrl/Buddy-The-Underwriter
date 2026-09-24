import "server-only";

import { createHash } from "node:crypto";
import { auditProjectionNarrative, auditFundingNarrative } from "./projectionNarrativeAudit";
import { auditNarrativeCompleteness } from "./narrativeCompletenessAudit";
import { includeRequiredNarrativeSections, type NarrativeRequirements } from "@/lib/brokerage/trident/narrativeAcceptance";

import { runRole } from "./gateway";
import type { ArtifactType } from "./artifactVerification";
import type { FlaggedClaim } from "./verify";

import type { ReviewCheckpoint, ReviewCheckpointStore } from "./reviewCheckpoint";

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
  "A disclosed missing lender confirmation or supporting document is an advisory warning, unless the artifact falsely claims it exists. Never require a prose rewrite to create missing source evidence. Supplied model calculations are authoritative; request correction only for a demonstrable contradiction, not an alternative financial method.",
  "Numeric inconsistencies and cross-artifact conflicts are repairable content defects and must be critical, even when the correct figures appear elsewhere. Reserve these categories for demonstrable contradictions. Use credit_policy for disclosed missing external evidence or lender confirmation. A funding allocation omitting working capital or mislabeling a franchise fee is a numeric inconsistency. A base-case cushion does not establish ramp or downside resilience; evaluate all three downside years wherever repayment strength is claimed.",
  "A pass requires decision-useful, borrower-specific analysis that clearly separates evidence, assumptions, and conclusions.",
].join(" ");

const REPAIR_SYSTEM = [
  "You are Buddy's primary senior commercial underwriter.",
  "Repair the supplied artifact using only the immutable evidence and deterministic calculations.",
  "Follow every repair instruction that is supported by the evidence.",
  "Never invent a number, person, credential, market fact, or policy conclusion.",
  "If evidence is absent, state the limitation concisely instead of filling space.",
  "Return only the requested repair section keys, exactly once each. Unaffected sections are read-only context and must not be returned or changed.",
].join(" ");

function parseIssues(text: string): ReviewIssue[] {
  try {
    const value = JSON.parse(text) as { issues?: ReviewIssue[]; flaggedClaims?: FlaggedClaim[] };
    if (Array.isArray(value.issues) && value.issues.every((issue) =>
      issue && typeof issue.sectionKey === "string" && typeof issue.reason === "string" &&
      typeof issue.claim === "string" && typeof issue.repairInstruction === "string" &&
      ["info", "warning", "critical"].includes(issue.severity) &&
      ["unsupported_fact", "numeric_inconsistency", "missing_analysis", "generic_language", "credit_policy", "cross_artifact_conflict"].includes(issue.category)
    )) return enforceReviewSeverity(value.issues);
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
    throw new Error("Invalid review contract");
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

function enforceReviewSeverity(issues: ReviewIssue[]): ReviewIssue[] {
  return issues.map(issue => issue.severity !== "info" &&
    ["numeric_inconsistency", "cross_artifact_conflict"].includes(issue.category)
    ? { ...issue, severity: "critical" } : issue);
}

function auditFinancialNarratives(facts: Record<string, unknown> | string, sections: ArtifactSection[]) {
  return [...auditProjectionNarrative(facts, sections), ...auditFundingNarrative(facts, sections)];
}

function parseSections(text: string, original: ArtifactSection[]): ArtifactSection[] | null {
  try {
    const value = JSON.parse(text) as { sections?: ArtifactSection[] };
    if (!Array.isArray(value.sections)) return null;
    const expected = new Set(original.map((section) => section.key));
    if (!value.sections.every((section) => section && expected.has(section.key) &&
      typeof section.text === "string" && section.text.trim())) return null;
    const repaired = value.sections;
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
  sectionAudit?: Record<string, unknown>;
}): Promise<ReviewIssue[]> {
  const result = await runRole("verifier", {
    systemInstruction: REVIEW_SYSTEM,
    prompt: [
      `ARTIFACT TYPE: ${input.artifactType}`,
      "IMMUTABLE EVIDENCE AND CALCULATIONS:",
      typeof input.facts === "string" ? input.facts : JSON.stringify(input.facts, null, 2),
      "ARTIFACT SECTIONS:",
      JSON.stringify(input.sections, null, 2),
      ...(input.sectionAudit ? ["AUDIT OF THE CURRENT SECTIONS (not source evidence):", JSON.stringify(input.sectionAudit)] : []),
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
  sectionAudit?: Record<string, unknown>;
  narrativeRequirements?: NarrativeRequirements;
}): string {
  const factsText = typeof input.facts === "string" ? input.facts : JSON.stringify(input.facts);
  const sectionsText = JSON.stringify(
    [...input.sections]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((s) => [s.key, s.text]),
  );
  return createHash("sha256")
    .update(`review_rules_v6\u0000${input.artifactType}\u0000${factsText}\u0000${sectionsText}${input.sectionAudit ? `\u0000${JSON.stringify(input.sectionAudit)}` : ""}\u0000${JSON.stringify(input.narrativeRequirements ?? {})}`)
    .digest("hex");
}

export async function finishInstitutionalArtifact(input: {
  artifactType: ArtifactType;
  facts: Record<string, unknown> | string;
  sections: ArtifactSection[];
  dealId: string;
  npiTagged?: boolean;
  checkpoint?: ReviewCheckpointStore;
  /** Recompute narrative-derived findings after every repair; never change source facts. */
  auditSections?: (sections: ArtifactSection[]) => Record<string, unknown>;
  narrativeRequirements?: NarrativeRequirements;
}): Promise<FrontierArtifactResult> {
  const npiTagged = input.npiTagged ?? true;
  const finalContentHash = () => reviewContentHash({ ...input, sections, sectionAudit: input.auditSections?.(sections) });
  const saved = input.checkpoint?.state;
  let sections = includeRequiredNarrativeSections(saved?.sections ?? input.sections, input.narrativeRequirements);
  let repaired = saved?.repaired ?? false;
  let reviewPasses = saved?.reviewPasses ?? 0;
  let remaining: ReviewIssue[] = enforceReviewSeverity(saved?.remaining ?? []);
  let phase: ReviewCheckpoint["phase"] = saved?.phase ?? "review";
  let completedBatches = saved?.completedBatches ?? {};
  const save = async (cycle: number) => {
    await input.checkpoint?.save({ version: 1, cycle, phase, sections, repaired,
      reviewPasses, remaining, completedBatches });
  };

  // Each completed review and repair batch is durable before moving forward.
  // Unchanged retries retain the original three-repair limit.
  for (let cycle = saved?.cycle ?? 0; cycle <= 3; cycle += 1) {
    const sectionAudit = input.auditSections?.(sections);
    if (phase === "review") {
      const issues = [...await review({ ...input, sections, npiTagged, sectionAudit }), ...auditFinancialNarratives(input.facts, sections), ...auditNarrativeCompleteness(sections, input.narrativeRequirements)];
      reviewPasses += 1;
      remaining = issues.filter((issue) => issue.severity !== "info");
      phase = cycle === 3 || remaining.every(issue => issue.severity !== "critical") ? "done" : "repair";
      await save(cycle);
    }
    if (phase === "done") break;

    const sectionKeys = new Set(sections.map((section) => section.key));
    // Legacy/artifact-wide findings require the whole set. Otherwise preserve
    // unaffected sections byte-for-byte and request only the diagnosed edits.
    const artifactWide = remaining.some((issue) => !sectionKeys.has(issue.sectionKey));
    const targets = artifactWide ? sections : sections.filter((section) =>
      remaining.some((issue) => issue.sectionKey === section.key));
    // Feasibility has seven long sections. Rewriting all of them in one
    // response repeatedly exhausted the 75s deadline. Bound each response to
    // two sections, and retain the independent whole-artifact review.
    const batches: ArtifactSection[][] = input.artifactType === "feasibility" || input.artifactType === "business_plan"
      ? Array.from({ length: Math.ceil(targets.length / 2) }, (_, i) => targets.slice(i * 2, i * 2 + 2))
      : [targets];
    // Serialize checkpoint writes, while allowing independent model batches to
    // run concurrently. A failed write stops the lane before another review.
    let writes = Promise.resolve();
    const repairs = await Promise.allSettled(batches.map(async (batch, batchIndex) => {
      const cached = completedBatches[String(batchIndex)];
      if (cached) {
        if (!parseSections(JSON.stringify({ sections: cached }), batch)) throw new Error("review_checkpoint_invalid_batch");
        return cached;
      }
      const request = {
        systemInstruction: REPAIR_SYSTEM,
        prompt: [
          `ARTIFACT TYPE: ${input.artifactType}`,
          "IMMUTABLE EVIDENCE AND CALCULATIONS:",
          typeof input.facts === "string" ? input.facts : JSON.stringify(input.facts),
          "SECTIONS TO REPAIR (claims here are not evidence):",
          JSON.stringify(input.artifactType === "feasibility" ? batch : sections),
          ...(sectionAudit ? ["AUDIT OF THE CURRENT SECTIONS (not source evidence):", JSON.stringify(sectionAudit)] : []),
          "REQUESTED REPAIR SECTION KEYS:",
          JSON.stringify(batch.map((section) => section.key)),
          "PUBLICATION REQUIREMENTS FOR REQUESTED SECTIONS (preserve these while repairing):",
          JSON.stringify(Object.fromEntries(batch.flatMap(section => input.narrativeRequirements?.[section.key] ? [[section.key, { minimumWords: input.narrativeRequirements[section.key], format: "plain evidence-grounded prose" }]] : []))),
          "INDEPENDENT REVIEW FINDINGS:",
          JSON.stringify(remaining.filter((issue) => !sectionKeys.has(issue.sectionKey) || batch.some((s) => s.key === issue.sectionKey))),
          `REPAIR CYCLE: ${cycle + 1} OF 3`,
          input.artifactType === "feasibility"
            ? "Return only the requested repaired sections. Remove unsupported claims; do not pad the response. Keep each section concise (normally 150-250 words)."
            : "Return only the requested repaired sections. Do not repeat unchanged sections.",
        ].join("\n\n"),
        responseSchema: REPAIR_SCHEMA,
        purpose: `${input.artifactType}_targeted_repair_${cycle + 1}${batches.length > 1 ? `_batch_${batchIndex + 1}` : ""}`,
        dealId: input.dealId,
        npiTagged,
        maxOutputTokens: input.artifactType === "feasibility" ? 4_096 : 8_192,
        timeoutMs: 75_000,
      };
      let repair;
      try {
        repair = await runRole("underwriter", request);
      } catch (error) {
        if (!(error instanceof Error) || !/aborted|aborterror|timed?\s*out|timeout/i.test(error.message)) throw error;
        repair = await runRole("underwriter", { ...request, purpose: `${request.purpose}_retry` });
      }
      const parsed = parseSections(repair.text, batch);
      if (!parsed) throw new Error("invalid_repair_contract");
      if (input.checkpoint) {
        writes = writes.then(async () => {
          completedBatches = { ...completedBatches, [String(batchIndex)]: parsed };
          await save(cycle);
        });
        await writes;
      }
      return parsed;
    }));
    const failed = repairs.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      // Keep the saved findings and successful batches resumable. Do not turn
      // a budget, provider or persistence error into a terminal review verdict.
      if (input.checkpoint) throw failed.reason;
      // Never publish a partial batch or hide the infrastructure failure behind
      // a content finding. Keep the last reviewed prose and its findings.
      const timeout = failed.reason instanceof Error && /aborted|aborterror|timed?\s*out|timeout/i.test(failed.reason.message);
      if (input.artifactType !== "feasibility" && failed.reason instanceof Error && failed.reason.message === "invalid_repair_contract") remaining = [];
      if (input.artifactType === "feasibility" || (failed.reason instanceof Error && failed.reason.message === "invalid_repair_contract")) remaining.push({
        sectionKey: "artifact", claim: "Automated repair incomplete",
        reason: timeout ? "A targeted repair and its bounded retry timed out; no partial rewrite was published." : "A targeted repair failed or returned an invalid section contract; no partial rewrite was published.",
        severity: "critical", category: "credit_policy",
        repairInstruction: "Complete the targeted repair and independent review before publication.",
      });
      break;
    }
    const repairedSections = repairs.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const replacements = new Map(repairedSections.map((section) => [section.key, section]));
    sections = sections.map((section) => replacements.get(section.key) ?? section);
    repaired = true;
    phase = "review";
    completedBatches = {};
    await save(cycle + 1);
  }

  // The repair budget is spent. Split what survived: criticals block, warnings
  // are disclosed.
  // Also enforce on resumed terminal checkpoints; no cached model verdict can
  // override deterministic missing disclosure.
  const audited = [...auditFinancialNarratives(input.facts, sections), ...auditNarrativeCompleteness(sections, input.narrativeRequirements)];
  for (const issue of audited) if (!remaining.some(r => r.sectionKey === issue.sectionKey && r.claim === issue.claim)) remaining.push(issue);
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
    // Cache only the exact final content accepted by this review.
    contentHash: finalContentHash(),
  };
}
