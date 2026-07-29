import "server-only";

/**
 * Cross-vendor claim verification (SPEC-M1 AI-GATEWAY-1) — the gateway's
 * challenger primitive. Runs the `verifier` role (Claude, by default
 * config) against a draft narrative and a set of deterministic facts, and
 * flags any claim in the draft the facts don't support.
 *
 * Invariant #1: this NEVER computes a canonical financial value — it only
 * judges whether prose someone else generated is faithful to numbers
 * someone else already computed. `facts` must come from a deterministic
 * source (a model snapshot, Finengine output, etc.), never from another
 * LLM call.
 *
 * Output shape deliberately mirrors the existing qualityFlags convention
 * (src/lib/modelEngine/types.ts) — a flat list of typed diagnostic
 * entries — for consistency with how the rest of the repo surfaces
 * "something looks off" signals, though this never writes into
 * FinancialPeriod.qualityFlags itself (that field is deterministic-model-
 * only).
 */

import { runRole } from "./gateway";

export type ClaimSeverity = "info" | "warning" | "critical";

export type FlaggedClaim = {
  claim: string;
  reason: string;
  severity: ClaimSeverity;
};

export type VerifyClaimsInput = {
  facts: Record<string, unknown> | string;
  draft: string;
  dealId?: string | null;
  /** Forwarded to the gateway's NPI-refusal gate — see vendorApproval.ts. */
  npiTagged?: boolean;
};

export type VerifyClaimsResult = {
  verdict: "pass" | "flagged";
  flaggedClaims: FlaggedClaim[];
};

const VERIFIER_SYSTEM_INSTRUCTION =
  "You are a skeptical fact-checker for a commercial bank underwriting system. " +
  "You are given a set of immutable, deterministically-computed facts and a " +
  "draft narrative written by a different model. Your only job is to find " +
  "claims in the draft that the facts do NOT support — numbers that don't " +
  "match, comparisons that aren't in the facts, or conclusions the facts " +
  "don't justify. Do not invent new facts, and do not flag stylistic choices. " +
  "If every claim in the draft is supported by the facts, return an empty list.";

const FLAGGED_CLAIMS_SCHEMA = {
  type: "object",
  properties: {
    flaggedClaims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string", description: "The exact unsupported claim, quoted from the draft." },
          reason: { type: "string", description: "Why this claim isn't supported by the facts." },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
        },
        required: ["claim", "reason", "severity"],
        additionalProperties: false,
      },
    },
  },
  required: ["flaggedClaims"],
  additionalProperties: false,
} as const;

function buildPrompt(factsText: string, draft: string): string {
  return [
    "FACTS (ground truth, deterministically computed — do not question these):",
    factsText,
    "",
    "DRAFT NARRATIVE TO CHECK:",
    draft,
    "",
    "List every claim in the draft narrative that the facts above do not " +
      "support. Return an empty flaggedClaims array if the draft is fully " +
      "supported.",
  ].join("\n");
}

function isFlaggedClaim(x: unknown): x is FlaggedClaim {
  if (!x || typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  return (
    typeof c.claim === "string" &&
    typeof c.reason === "string" &&
    (c.severity === "info" || c.severity === "warning" || c.severity === "critical")
  );
}

export async function verifyClaims(input: VerifyClaimsInput): Promise<VerifyClaimsResult> {
  const factsText =
    typeof input.facts === "string" ? input.facts : JSON.stringify(input.facts, null, 2);

  const result = await runRole("verifier", {
    prompt: buildPrompt(factsText, input.draft),
    systemInstruction: VERIFIER_SYSTEM_INSTRUCTION,
    responseSchema: FLAGGED_CLAIMS_SCHEMA,
    purpose: "verify_claims",
    dealId: input.dealId,
    npiTagged: input.npiTagged,
  });

  let flaggedClaims: FlaggedClaim[];
  try {
    const parsed = JSON.parse(result.text);
    const raw = Array.isArray(parsed?.flaggedClaims) ? parsed.flaggedClaims : [];
    flaggedClaims = raw.filter(isFlaggedClaim);
  } catch {
    // Malformed verifier output must not be mistaken for "nothing to flag" —
    // surface it as a critical flag so a banker sees it rather than a
    // silently-passing verification.
    flaggedClaims = [
      {
        claim: "(verifier output unparseable)",
        reason: "The verifier's response was not valid JSON matching the expected schema.",
        severity: "critical",
      },
    ];
  }

  return {
    verdict: flaggedClaims.length > 0 ? "flagged" : "pass",
    flaggedClaims,
  };
}
