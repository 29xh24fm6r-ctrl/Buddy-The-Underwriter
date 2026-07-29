import "server-only";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — citation attribution for feasibility-study
 * narrative fields that draw on grounded market research (§0 research:
 * marketDemandNarrative, locationSuitabilityNarrative, and executiveSummary
 * carry the heaviest research injection in feasibilityNarrative.ts's
 * prompts; financialViabilityNarrative/franchiseComparisonNarrative are
 * computed from deterministic figures and don't need citations).
 *
 * The live Gemini-grounding `GroundingSegment[]` array (text+urls+
 * confidences) that `attributeSegmentsToText` was built for is NEVER
 * persisted — it only exists transiently inside a single BIE run (§0
 * research confirmed this). What IS persisted and queryable by deal is
 * `buddy_research_evidence` — per-claim `claim`/`source_uris` rows written
 * by claimLedger.ts. This reshapes those rows into the same
 * `{text, urls, confidences}` shape so `attributeSegmentsToText` (the
 * repo's one citation-matching primitive) can be reused unmodified rather
 * than reimplementing text-overlap matching a second way.
 */

import type { GroundingSegment } from "@/lib/research/buddyIntelligenceEngine";
import { attributeSegmentsToText } from "@/lib/research/citationAttribution";
import type { FeasibilityNarratives } from "./types";

type SB = { from: (t: string) => any };

export const CITED_NARRATIVE_FIELDS = [
  "executiveSummary",
  "marketDemandNarrative",
  "locationSuitabilityNarrative",
] as const;

export type CitedNarrativeField = (typeof CITED_NARRATIVE_FIELDS)[number];

export type FeasibilityCitations = Record<CitedNarrativeField, string[]>;

type EvidenceRow = { claim: string | null; source_uris: unknown };

function asUrlArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((u): u is string => typeof u === "string");
}

/**
 * Loads the deal's most recently completed research mission's evidence
 * rows, reshaped as GroundingSegments, plus the deduped union of every
 * source URL found — the fallback `attributeSegmentsToText` returns when
 * no segment text overlaps a given narrative (a real citation, just not a
 * pinpointed one, is still better than none for a research-backed field).
 */
export async function loadDealGroundingSegments(
  dealId: string,
  sb: SB,
): Promise<{ segments: GroundingSegment[]; allUrls: string[] }> {
  const { data: mission } = await sb
    .from("buddy_research_missions")
    .select("id")
    .eq("deal_id", dealId)
    .eq("status", "complete")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!mission?.id) return { segments: [], allUrls: [] };

  const { data: evidenceRows } = await sb
    .from("buddy_research_evidence")
    .select("claim, source_uris")
    .eq("mission_id", mission.id);

  const rows = (evidenceRows ?? []) as EvidenceRow[];
  const segments: GroundingSegment[] = rows
    .filter((r) => typeof r.claim === "string" && r.claim.trim().length > 0)
    .map((r) => ({ text: r.claim as string, urls: asUrlArray(r.source_uris), confidences: [] }));

  const allUrls = Array.from(new Set(segments.flatMap((s) => s.urls)));
  return { segments, allUrls };
}

/**
 * Attributes citations for each research-backed narrative field. A field
 * with real narrative text but zero available URLs (no research ever ran
 * for this deal) comes back as an empty array — the caller decides whether
 * that's a completeness gap worth flagging.
 */
export function attributeFeasibilityCitations(
  narratives: FeasibilityNarratives,
  segments: GroundingSegment[],
  allUrls: string[],
): FeasibilityCitations {
  const result = {} as FeasibilityCitations;
  for (const field of CITED_NARRATIVE_FIELDS) {
    const text = narratives[field];
    result[field] = typeof text === "string" && text.length > 0
      ? attributeSegmentsToText(text, segments, allUrls)
      : [];
  }
  return result;
}

/**
 * Opens an idempotent banker task for every research-backed field that
 * ended up with zero citations — a deterministic completeness gate, NOT an
 * AI judgment (no verifier call here), so it uses the same
 * (deal_id, source="system", source_key) idempotent-insert pattern
 * directly rather than the AI-artifact verifier helper.
 */
export async function flagUncitedFeasibilityFields(args: {
  dealId: string;
  bankId: string;
  studyId: string;
  citations: FeasibilityCitations;
  sb: SB;
}): Promise<{ conditionsCreated: number; conditionsSkipped: number }> {
  const { dealId, bankId, studyId, citations, sb } = args;
  let conditionsCreated = 0;
  let conditionsSkipped = 0;

  for (const field of CITED_NARRATIVE_FIELDS) {
    if (citations[field].length > 0) continue;

    const sourceKey = `feasibility_citation_gap:${studyId}:${field}`;
    const existing = await sb
      .from("deal_conditions")
      .select("id")
      .eq("deal_id", dealId)
      .eq("source", "system")
      .eq("source_key", sourceKey)
      .maybeSingle();

    if (existing.data?.id) {
      conditionsSkipped += 1;
      continue;
    }

    const ins = await sb.from("deal_conditions").insert({
      deal_id: dealId,
      bank_id: bankId,
      title: `Feasibility study section has no source citations: ${field}`,
      description:
        "This section makes market-data claims but no grounded research source could be attributed to it.",
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
