/**
 * Claim Ledger — persists structured claims from BIE output to buddy_research_evidence.
 *
 * This converts the BIE's per-section text output into structured claim records
 * with full provenance: source URIs, thread origin, claim layer, confidence.
 *
 * These records enable:
 * - Line-by-line audit of every claim in the credit memo
 * - Quality gate computation by section
 * - Contradiction detection across threads
 * - Source type classification and weighting
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BIEResult, GroundingSegment } from "./buddyIntelligenceEngine";
import { classifySourceUrl, computeSourceQualityScore } from "./sourcePolicy";
import { fetchUrlSnapshot } from "./sourceSnapshot";
import { attributeSegmentsToText } from "./citationAttribution";

/**
 * Weight a claim's confidence by the trust of its own specific sources.
 *
 * FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md — deferred item, now
 * wired): confidence was previously a hardcoded per-section constant (e.g.
 * 0.80 for every Industry Overview claim) regardless of whether that
 * claim's sources were a .gov filing or an unclassifiable blog — two claims
 * in the same section with wildly different source quality got identical
 * confidence. Source trust can only DISCOUNT confidence, never boost it
 * above the base (same "never inflate trust" direction as provenance.ts's
 * adjusted_confidence, which is also always <= original_confidence) — a
 * claim with no sources at all (e.g. Credit Thesis, Contradictions,
 * Underwriting Questions, which are persisted with source_uris always
 * empty by construction) is discounted to half its base confidence, not
 * silently kept at the section's full confidence.
 */
function weightConfidenceBySourceTrust(baseConfidence: number, sourceUrls: string[]): number {
  const quality = computeSourceQualityScore(sourceUrls); // 0 when sourceUrls is empty
  const weighted = baseConfidence * (0.5 + 0.5 * quality);
  return Math.round(weighted * 100) / 100;
}

export type ClaimLayer = "fact" | "inference" | "narrative";

// SPEC-CLAIM-LEDGER-EVIDENCE-TYPE-MAPPING-1: must match the DB CHECK constraint
// buddy_research_evidence_evidence_type_check exactly.
export type ResearchEvidenceType =
  | "fact"
  | "inference"
  | "narrative_citation"
  | "external_document"
  | "financial_metric"
  | "benchmark_comparison";

export const RESEARCH_EVIDENCE_TYPES: readonly ResearchEvidenceType[] = [
  "fact",
  "inference",
  "narrative_citation",
  "external_document",
  "financial_metric",
  "benchmark_comparison",
] as const;

/**
 * Map a BIE claim_layer to a DB-allowed evidence_type.
 *
 * The bug this fixes: the insert wrote `evidence_type: claim_layer`, so a
 * `claim_layer = "narrative"` violated the evidence_type CHECK constraint and
 * every batch insert failed silently — buddy_research_evidence had 0 rows
 * all-time. "narrative" is the only layer whose name differs from the enum.
 */
export function mapClaimLayerToEvidenceType(layer: ClaimLayer): ResearchEvidenceType {
  switch (layer) {
    case "fact":
      return "fact";
    case "inference":
      return "inference";
    case "narrative":
      return "narrative_citation";
  }
}

export type ClaimRecord = {
  mission_id: string;
  section: string;
  claim_text: string;
  claim_layer: ClaimLayer;
  thread_origin: string;
  source_uris: string[];
  source_types: string[];
  confidence: number;
  supports_memo_fields: string[];
  identity_confirmed?: boolean;
  adversarial_check_id?: string;
};

/**
 * Convert a ClaimRecord into a buddy_research_evidence insert row.
 *
 * Populates the first-class columns (thread_origin, claim_layer, source_uris,
 * source_types, section, supports_memo_fields, identity_confirmed,
 * adversarial_check_id) and keeps supporting_data for backward compatibility.
 * Pure function — exported for the persistence regression test.
 */
export function toEvidenceRow(c: ClaimRecord) {
  return {
    mission_id: c.mission_id,
    evidence_type: mapClaimLayerToEvidenceType(c.claim_layer),
    claim: c.claim_text,
    confidence: c.confidence,
    // First-class provenance columns.
    thread_origin: c.thread_origin,
    claim_layer: c.claim_layer,
    source_uris: c.source_uris,
    source_types: c.source_types,
    section: c.section,
    supports_memo_fields: c.supports_memo_fields,
    identity_confirmed: c.identity_confirmed ?? null,
    adversarial_check_id: c.adversarial_check_id ?? null,
    // Backward-compatible mirror — do NOT rely on this as the only storage.
    supporting_data: {
      section: c.section,
      thread_origin: c.thread_origin,
      source_uris: c.source_uris,
      source_types: c.source_types,
      supports_memo_fields: c.supports_memo_fields,
      identity_confirmed: c.identity_confirmed,
      adversarial_check_id: c.adversarial_check_id,
    },
  };
}

