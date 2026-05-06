// Server-only fact reconciliation.
//
// Pulls fact candidates from every source recognized by the memo input
// layer (financial facts, banker overrides, financial snapshot, pricing
// decision) and runs them through the pure detectFactConflicts engine.
// New conflicts are inserted into deal_fact_conflicts with status='open';
// existing rows for the same fact_key are NOT overwritten (banker
// resolutions are preserved).

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import {
  detectFactConflicts,
  RECONCILED_FACT_KEYS,
  type DetectedConflict,
  type FactCandidate,
} from "./detectFactConflicts";
import type { DealFactConflict } from "./types";

export type ReconcileDealFactsResult = {
  ok: true;
  candidatesEvaluated: number;
  conflictsDetected: number;
  conflictsInserted: number;
  existingOpen: number;
};

export async function reconcileDealFacts(args: {
  dealId: string;
}): Promise<
  | ReconcileDealFactsResult
  | { ok: false; reason: "tenant_mismatch" | "load_failed"; error?: string }
> {
  const access = await ensureDealBankAccess(args.dealId);
  if (!access.ok) {
    return { ok: false, reason: "tenant_mismatch", error: access.error };
  }
  const { bankId } = access;
  const sb = supabaseAdmin();

  const candidates = await loadFactCandidates(sb, args.dealId, bankId);
  const detected = detectFactConflicts(candidates);

  // Load currently open conflicts so we don't duplicate.
  const { data: existingRows } = await (sb as any)
    .from("deal_fact_conflicts")
    .select("id, fact_key, status")
    .eq("deal_id", args.dealId)
    .eq("bank_id", bankId);

  const openByKey = new Map<string, string>();
  for (const r of (existingRows ?? []) as Array<{
    id: string;
    fact_key: string;
    status: string;
  }>) {
    if (r.status === "open") openByKey.set(r.fact_key, r.id);
  }

  let inserted = 0;
  for (const conflict of detected) {
    if (openByKey.has(conflict.fact_key)) continue;
    const insertRow = {
      deal_id: args.dealId,
      bank_id: bankId,
      fact_key: conflict.fact_key,
      fact_type: conflict.fact_key,
      conflict_type: conflict.conflict_type,
      source_a: conflict.source_a,
      source_b: conflict.source_b,
      conflicting_values: [conflict.source_a, conflict.source_b],
      conflicting_fact_ids: [],
      status: "open",
    };
    const { error } = await (sb as any)
      .from("deal_fact_conflicts")
      .insert(insertRow);
    if (!error) inserted += 1;
  }

  return {
    ok: true,
    candidatesEvaluated: candidates.length,
    conflictsDetected: detected.length,
    conflictsInserted: inserted,
    existingOpen: openByKey.size,
  };
}

// ─── Candidate loaders ───────────────────────────────────────────────────────

