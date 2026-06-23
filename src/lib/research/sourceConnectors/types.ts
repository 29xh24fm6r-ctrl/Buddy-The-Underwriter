/**
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1
 *
 * Connector spine types. A "connector" is a Buddy-native official/free source
 * adapter that produces SNAPSHOTS (collected/failed/manual_attestation) and/or
 * source CANDIDATES (plans), always linked to a committee task and ALWAYS
 * requiring review. A connector NEVER sets committee_grade_accepted and never
 * clears a committee blocker — acceptance flows through the separate #485 review
 * actions. Failed connectors are non-fatal and surface limitations.
 *
 * Pure types module — no server-only, no DB.
 */

export type SourceConnectorKind =
  | "borrower_website"
  | "manual_url"
  | "secretary_of_state"
  | "business_registry"
  | "public_adverse_screen"
  | "bls"
  | "census"
  | "fred"
  | "sec_edgar"
  | "trade_or_market_source"
  | "competitor_source";

export type SourceConnectorMode =
  | "auto_fetch"
  | "manual_url"
  | "manual_attestation"
  | "candidate_plan";

export type SourceSnapshotStatus =
  | "collected"
  | "failed"
  | "candidate"
  | "manual_attestation";

/** A snapshot row destined for buddy_research_source_snapshots. */
export type SourceSnapshotInput = {
  mission_id: string;
  deal_id: string;
  source_url: string;
  source_type: string;
  status: SourceSnapshotStatus;
  http_status?: number | null;
  content_hash?: string | null;
  content_type?: string | null;
  title?: string | null;
  byte_size?: number | null;
  error?: string | null;
  // SPEC-…-OFFICIAL-PDF-CAPTURE-1 Phase 1: actual captured source content carried
  // through to artifact persistence (HTML utf8 text / native-PDF base64).
  captured_content?: string | null;
  captured_content_encoding?: "utf8" | "base64" | null;
  captured_format?: "html" | "pdf" | null;
};

/** A planned (not-yet-collected) source the banker/analyst can pursue. */
export type SourceCandidate = {
  label: string;
  source_url?: string | null;
  source_type: string;
  recommended_for_sections: string[];
  requirement_keys: string[];
  rationale: string;
  limitations: string[];
};

export type SourceConnectorResult = {
  ok: boolean;
  connector_kind: SourceConnectorKind;
  mode: SourceConnectorMode;
  task_id?: string | null;
  snapshots: SourceSnapshotInput[];
  candidates: SourceCandidate[];
  limitations: string[];
  error?: string | null;
  /** Invariant: connector output ALWAYS requires review — never auto-accepts. */
  requires_review: true;
};

// ── Phase 4: normalized registry evidence ────────────────────────────────────

export type RegistrySourceTier =
  | "tier_1_open_api_or_bulk"
  | "tier_2_html_portal"
  | "tier_3_manual_or_restricted";

export type RegistryEvidence = {
  legal_name?: string | null;
  trade_name?: string | null;
  entity_status?: string | null;
  entity_type?: string | null;
  jurisdiction?: string | null;
  registered_address?: string | null;
  registered_agent?: string | null;
  officer_names?: string[];
  filing_date?: string | null;
  source_url?: string | null;
  source_market?: string | null;
  source_tier: RegistrySourceTier;
  raw_data?: Record<string, unknown>;
  collected_at: string;
  /** Advisory only — never final / never auto-accepts. */
  entity_match_score?: number | null;
  limitations: string[];
};

// ── Phase 5: structured adverse screen ────────────────────────────────────────

export type AdverseScreenCategory = "court" | "regulatory" | "lien_judgment" | "sanctions_watchlist";

export type AdverseScreenResultType =
  | "no_public_adverse_records_found_attestation"
  | "potential_hit_needs_review"
  | "confirmed_adverse_record"
  | "unable_to_complete";

export type AdverseScreenTarget = { kind: "borrower_legal_name" | "dba" | "principal"; value: string };

export type AdverseScreenChecklistItem = {
  category: AdverseScreenCategory;
  label: string;
  candidate_url: string | null;
  supported: boolean; // whether Buddy can supply a deterministic candidate URL
  limitations: string[];
};

export type AdverseScreenPlan = {
  targets: AdverseScreenTarget[];
  checklist: AdverseScreenChecklistItem[];
  result_types: AdverseScreenResultType[];
  limitations: string[];
};

/** A recorded adverse-screen disposition. NEVER an unsupported adverse claim. */
export type AdverseScreenDisposition = {
  result_type: AdverseScreenResultType;
  category?: AdverseScreenCategory | null;
  note?: string | null;
  source_url?: string | null;
  attested_by?: string | null;
};