/**
 * FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md — citation precision):
 * every claim in a thread previously carried the same pooled thread-wide
 * source list, so a Litigation and Risk claim could be "backed" by a source
 * that actually supported an unrelated Company Overview claim. Segments
 * (Gemini's per-text-segment grounding attribution) narrow each claim's
 * source_uris down to only the sources whose cited text actually overlaps
 * that specific claim, falling back to the pooled list when no segment
 * matches.
 */
function makeClaimRecords(
  missionId: string,
  section: string,
  texts: (string | null | undefined)[],
  layer: "fact" | "inference" | "narrative",
  thread: string,
  sourceUrls: string[],
  segments: GroundingSegment[],
  confidence: number,
  memoFields: string[],
  extra?: Partial<ClaimRecord>,
): ClaimRecord[] {
  return texts
    .filter((t): t is string => !!t && t.trim().length > 10)
    .map((text) => {
      const attributedSources = attributeSegmentsToText(text, segments, sourceUrls).slice(0, 10);
      return {
        mission_id: missionId,
        section,
        claim_text: text.slice(0, 2000),  // cap at 2000 chars per claim
        claim_layer: layer,
        thread_origin: thread,
        source_uris: attributedSources,
        source_types: attributedSources.map((u) => classifySourceUrl(u)),
        confidence: weightConfidenceBySourceTrust(confidence, attributedSources),
        supports_memo_fields: memoFields,
        ...extra,
      };
    });
}

/**
 * Assemble structured claim records from a BIEResult.
 * Pure (no DB) — exported for the persistence regression test.
 */
