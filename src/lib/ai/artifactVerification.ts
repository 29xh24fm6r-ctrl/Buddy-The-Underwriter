import "server-only";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — shared verifier-and-flag helper for the
 * four AI-narrated artifacts (credit memo, business plan, feasibility,
 * projections-assumptions). Generalizes the exact idempotent-banker-task
 * pattern M6's hostileInterrogation.ts established for
 * (deal_id, source="system", source_key) — here source_key is
 * `artifact_claim:<artifactType>:<sectionKey>:<claimHash>` so the same
 * claim re-verified on a later run (unchanged facts, unchanged draft) never
 * opens a duplicate banker task.
 *
 * A verifier call failing outright (provider outage — the verifier role
 * has no failover, Invariant #4) is treated the same as the malformed-JSON
 * case verify.ts already guards: a synthetic critical flag, never a silent
 * pass. This lets every caller reuse the same "critical flag degrades the
 * whole artifact" handling they already need for the ordinary flagged case,
 * rather than each of the four call sites having to separately try/catch
 * the verifier step.
 */

import { createHash } from "node:crypto";
import { verifyClaims, type FlaggedClaim } from "./verify";

type SB = { from: (t: string) => any };

export type ArtifactType =
  | "credit_memo"
  | "business_plan"
  | "feasibility"
  | "projections_assumptions";

export type VerifyArtifactAndFlagInput = {
  dealId: string;
  bankId: string;
  artifactType: ArtifactType;
  /** Identifies the section/field within the artifact this draft covers. */
  sectionKey: string;
  facts: Record<string, unknown> | string;
  draftText: string;
  npiTagged?: boolean;
  sb: SB;
};

export type VerifyArtifactAndFlagResult = {
  verdict: "pass" | "flagged";
  flaggedClaims: FlaggedClaim[];
  conditionsCreated: number;
  conditionsSkipped: number;
};

const ACTIONABLE_SEVERITIES = new Set(["warning", "critical"]);

function claimSourceKey(artifactType: string, sectionKey: string, claim: string): string {
  const claimHash = createHash("sha256").update(claim).digest("hex").slice(0, 16);
  return `artifact_claim:${artifactType}:${sectionKey}:${claimHash}`;
}

export async function persistArtifactFlags(input: {
  dealId: string;
  bankId: string;
  artifactType: ArtifactType;
  sectionKey: string;
  flaggedClaims: FlaggedClaim[];
  sb: SB;
}): Promise<{ conditionsCreated: number; conditionsSkipped: number }> {
  const { dealId, bankId, artifactType, sectionKey, flaggedClaims, sb } = input;
  let conditionsCreated = 0;
  let conditionsSkipped = 0;

  for (const flagged of flaggedClaims) {
    if (!ACTIONABLE_SEVERITIES.has(flagged.severity)) continue;
    const sourceKey = claimSourceKey(artifactType, sectionKey, flagged.claim);
    const existing = await sb.from("deal_conditions").select("id").eq("deal_id", dealId)
      .eq("source", "system").eq("source_key", sourceKey).maybeSingle();
    if (existing.data?.id) {
      conditionsSkipped += 1;
      continue;
    }
    const ins = await sb.from("deal_conditions").insert({
      deal_id: dealId,
      bank_id: bankId,
      title: `Unsupported claim in ${artifactType.replace(/_/g, " ")} (${sectionKey})`,
      description: `"${flagged.claim}" — ${flagged.reason}`,
      category: "credit",
      status: "open",
      source: "system",
      source_key: sourceKey,
      required_docs: [],
      created_by: null,
    });
    if (ins.error) conditionsSkipped += 1;
    else conditionsCreated += 1;
  }
  return { conditionsCreated, conditionsSkipped };
}

/**
 * Runs verifyClaims against a single artifact section's draft text, then
 * opens (or no-ops on re-run) a deal_conditions banker task for every
 * warning/critical flagged claim. "info" claims are never actionable —
 * they surface via the flaggedClaims return value for panel display, but
 * don't generate a task a banker has to close.
 */
export async function verifyArtifactAndFlag(
  input: VerifyArtifactAndFlagInput,
): Promise<VerifyArtifactAndFlagResult> {
  const { dealId, bankId, artifactType, sectionKey, facts, draftText, npiTagged, sb } = input;

  let flaggedClaims: FlaggedClaim[];
  let verdict: "pass" | "flagged";
  try {
    const result = await verifyClaims({ facts, draft: draftText, dealId, npiTagged });
    flaggedClaims = result.flaggedClaims;
    verdict = result.verdict;
  } catch (e) {
    flaggedClaims = [
      {
        claim: "(verifier call failed)",
        reason: e instanceof Error ? e.message : String(e),
        severity: "critical",
      },
    ];
    verdict = "flagged";
  }

  const { conditionsCreated, conditionsSkipped } = await persistArtifactFlags({
    dealId, bankId, artifactType, sectionKey, flaggedClaims, sb,
  });

  return { verdict, flaggedClaims, conditionsCreated, conditionsSkipped };
}
