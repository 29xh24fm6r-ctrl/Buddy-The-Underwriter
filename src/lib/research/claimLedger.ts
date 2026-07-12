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
import type { BIEResult } from "./buddyIntelligenceEngine";
import { classifySourceUrl } from "./sourcePolicy";
import { fetchUrlSnapshot } from "./sourceSnapshot";

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

function makeClaimRecords(
  missionId: string,
  section: string,
  texts: (string | null | undefined)[],
  layer: "fact" | "inference" | "narrative",
  thread: string,
  sourceUrls: string[],
  confidence: number,
  memoFields: string[],
  extra?: Partial<ClaimRecord>,
): ClaimRecord[] {
  return texts
    .filter((t): t is string => !!t && t.trim().length > 10)
    .map((text) => ({
      mission_id: missionId,
      section,
      claim_text: text.slice(0, 2000),  // cap at 2000 chars per claim
      claim_layer: layer,
      thread_origin: thread,
      source_uris: sourceUrls.slice(0, 10),
      source_types: sourceUrls.slice(0, 10).map((u) => classifySourceUrl(u)),
      confidence,
      supports_memo_fields: memoFields,
      ...extra,
    }));
}

/**
 * Assemble structured claim records from a BIEResult.
 * Pure (no DB) — exported for the persistence regression test.
 */
export function buildClaimRecords(missionId: string, result: BIEResult): ClaimRecord[] {
  const claims: ClaimRecord[] = [];
  const ts = result.thread_sources;

  // Entity lock claims
  if (result.entity_lock) {
    const el = result.entity_lock;
    claims.push(...makeClaimRecords(
      missionId, "Entity Identification",
      [el.confirmed_name, el.disambiguation_notes, el.research_scope],
      "fact", "entity_lock", ts.entity_lock,
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
      "narrative", "borrower", ts.borrower, b.entity_confidence,
      ["borrower_profile", "business_summary"],
    ));
    claims.push(...makeClaimRecords(
      missionId, "Litigation and Risk",
      [b.litigation_and_risk],
      "fact", "borrower", ts.borrower, b.entity_confidence,
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
        "fact", "management", ts.management,
        profile.identity_confidence ?? 0.5,
        ["management_intelligence"],
        { identity_confirmed: profile.identity_confirmed },
      ));
      if (profile.red_flags) {
        claims.push(...makeClaimRecords(
          missionId, "Management Red Flags",
          [profile.red_flags],
          "fact", "management", ts.management,
          profile.identity_confirmed ? (profile.identity_confidence ?? 0.5) : 0.2,
          ["management_intelligence", "risk_factors"],
          { identity_confirmed: profile.identity_confirmed },
        ));
      }
    }
    claims.push(...makeClaimRecords(
      missionId, "Management Intelligence",
      [result.management.management_depth, result.management.key_person_risk, result.management.ownership_and_governance],
      "inference", "management", ts.management, 0.7,
      ["management_intelligence"],
    ));
  }

  // Competitive claims
  if (result.competitive) {
    claims.push(...makeClaimRecords(
      missionId, "Competitive Landscape",
      [result.competitive.competitive_dynamics, result.competitive.borrower_positioning,
       result.competitive.barriers_to_entry, result.competitive.pricing_environment],
      "narrative", "competitive", ts.competitive, 0.7,
      ["competitive_positioning"],
    ));
    for (const comp of result.competitive.direct_competitors) {
      claims.push({
        mission_id: missionId,
        section: "Competitive Landscape",
        claim_text: `${comp.name}: ${comp.description}. Strengths: ${comp.strengths}. Position: ${comp.market_position}`,
        claim_layer: "fact",
        thread_origin: "competitive",
        source_uris: ts.competitive.slice(0, 5),
        source_types: ts.competitive.slice(0, 5).map((u) => classifySourceUrl(u)),
        confidence: 0.65,
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
      "fact", "market", ts.market, 0.75,
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
      "fact", "industry", ts.industry, 0.80,
      ["industry_overview"],
    ));
  }

  // Transaction claims
  if (result.transaction) {
    claims.push(...makeClaimRecords(
      missionId, "Transaction Analysis",
      [result.transaction.primary_repayment_source, result.transaction.repayment_vulnerabilities,
       result.transaction.downside_case, result.transaction.stress_scenario],
      "inference", "transaction", ts.transaction, 0.65,
      ["transaction_analysis", "debt_coverage"],
    ));
  }

  // Synthesis claims
  if (result.synthesis) {
    claims.push(...makeClaimRecords(
      missionId, "Credit Thesis",
      [result.synthesis.executive_credit_thesis],
      "narrative", "synthesis", [], 0.70,
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
        confidence: 0.75,
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
        confidence: 0.70,
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