export function buildClaimRecords(missionId: string, result: BIEResult): ClaimRecord[] {
  const claims: ClaimRecord[] = [];
  const ts = result.thread_sources;
  const tseg = result.thread_segments;

  // Entity lock claims
  if (result.entity_lock) {
    const el = result.entity_lock;
    claims.push(...makeClaimRecords(
      missionId, "Entity Identification",
      [el.confirmed_name, el.disambiguation_notes, el.research_scope],
      "fact", "entity_lock", ts.entity_lock, tseg.entity_lock,
      el.entity_confidence,
      ["entity_confirmation", "borrower_profile"],
    ));
  }

  // Borrower claims
  if (result.borrower) {
    const b = result.borrower;
    claims.push(...makeClaimRecords(
      missionId, "Borrower Profile",
      [b.company_overview, b.reputation_and_reviews, b.recent_news, b.customer_base_and_reach],
      "narrative", "borrower", ts.borrower, tseg.borrower, b.entity_confidence,
      ["borrower_profile", "business_summary"],
    ));
    claims.push(...makeClaimRecords(
      missionId, "Litigation and Risk",
      [b.litigation_and_risk],
      "fact", "borrower", ts.borrower, tseg.borrower, b.entity_confidence,
      ["litigation_and_risk", "risk_factors"],
    ));
  }

  // Management claims — each profile is a separate claim
  if (result.management) {
    for (const profile of result.management.principal_profiles) {
      const profileTexts = [profile.background, profile.other_ventures, profile.track_record];
      claims.push(...makeClaimRecords(
        missionId, "Management Intelligence",
        profileTexts,
        "fact", "management", ts.management, tseg.management,
        profile.identity_confidence ?? 0.5,
        ["management_intelligence"],
        { identity_confirmed: profile.identity_confirmed },
      ));
      if (profile.red_flags) {
        claims.push(...makeClaimRecords(
          missionId, "Management Red Flags",
          [profile.red_flags],
          "fact", "management", ts.management, tseg.management,
          profile.identity_confirmed ? (profile.identity_confidence ?? 0.5) : 0.2,
          ["management_intelligence", "risk_factors"],
          { identity_confirmed: profile.identity_confirmed },
        ));
      }
    }
    claims.push(...makeClaimRecords(
      missionId, "Management Intelligence",
      [result.management.management_depth, result.management.key_person_risk, result.management.ownership_and_governance],
      "inference", "management", ts.management, tseg.management, 0.7,
      ["management_intelligence"],
    ));
  }

  // Competitive claims
  if (result.competitive) {
    claims.push(...makeClaimRecords(
      missionId, "Competitive Landscape",
      [result.competitive.competitive_dynamics, result.competitive.borrower_positioning,
       result.competitive.barriers_to_entry, result.competitive.pricing_environment],
      "narrative", "competitive", ts.competitive, tseg.competitive, 0.7,
      ["competitive_positioning"],
    ));
    for (const comp of result.competitive.direct_competitors) {
      const competitorText = `${comp.name}: ${comp.description}. Strengths: ${comp.strengths}. Position: ${comp.market_position}`;
      const competitorSources = attributeSegmentsToText(competitorText, tseg.competitive, ts.competitive).slice(0, 5);
      claims.push({
        mission_id: missionId,
        section: "Competitive Landscape",
        claim_text: competitorText,
        claim_layer: "fact",
        thread_origin: "competitive",
        source_uris: competitorSources,
        source_types: competitorSources.map((u) => classifySourceUrl(u)),
        confidence: weightConfidenceBySourceTrust(0.65, competitorSources),
        supports_memo_fields: ["competitive_positioning"],
      });
    }
  }

  // Market claims
  if (result.market) {
    claims.push(...makeClaimRecords(
      missionId, "Market Intelligence",
      [result.market.local_economic_conditions, result.market.demographic_trends,
       result.market.demand_drivers, result.market.area_specific_risks,
       result.market.real_estate_market],
      "fact", "market", ts.market, tseg.market, 0.75,
      ["market_dynamics"],
    ));
  }

  // Industry claims
  if (result.industry) {
    claims.push(...makeClaimRecords(
      missionId, "Industry Overview",
      [result.industry.industry_size_and_growth, result.industry.key_trends,
       result.industry.credit_risk_profile, result.industry.regulatory_landscape,
       result.industry.disruption_risks, result.industry.five_year_outlook],
      "fact", "industry", ts.industry, tseg.industry, 0.80,
      ["industry_overview"],
    ));
  }

  // Transaction claims
  if (result.transaction) {
    claims.push(...makeClaimRecords(
      missionId, "Transaction Analysis",
      [result.transaction.primary_repayment_source, result.transaction.repayment_vulnerabilities,
       result.transaction.downside_case, result.transaction.stress_scenario],
      "inference", "transaction", ts.transaction, tseg.transaction, 0.65,
      ["transaction_analysis", "debt_coverage"],
    ));
  }

  // Synthesis claims
  if (result.synthesis) {
    claims.push(...makeClaimRecords(
      missionId, "Credit Thesis",
      [result.synthesis.executive_credit_thesis],
      "narrative", "synthesis", [], [], 0.70,
      ["credit_thesis"],
    ));
    for (const contradiction of result.synthesis.contradictions_and_uncertainties) {
      claims.push({
        mission_id: missionId,
        section: "Contradictions",
        claim_text: contradiction,
        claim_layer: "inference",
        thread_origin: "synthesis",
        source_uris: [],
        source_types: [],
        // Always zero-source by construction (synthesized, not directly
        // cited) — weightConfidenceBySourceTrust discounts this to half the
        // base 0.75 rather than storing the full section confidence for a
        // claim with no independently checkable source.
        confidence: weightConfidenceBySourceTrust(0.75, []),
        supports_memo_fields: ["contradictions"],
        adversarial_check_id: "synthesis_contradiction",
      });
    }
    for (const question of result.synthesis.underwriting_questions) {
      claims.push({
        mission_id: missionId,
        section: "Underwriting Questions",
        claim_text: question,
        claim_layer: "inference",
        thread_origin: "synthesis",
        source_uris: [],
        source_types: [],
        confidence: weightConfidenceBySourceTrust(0.70, []),
        supports_memo_fields: ["underwriting_questions"],
      });
    }
  }

  return claims;
}

export type ClaimSourceSnapshot = {
  content_hash: string | null;
  http_status: number | null;
  byte_size: number | null;
  ok: boolean;
  snapshotted_at: string;
};

const MAX_URLS_TO_SNAPSHOT = 20;
const SNAPSHOT_CONCURRENCY = 3;

// Sections whose source citations carry the highest audit/liability
// stakes — prioritized when the unique-URL set is capped.
const HIGH_PRIORITY_SNAPSHOT_SECTIONS = new Set([
  "Litigation and Risk",
  "Borrower Profile",
  "Management Intelligence",
  "Entity Identification",
]);

/**
 * Resolve, hash, and record a bounded set of claim source URLs.
 *
 * FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md — deferred item, now
 * wired): claim source_uris were raw, unresolved Gemini grounding-redirect
 * URIs with no hash and no captured bytes — a citation next to an adverse
 * claim proved nothing about that specific claim being independently
 * re-verifiable later. Bounded to MAX_URLS_TO_SNAPSHOT (prioritizing the
 * highest-liability sections first) and fetched at limited concurrency to
 * stay well within the mission's overall time budget — this is a
 * best-effort audit-trail enhancement, never a gate input, and must never
 * block or materially slow mission completion. Uses fetchUrlSnapshot (the
 * generic, non-task-coupled connector — no domain guard, unlike the
 * borrower-website-only connector) since these are arbitrary web citations,
 * not a banker-attached committee-task source.
 */
