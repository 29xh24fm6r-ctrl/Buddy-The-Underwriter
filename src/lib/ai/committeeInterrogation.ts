import "server-only";

/**
 * SPEC-M6 ANTICIPATED-INTERROGATION-1 — the gateway's "hostile credit
 * committee" primitive. Given a deal's actual facts/weaknesses, generates
 * the toughest likely underwriter questions and, in the same pass, judges
 * whether the package already answers each one.
 *
 * Deliberately NOT an extension of verify.ts's verifyClaims — that function
 * critiques an already-written draft against facts (draft in, flagged
 * claims out); this generates new adversarial questions from facts alone
 * (facts in, questions out), a different task shape. Both share the same
 * scaffolding convention: single `runRole("verifier", ...)` call (Claude,
 * no failover — Invariant #4: at most one verifier per artifact), schema-
 * constrained JSON output, and malformed output treated as a failure
 * signal rather than a silent empty pass.
 *
 * One call produces the whole appendix (question generation AND the
 * per-question "does the package already answer this" judgment together)
 * rather than one call to generate questions plus N follow-up calls to
 * check each — avoids N sequential no-failover verifier round-trips
 * against every deal, and keeps this a single verifier pass per artifact.
 */

import { runRole } from "./gateway";

export type HostileQuestionSeverity = "info" | "warning" | "critical";

export type HostileQuestion = {
  /** Stable per-question identifier for idempotent persistence (deal_hostile_interrogations.code) and deal_conditions.source_key. */
  code: string;
  question: string;
  /** Rough category for banker context, e.g. "repayment", "collateral", "management", "industry". */
  domain: string;
  severity: HostileQuestionSeverity;
  /** Whether the package (as summarized in the facts payload) already answers this question. */
  alreadyAnswered: boolean;
  /** Why an underwriter would ask this, grounded in the facts given. */
  rationale: string;
  /** The exact action that would resolve this gap. */
  resolvingAction: string;
  /** True when a borrower can directly close this gap (upload a document, clarify a fact) vs. requiring banker judgment. */
  borrowerResolvable: boolean;
};

const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 8;

const HOSTILE_COMMITTEE_SYSTEM_INSTRUCTION =
  "You are a skeptical commercial-bank credit committee member reviewing an SBA loan " +
  "package before it goes to a real underwriter. You are given a set of immutable, " +
  "deterministically-computed facts about the deal (metrics, risk flags, data-quality " +
  "flags, outstanding checklist gaps, ownership-reconciliation issues). " +
  `Generate the ${MIN_QUESTIONS}-${MAX_QUESTIONS} toughest questions a real underwriter ` +
  "would ask about this specific deal, grounded only in the facts given — never invent " +
  "a weakness the facts don't support. For each question, judge whether the facts already " +
  "answer it (alreadyAnswered), and if not, state the exact action that would resolve it " +
  "and whether a borrower can do that themselves (borrowerResolvable) or it requires " +
  "banker judgment (e.g. a policy exception, a collateral valuation call).";

const HOSTILE_QUESTIONS_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Stable snake_case identifier for this question, e.g. \"dscr_thin_margin\".",
          },
          question: { type: "string" },
          domain: { type: "string" },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          alreadyAnswered: { type: "boolean" },
          rationale: { type: "string" },
          resolvingAction: { type: "string" },
          borrowerResolvable: { type: "boolean" },
        },
        required: [
          "code",
          "question",
          "domain",
          "severity",
          "alreadyAnswered",
          "rationale",
          "resolvingAction",
          "borrowerResolvable",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

function buildPrompt(factsText: string): string {
  return [
    "DEAL FACTS (ground truth, deterministically computed — do not question these):",
    factsText,
    "",
    `Generate the ${MIN_QUESTIONS}-${MAX_QUESTIONS} toughest underwriter questions for ` +
      "this deal, each with your answered/unanswered judgment and, when unanswered, the " +
      "resolving action.",
  ].join("\n");
}

function isHostileQuestion(x: unknown): x is HostileQuestion {
  if (!x || typeof x !== "object") return false;
  const q = x as Record<string, unknown>;
  return (
    typeof q.code === "string" &&
    typeof q.question === "string" &&
    typeof q.domain === "string" &&
    (q.severity === "info" || q.severity === "warning" || q.severity === "critical") &&
    typeof q.alreadyAnswered === "boolean" &&
    typeof q.rationale === "string" &&
    typeof q.resolvingAction === "string" &&
    typeof q.borrowerResolvable === "boolean"
  );
}

/**
 * Pure w.r.t. persistence — takes a facts payload, returns questions. All
 * DB reads (assembling facts) and writes (persisting rows, creating banker
 * tasks, emitting the beat metric) live in the orchestrator,
 * src/lib/brokerage/hostileInterrogation.ts.
 *
 * A malformed/unparseable verifier response returns a single synthetic
 * critical question rather than an empty array — same principle as
 * verifyClaims: silence must never be mistaken for "nothing to flag."
 */
export async function generateHostileInterrogation(input: {
  dealId: string;
  facts: Record<string, unknown>;
  npiTagged?: boolean;
}): Promise<HostileQuestion[]> {
  const factsText = JSON.stringify(input.facts, null, 2);

  const result = await runRole("verifier", {
    prompt: buildPrompt(factsText),
    systemInstruction: HOSTILE_COMMITTEE_SYSTEM_INSTRUCTION,
    responseSchema: HOSTILE_QUESTIONS_SCHEMA,
    purpose: "hostile_committee_interrogation",
    dealId: input.dealId,
    npiTagged: input.npiTagged,
  });

  try {
    const parsed = JSON.parse(result.text);
    const raw = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const questions = raw.filter(isHostileQuestion);
    if (questions.length === 0) {
      throw new Error("no valid questions parsed");
    }
    return questions;
  } catch {
    return [
      {
        code: "verifier_output_unparseable",
        question: "(unable to generate hostile committee questions)",
        domain: "system",
        severity: "critical",
        alreadyAnswered: false,
        rationale: "The verifier's response was not valid JSON matching the expected schema.",
        resolvingAction: "Re-run the hostile interrogation; if this persists, check the gateway ledger for the failure.",
        borrowerResolvable: false,
      },
    ];
  }
}