async function loadFactCandidates(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
): Promise<FactCandidate[]> {
  const candidates: FactCandidate[] = [];
  const wanted = new Set<string>(RECONCILED_FACT_KEYS);

  // 1. deal_financial_facts — visible (non-superseded) rows.
  const { data: facts } = await (sb as any)
    .from("deal_financial_facts")
    .select(
      "fact_key, fact_value_num, fact_type, period_end, source_document_id, created_at",
    )
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("is_superseded", false);

  for (const f of (facts ?? []) as Array<{
    fact_key: string | null;
    fact_value_num: number | null;
    fact_type: string | null;
    period_end: string | null;
    source_document_id: string | null;
    created_at: string | null;
  }>) {
    if (!f.fact_key || !wanted.has(f.fact_key)) continue;
    candidates.push({
      fact_key: f.fact_key,
      source_label: factTypeToLabel(f.fact_type) || f.fact_key,
      source_role: factTypeToRole(f.fact_type),
      value: typeof f.fact_value_num === "number" ? f.fact_value_num : null,
      period_end: f.period_end,
      source_document_id: f.source_document_id,
      recorded_at: f.created_at,
    });
  }

  // 2. deal_memo_overrides — banker-entered values.
  const { data: overrideRow } = await (sb as any)
    .from("deal_memo_overrides")
    .select("overrides, updated_at")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .maybeSingle();
  const overrides =
    overrideRow && typeof (overrideRow as any).overrides === "object"
      ? ((overrideRow as any).overrides as Record<string, unknown>)
      : {};
  for (const key of wanted) {
    const v = overrides[`override_${key}`] ?? overrides[key];
    const num = coerceNumber(v);
    if (num !== null) {
      candidates.push({
        fact_key: key,
        source_label: "banker_override",
        source_role: "banker_override",
        value: num,
        period_end: null,
        recorded_at: (overrideRow as any)?.updated_at ?? null,
      });
    }
  }

  // 3. Latest financial snapshot — system of record post-spread.
  const { data: snapshot } = await (sb as any)
    .from("deal_financial_snapshots")
    .select("snapshot_json, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (snapshot && typeof (snapshot as any).snapshot_json === "object") {
    const snap = (snapshot as any).snapshot_json as Record<string, any>;
    const recordedAt = (snapshot as any).created_at as string | null;
    pushSnapshotCandidate(candidates, "revenue", snap.revenue?.value, recordedAt);
    pushSnapshotCandidate(candidates, "ebitda", snap.ebitda?.value, recordedAt);
    pushSnapshotCandidate(candidates, "net_income", snap.net_income?.value, recordedAt);
    pushSnapshotCandidate(
      candidates,
      "cash_flow_available",
      snap.cash_flow_available?.value,
      recordedAt,
    );
    pushSnapshotCandidate(
      candidates,
      "annual_debt_service",
      snap.annual_debt_service?.value,
      recordedAt,
    );
    pushSnapshotCandidate(candidates, "dscr", snap.dscr?.value, recordedAt);
  }

  // 4. Pricing decision — committee-grade loan amount source.
  const { data: pricing } = await (sb as any)
    .from("pricing_decisions")
    .select("loan_amount, decided_at")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (pricing) {
    const loanAmt = coerceNumber((pricing as any).loan_amount);
    if (loanAmt !== null) {
      candidates.push({
        fact_key: "loan_amount",
        source_label: "pricing_decision",
        source_role: "pricing_decision",
        value: loanAmt,
        period_end: null,
        recorded_at: (pricing as any).decided_at ?? null,
      });
    }
  }

  return candidates;
}

function pushSnapshotCandidate(
  candidates: FactCandidate[],
  factKey: string,
  value: unknown,
  recordedAt: string | null,
): void {
  const num = coerceNumber(value);
  if (num === null) return;
  candidates.push({
    fact_key: factKey,
    source_label: "financial_snapshot",
    source_role: "financial_snapshot",
    value: num,
    period_end: null,
    recorded_at: recordedAt,
  });
}

function factTypeToLabel(factType: string | null): string {
  if (!factType) return "";
  return factType.toLowerCase();
}

function factTypeToRole(factType: string | null): FactCandidate["source_role"] {
  const ft = (factType ?? "").toUpperCase();
  if (ft.includes("TAX") || ft.includes("BTR") || ft.includes("PTR")) {
    return "tax_return";
  }
  if (ft.includes("BANK") || ft.includes("STATEMENT")) return "bank_statement";
  if (ft.includes("BALANCE")) return "balance_sheet";
  if (ft.includes("INCOME") || ft.includes("T12") || ft.includes("PNL")) {
    return "income_statement";
  }
  if (ft.includes("RENT")) return "rent_roll";
  if (ft.includes("PERSONAL_INCOME") || ft === "PI") return "personal_income";
  return "income_statement";
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type LoadOpenFactConflictsResult = {
  ok: true;
  conflicts: DealFactConflict[];
};

export async function loadOpenFactConflicts(args: {
  dealId: string;
  bankId: string;
}): Promise<LoadOpenFactConflictsResult> {
  const sb = supabaseAdmin();
  const { data } = await (sb as any)
    .from("deal_fact_conflicts")
    .select("*")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .eq("status", "open");
  return {
    ok: true,
    conflicts: (data ?? []) as DealFactConflict[],
  };
}

export async function loadAllFactConflicts(args: {
  dealId: string;
  bankId: string;
}): Promise<DealFactConflict[]> {
  const sb = supabaseAdmin();
  const { data } = await (sb as any)
    .from("deal_fact_conflicts")
    .select("*")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .order("created_at", { ascending: false });
  return (data ?? []) as DealFactConflict[];
}