async function snapshotClaimSources(claims: ClaimRecord[]): Promise<Map<string, ClaimSourceSnapshot>> {
  const priorityByUrl = new Map<string, number>(); // 0 = highest priority
  for (const c of claims) {
    const priority = HIGH_PRIORITY_SNAPSHOT_SECTIONS.has(c.section) ? 0 : 1;
    for (const url of c.source_uris) {
      const existing = priorityByUrl.get(url);
      if (existing === undefined || priority < existing) priorityByUrl.set(url, priority);
    }
  }

  const urls = [...priorityByUrl.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_URLS_TO_SNAPSHOT)
    .map(([url]) => url);

  const results = new Map<string, ClaimSourceSnapshot>();
  for (let i = 0; i < urls.length; i += SNAPSHOT_CONCURRENCY) {
    const batch = urls.slice(i, i + SNAPSHOT_CONCURRENCY);
    const snapshots = await Promise.all(batch.map((url) => fetchUrlSnapshot(url)));
    batch.forEach((url, idx) => {
      const snap = snapshots[idx];
      results.set(url, {
        content_hash: snap.content_hash,
        http_status: snap.http_status,
        byte_size: snap.byte_size,
        ok: snap.ok,
        snapshotted_at: new Date().toISOString(),
      });
    });
  }
  return results;
}

/**
 * Extract claim records from a BIEResult and persist them to buddy_research_evidence.
 * Called after BIE completes, before marking the mission complete.
 * Non-fatal — failure is logged but does not block mission completion.
 */
export async function persistClaimLedger(
  missionId: string,
  result: BIEResult,
): Promise<{ ok: boolean; claims_written: number; error?: string }> {
  const sb = supabaseAdmin();
  const claims = buildClaimRecords(missionId, result);

  if (claims.length === 0) {
    return { ok: true, claims_written: 0 };
  }

  // Idempotency (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md round 5):
  // buddy_research_evidence rows are plain inserts, not upserts. A resumed
  // mission (round 4) that retries the bie_enrichment stage after a partial
  // success — claim ledger ran, but a later step in the same block genuinely
  // threw before the stage's completion checkpoint was saved — would
  // otherwise re-insert every claim on top of the prior attempt's rows.
  // Deleting this mission's existing claim-ledger rows first makes every
  // call reflect exactly the current claim set. Scoped to thread_origin IS
  // NOT NULL so it never touches the verification.ts/provenance.ts summary
  // rows also written to this table (those never set thread_origin).
  const { error: cleanupErr } = await sb
    .from("buddy_research_evidence")
    .delete()
    .eq("mission_id", missionId)
    .not("thread_origin", "is", null);
  if (cleanupErr) {
    console.warn(
      "[claimLedger] pre-insert cleanup of this mission's existing claim rows failed (non-fatal, proceeding — a resumed retry could duplicate rows):",
      cleanupErr.message,
    );
  }

  let sourceSnapshots = new Map<string, ClaimSourceSnapshot>();
  try {
    sourceSnapshots = await snapshotClaimSources(claims);
    const okCount = [...sourceSnapshots.values()].filter((s) => s.ok).length;
    console.log(`[claimLedger] snapshotted ${okCount}/${sourceSnapshots.size} claim source URL(s)`);
  } catch (snapErr: any) {
    console.warn("[claimLedger] source snapshot pass failed (non-fatal):", snapErr?.message);
  }

  // Write to buddy_research_evidence in batches of 50
  let written = 0;
  const BATCH_SIZE = 50;
  for (let i = 0; i < claims.length; i += BATCH_SIZE) {
    const batch = claims.slice(i, i + BATCH_SIZE);
    // SPEC-CLAIM-LEDGER-EVIDENCE-TYPE-MAPPING-1: map claim_layer → DB-allowed
    // evidence_type and populate first-class provenance columns.
    const rows = batch.map((c) => {
      const row = toEvidenceRow(c);
      const snaps = c.source_uris.filter((u) => sourceSnapshots.has(u));
      if (snaps.length > 0) {
        (row.supporting_data as Record<string, unknown>).source_snapshots = snaps.map((u) => ({
          url: u,
          ...sourceSnapshots.get(u)!,
        }));
      }
      return row;
    });

    const { error } = await sb.from("buddy_research_evidence").insert(rows);
    if (error) {
      console.error("[claimLedger] batch insert failed:", error.message);
      return { ok: false, claims_written: written, error: error.message };
    }
    written += batch.length;
  }

  return { ok: true, claims_written: written };
}
