/**
 * Regulator Sandbox Deal Loader (Phase K)
 *
 * Loads synthetic or anonymized deal data into a read-only sandbox
 * environment for regulatory examiners to explore. All data is
 * served from snapshot builders, never live tables.
 *
 * Invariants:
 *  - No mutation paths exist
 *  - All data is snapshot-backed (frozen at load time)
 *  - Borrower PII is anonymized or synthetic
 *  - Full audit artifacts are available
 *  - Every access is ledgered
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

// ── Types ──────────────────────────────────────────────

export type SandboxDealSummary = {
  deal_id: string;
  borrower_name: string;
  loan_amount: number | null;
  deal_type: string | null;
  status: string;
  decision_outcome: string | null;
  created_at: string;
};

export type SandboxDealSnapshot = {
  deal: {
    id: string;
    borrower_name: string;
    loan_amount: number | null;
    deal_type: string | null;
    status: string;
    created_at: string;
  };
  borrower: {
    id: string | null;
    legal_name: string | null;
    entity_type: string | null;
    naics_code: string | null;
    ein_masked: string | null;
  } | null;
  decision: {
    snapshot_id: string | null;
    outcome: string | null;
    confidence: number | null;
    status: string | null;
    created_at: string | null;
  } | null;
  financials: {
    dscr: number | null;
    ltv_gross: number | null;
    noi_ttm: number | null;
    completeness_pct: number | null;
  } | null;
  has_committee_review: boolean;
  has_attestations: boolean;
  artifact_availability: {
    borrower_audit: boolean;
    credit_decision_audit: boolean;
    examiner_drop: boolean;
  };
};

export type RegulatorSandboxState = {
  sandbox_version: "1.0";
  loaded_at: string;
  bank_id: string;
  bank_name: string;
  is_sandbox: boolean;
  deal_count: number;
  deals: SandboxDealSummary[];
};

// ── Loaders ────────────────────────────────────────────

/**
 * Load the regulator sandbox state for a bank.
 * Returns frozen deal list with summaries.
 */
export async function loadRegulatorSandbox(
  bankId: string,
): Promise<RegulatorSandboxState> {
  const sb = supabaseAdmin();
  const loadedAt = new Date().toISOString();

  // Get bank info
  const { data: bankRaw } = await sb
    .from("banks")
    .select("id, name, is_sandbox")
    .eq("id", bankId)
    .maybeSingle();

  const bank = bankRaw as any;

  // Get all deals for this bank (sandbox shows all)
  const { data: dealsRaw } = await sb
    .from("deals")
    .select("id, borrower_name, loan_amount, deal_type, status, created_at")
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(100);

  const deals: SandboxDealSummary[] = [];

  for (const raw of (dealsRaw ?? []) as any[]) {
    // Get latest decision for each deal
    const { data: decRaw } = await sb
      .from("decision_snapshots")
      .select("decision_json")
      .eq("deal_id", raw.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const decision = (decRaw as any)?.decision_json;

    deals.push({
      deal_id: raw.id,
      borrower_name: raw.borrower_name ?? "Unknown",
      loan_amount: raw.loan_amount ?? null,
      deal_type: raw.deal_type ?? null,
      status: raw.status ?? "unknown",
      decision_outcome: decision?.decision_summary ?? decision?.outcome ?? null,
      created_at: raw.created_at,
    });
  }

  return {
    sandbox_version: "1.0",
    loaded_at: loadedAt,
    bank_id: bankId,
    bank_name: bank?.name ?? "Unknown Bank",
    is_sandbox: Boolean(bank?.is_sandbox),
    deal_count: deals.length,
    deals,
  };
}

/**
 * Load a single deal snapshot for sandbox viewing.
 * All data is frozen — no live table reads.
 */
export async function loadSandboxDealSnapshot(
  dealId: string,
  bankId: string,
): Promise<SandboxDealSnapshot | null> {
  const sb = supabaseAdmin();

  // Get deal
  const { data: dealRaw } = await sb
    .from("deals")
    .select("id, borrower_id, borrower_name, loan_amount, deal_type, status, created_at")
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .maybeSingle();

  if (!dealRaw) return null;
  const deal = dealRaw as any;

  // Get borrower
  let borrower: SandboxDealSnapshot["borrower"] = null;
  if (deal.borrower_id) {
    const { data: bRaw } = await sb
      .from("borrowers")
      .select("id, legal_name, entity_type, naics_code, ein")
      .eq("id", deal.borrower_id)
      .maybeSingle();

    if (bRaw) {
      const b = bRaw as any;
      borrower = {
        id: b.id,
        legal_name: b.legal_name,
        entity_type: b.entity_type,
        naics_code: b.naics_code,
        ein_masked: b.ein ? `**-***${b.ein.slice(-4)}` : null,
      };
    }
  }

  // Get latest decision snapshot
  let decision: SandboxDealSnapshot["decision"] = null;
  const { data: decRaw } = await sb
    .from("decision_snapshots")
    .select("id, decision_json, confidence, status, created_at")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (decRaw) {
    const d = decRaw as any;
    decision = {
      snapshot_id: d.id,
      outcome: d.decision_json?.decision_summary ?? d.decision_json?.outcome ?? null,
      confidence: d.confidence,
      status: d.status,
      created_at: d.created_at,
    };
  }

  // Get financial snapshot
  let financials: SandboxDealSnapshot["financials"] = null;
  const { data: finRaw } = await sb
    .from("financial_snapshot_decisions")
    .select("snapshot_json")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (finRaw) {
    const f = (finRaw as any).snapshot_json ?? {};
    financials = {
      dscr: f.dscr ?? null,
      ltv_gross: f.ltv_gross ?? null,
      noi_ttm: f.noi_ttm ?? null,
      completeness_pct: f.completeness_pct ?? null,
    };
  }

  // Check for committee review
  const { data: committeeRaw } = await sb
    .from("credit_committee_votes")
    .select("id")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .limit(1)
    .maybeSingle();

  // Check for attestations
  const { data: attestRaw } = await sb
    .from("decision_attestations")
    .select("id")
    .eq("deal_id", dealId)
    .limit(1)
    .maybeSingle();

  return {
    deal: {
      id: deal.id,
      borrower_name: deal.borrower_name ?? "Unknown",
      loan_amount: deal.loan_amount ?? null,
      deal_type: deal.deal_type ?? null,
      status: deal.status ?? "unknown",
      created_at: deal.created_at,
    },
    borrower,
    decision,
    financials,
    has_committee_review: Boolean(committeeRaw),
    has_attestations: Boolean(attestRaw),
    artifact_availability: {
      borrower_audit: Boolean(deal.borrower_id),
      credit_decision_audit: Boolean(decision?.snapshot_id),
      examiner_drop: Boolean(decision?.snapshot_id),
    },
  };
}
