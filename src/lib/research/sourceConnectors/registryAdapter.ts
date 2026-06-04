/**
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1 — Phase 4
 *
 * Registry / Secretary-of-State adapter. MVP: NO state scraping. Generates a
 * manual registry-source candidate + task guidance based on the borrower HQ
 * state, and a normalized RegistryEvidence shape (with source tiers) for when a
 * banker supplies registry data. entity_match_score is ADVISORY only — never
 * final, never auto-accepts. Pure module.
 */

import type { RegistryEvidence, SourceCandidate } from "./types";

/** Known SOS business-search portals (deterministic, safe). Others → manual. */
const STATE_SOS: Record<string, { name: string; url: string | null }> = {
  OK: { name: "Oklahoma Secretary of State — Business Entity Search", url: "https://www.sos.ok.gov/corp/corpInquiryFind.aspx" },
  CA: { name: "California Secretary of State — bizfileOnline", url: "https://bizfileonline.sos.ca.gov/search/business" },
  DE: { name: "Delaware Division of Corporations — Entity Search", url: "https://icis.corp.delaware.gov/Ecorp/EntitySearch/NameSearch.aspx" },
  FL: { name: "Florida Division of Corporations — Sunbiz", url: "https://search.sunbiz.org/Inquiry/CorporationSearch/ByName" },
  TX: { name: "Texas SOSDirect / Comptroller Taxable Entity Search", url: "https://mycpa.cpa.state.tx.us/coa/" },
  NY: { name: "New York DOS — Corporation & Business Entity Search", url: "https://apps.dos.ny.gov/publicInquiry/" },
};

const STATE_NAMES: Record<string, string> = {
  OK: "Oklahoma", CA: "California", DE: "Delaware", FL: "Florida", TX: "Texas", NY: "New York",
};

function normalizeState(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (t.length === 2) return t.toUpperCase();
  const upper = t.toUpperCase();
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    if (name.toUpperCase() === upper) return code;
  }
  return null;
}

/**
 * Plan a registry / SOS source candidate from the borrower HQ state. Always
 * returns at least one candidate (a national/business-registry fallback) plus a
 * state SOS candidate when the state is recognized.
 */
export function planRegistrySources(opts: {
  hqState?: string | null;
  legalName?: string | null;
}): SourceCandidate[] {
  const code = normalizeState(opts.hqState);
  const name = (opts.legalName ?? "the borrower").trim() || "the borrower";
  const out: SourceCandidate[] = [];

  if (code && STATE_SOS[code]) {
    const sos = STATE_SOS[code];
    out.push({
      label: sos.name,
      source_url: sos.url,
      source_type: "secretary_of_state",
      recommended_for_sections: ["Entity Identification", "Borrower Profile"],
      requirement_keys: ["entity_sos_or_attestation"],
      rationale: `Confirm ${name}'s legal entity, status, and officers via the ${STATE_NAMES[code]} Secretary of State business registry.`,
      limitations: [
        "Manual lookup — attach the result URL/snapshot; entity match is advisory and requires analyst review.",
      ],
    });
  } else {
    out.push({
      label: `Secretary of State business-entity search${code ? ` (${STATE_NAMES[code] ?? code})` : ""}`,
      source_url: null,
      source_type: "secretary_of_state",
      recommended_for_sections: ["Entity Identification", "Borrower Profile"],
      requirement_keys: ["entity_sos_or_attestation"],
      rationale: `Look up ${name} in the Secretary of State business registry for the state of formation/operation and attach the record.`,
      limitations: [
        code ? "No deterministic portal URL on file for this state — perform the lookup manually." : "HQ state unknown — confirm the state of formation, then look up the SOS record.",
        "Entity match is advisory and requires analyst review.",
      ],
    });
  }

  // National/business-registry aggregator fallback (free tier).
  out.push({
    label: "Business registry aggregator (OpenCorporates)",
    source_url: "https://opencorporates.com/companies",
    source_type: "business_registry",
    recommended_for_sections: ["Entity Identification", "Borrower Profile"],
    requirement_keys: ["entity_sos_or_attestation"],
    rationale: `Cross-check ${name} against an aggregated business registry as a secondary confirmation of the legal entity.`,
    limitations: [
      "Aggregators can be stale or incomplete — prefer the state SOS record; entity match is advisory.",
    ],
  });

  return out;
}

/** Human task guidance for the SOS/registry committee task. */
export function registryTaskGuidance(hqState?: string | null): string {
  const code = normalizeState(hqState);
  if (code && STATE_SOS[code]) {
    return `Look up the borrower in the ${STATE_NAMES[code]} Secretary of State business registry (${STATE_SOS[code].url}), confirm legal name / status / officers, and attach the record URL.`;
  }
  return "Confirm the borrower's state of formation, look up the Secretary of State / business registry record, and attach the record URL (or a borrower legal attestation).";
}

const REGISTRY_TIERS = new Set([
  "tier_1_open_api_or_bulk",
  "tier_2_html_portal",
  "tier_3_manual_or_restricted",
]);

/** Validate a (banker-supplied) RegistryEvidence payload. Advisory match only. */
export function validateRegistryEvidence(raw: unknown): { ok: boolean; error?: string; evidence?: RegistryEvidence } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "registry_evidence_not_object" };
  const r = raw as Record<string, unknown>;
  if (!REGISTRY_TIERS.has(String(r.source_tier))) {
    return { ok: false, error: "invalid_or_missing_source_tier" };
  }
  if (!r.collected_at || typeof r.collected_at !== "string") {
    return { ok: false, error: "missing_collected_at" };
  }
  const score = r.entity_match_score;
  if (score != null && (typeof score !== "number" || score < 0 || score > 1)) {
    return { ok: false, error: "entity_match_score_out_of_range" };
  }
  const evidence: RegistryEvidence = {
    legal_name: (r.legal_name as string) ?? null,
    trade_name: (r.trade_name as string) ?? null,
    entity_status: (r.entity_status as string) ?? null,
    entity_type: (r.entity_type as string) ?? null,
    jurisdiction: (r.jurisdiction as string) ?? null,
    registered_address: (r.registered_address as string) ?? null,
    registered_agent: (r.registered_agent as string) ?? null,
    officer_names: Array.isArray(r.officer_names) ? (r.officer_names as string[]) : [],
    filing_date: (r.filing_date as string) ?? null,
    source_url: (r.source_url as string) ?? null,
    source_market: (r.source_market as string) ?? null,
    source_tier: r.source_tier as RegistryEvidence["source_tier"],
    raw_data: (r.raw_data as Record<string, unknown>) ?? undefined,
    collected_at: r.collected_at as string,
    entity_match_score: score == null ? null : (score as number),
    limitations: Array.isArray(r.limitations) ? (r.limitations as string[]) : [],
  };
  return { ok: true, evidence };
}
