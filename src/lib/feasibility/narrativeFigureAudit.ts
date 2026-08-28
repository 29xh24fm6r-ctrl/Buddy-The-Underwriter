// src/lib/feasibility/narrativeFigureAudit.ts
// Pure function. No DB, no LLM, no side effects.
//
// The feasibility narrative generator is instructed not to derive figures the
// deterministic model did not produce, and the institutional reviewer is
// handed the same policy. Both are instructions to a language model, and the
// production failure they were written for shows what that is worth: a run
// published a debt-service-inclusive break-even of ~$2,345,297 and a
// "$408,583 residual cushion" that no deterministic model computes, and the
// reviewer caught it only because it happened to check the arithmetic.
//
// This is the deterministic half. Every currency amount, percentage and
// multiple a narrative asserts is extracted and matched against the evidence
// the generator was actually given. What does not match is reported, so the
// repair pass is aimed at specific figures instead of being asked to re-read
// a policy paragraph.
//
// Deliberately conservative — a false positive would attack a valid study:
//   - Only figures specific enough to be a claim are audited. Small bare
//     integers, years, and counts read as prose, not as model output.
//   - A figure matches on VALUE, not on formatting: "$1.77 million",
//     "$1,772,778" and "1772778.4" are the same claim.
//   - Rounding a supplied figure is not fabricating one. A narrative may say
//     "approximately $2.75 million" for 2,753,880.

/** A numeric claim found in narrative text. */
export type NarrativeFigure = {
  /** The figure as written, e.g. "$2,345,297" or "35.6%". */
  text: string;
  /** Parsed value. Percentages are kept as written (35.6, not 0.356). */
  value: number;
  kind: "currency" | "percent" | "multiple";
};

const CURRENCY = /\$\s*([\d,]+(?:\.\d+)?)\s*(million|billion|thousand|m\b|k\b)?/gi;
const PERCENT = /(\d+(?:\.\d+)?)\s*%/g;
const MULTIPLE = /(\d+(?:\.\d+)?)\s*x\b/gi;

const SCALE: Record<string, number> = {
  thousand: 1_000, k: 1_000,
  million: 1_000_000, m: 1_000_000,
  billion: 1_000_000_000,
};

/**
 * Currency below this reads as prose rather than a model output — a headcount
 * cost, a round illustrative figure. The fabricated figures this exists to
 * catch are project-scale amounts.
 */
const CURRENCY_CLAIM_FLOOR = 1_000;

export function extractNarrativeFigures(text: string): NarrativeFigure[] {
  if (typeof text !== "string" || !text) return [];
  const figures: NarrativeFigure[] = [];

  for (const match of text.matchAll(CURRENCY)) {
    const raw = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(raw)) continue;
    const scale = match[2] ? (SCALE[match[2].toLowerCase()] ?? 1) : 1;
    const value = raw * scale;
    if (value < CURRENCY_CLAIM_FLOOR) continue;
    figures.push({ text: match[0].trim(), value, kind: "currency" });
  }
  for (const match of text.matchAll(PERCENT)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) figures.push({ text: match[0].trim(), value, kind: "percent" });
  }
  for (const match of text.matchAll(MULTIPLE)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) figures.push({ text: match[0].trim(), value, kind: "multiple" });
  }
  return figures;
}

/**
 * Every number reachable in the evidence the generator was given, at any
 * depth. Percentages are recorded both as stored (0.356) and as a narrative
 * would write them (35.6), since the deterministic models store ratios and
 * the prose renders percents.
 */
export function collectEvidenceValues(evidence: unknown): number[] {
  const values: number[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "number") {
      if (!Number.isFinite(node)) return;
      values.push(node);
      // A stored ratio and its rendered percentage are the same claim.
      if (Math.abs(node) <= 1) values.push(node * 100);
      return;
    }
    if (typeof node === "string") {
      for (const figure of extractNarrativeFigures(node)) values.push(figure.value);
      return;
    }
    if (typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) node.forEach(walk);
    else Object.values(node as Record<string, unknown>).forEach(walk);
  };

  walk(evidence);
  return values;
}

/**
 * Is `figure` the same claim as `candidate`, allowing for the rounding a
 * narrative legitimately applies? Tolerance scales with magnitude: writing
 * "$2.75 million" for 2,753,880 is rounding, writing $2,345,297 when the
 * model produced 1,772,778 is not.
 */
function matches(figure: NarrativeFigure, candidate: number): boolean {
  if (!Number.isFinite(candidate)) return false;
  const a = Math.abs(figure.value);
  const b = Math.abs(candidate);
  if (a === b) return true;
  // 0.5% relative, which covers 3-significant-figure rounding, plus an
  // absolute floor so small percentages and multiples still compare sanely.
  const tolerance = Math.max(a, b) * 0.005 + (figure.kind === "currency" ? 0.5 : 0.05);
  return Math.abs(a - b) <= tolerance;
}

export type FigureAuditResult = {
  /** Section key -> the figures in it that no supplied evidence supports. */
  untraced: Array<{ section: string; text: string; value: number; kind: NarrativeFigure["kind"] }>;
  /** Total figures audited, so a caller can tell "clean" from "nothing checked". */
  audited: number;
};

/**
 * Report the figures a narrative asserts that the supplied evidence does not
 * contain. Reporting only — this never edits a narrative and never decides a
 * verdict; it gives the reviewer and the repair pass a specific target.
 */
export function auditNarrativeFigures(args: {
  narratives: Record<string, unknown>;
  evidence: unknown;
}): FigureAuditResult {
  const supported = collectEvidenceValues(args.evidence);
  const untraced: FigureAuditResult["untraced"] = [];
  let audited = 0;

  for (const [section, text] of Object.entries(args.narratives)) {
    if (typeof text !== "string" || !text.trim()) continue;
    for (const figure of extractNarrativeFigures(text)) {
      audited += 1;
      if (supported.some((candidate) => matches(figure, candidate))) continue;
      untraced.push({ section, text: figure.text, value: figure.value, kind: figure.kind });
    }
  }

  return { untraced, audited };
}
