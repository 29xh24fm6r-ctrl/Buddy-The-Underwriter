import "server-only";

/**
 * SPEC-COMMITTEE-READY-FLOW-1 — Fix 1
 *
 * Generates a *proposed* decision snapshot from the current financial
 * snapshot. Used by the decision page on first visit (when no snapshot
 * exists yet) so the banker lands on a populated page rather than an
 * empty redirect loop.
 *
 * Inputs come from financial_snapshots (v1) — the active system the
 * recompute route still writes to. The proposed decision is derived
 * from DSCR as a deterministic placeholder; the underwriter promotes
 * (or replaces) it through the existing DecisionOnePager + override
 * flows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLatestCertifiedFloridaArmorySnapshot } from "@/lib/creditMemo/snapshot/loadLatestCertifiedSnapshot";

export type GenerateDecisionSnapshotInput = {
  dealId: string;
  bankId: string;
  sb: SupabaseClient;
};

export type GenerateDecisionSnapshotResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function generateDecisionSnapshot(
  input: GenerateDecisionSnapshotInput,
): Promise<GenerateDecisionSnapshotResult> {
  const { dealId, bankId, sb } = input;

  // 1. Load the most recent financial snapshot for this deal+bank.
  const { data: fsRow, error: fsErr } = await sb
    .from("financial_snapshots")
    .select("snapshot_json")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fsErr) return { ok: false, error: `financial_snapshots query failed: ${fsErr.message}` };
  if (!fsRow) return { ok: false, error: "No financial snapshot found" };

  const snap = (fsRow.snapshot_json ?? {}) as Record<string, any>;
  const dscr = readNum(snap?.dscr?.value_num);
  const annualDebtService = readNum(snap?.annual_debt_service?.value_num);
  const cashFlowAvailable = readNum(snap?.cash_flow_available?.value_num);
  const bankLoanTotal = readNum(snap?.bank_loan_total?.value_num);

  // 2. Derive a preliminary decision from DSCR.
  //    Conservative thresholds — banker must promote/override to finalize.
  const decision: "approve" | "approve_with_conditions" | "decline" =
    dscr != null && dscr >= 1.25
      ? "approve"
      : dscr != null && dscr >= 1.0
        ? "approve_with_conditions"
        : "decline";

  const confidence =
    dscr == null ? 0.5 : dscr >= 1.25 ? 0.85 : dscr >= 1.0 ? 0.65 : 0.7;

  const summary =
    dscr == null
      ? "Preliminary decision proposed without a DSCR signal. Banker review required."
      : `Preliminary decision derived from DSCR ${dscr.toFixed(2)}x. Banker review required.`;

  // 2b. Best-effort traceability link to whatever certified credit memo is
  //     on file right now (see the 20260713220000 migration). This decision
  //     is still computed independently from financial_snapshots — never
  //     from the memo — this link only records what the memo said at the
  //     moment the decision was proposed, for later audit. Must happen
  //     before the insert below: decision_snapshots becomes immutable once
  //     status='final', so there is no way to backfill this afterward.
  let creditMemoSnapshotId: string | null = null;
  let creditMemoDscr: number | null = null;
  try {
    const certified = await loadLatestCertifiedFloridaArmorySnapshot({ dealId, bankId });
    if (certified.ok) {
      creditMemoSnapshotId = certified.snapshot.meta.snapshot_id ?? null;
      creditMemoDscr = readNum(
        (certified.snapshot.canonical_memo as any)?.financial_analysis?.dscr?.value,
      );
    }
  } catch {
    // Non-fatal — the decision snapshot must not fail to generate just
    // because the traceability lookup had trouble.
  }

  // 3. Insert as a proposed snapshot. Defaults from the migration cover
  //    inputs/evidence/policy JSON; we populate inputs_json with the
  //    inputs we used so the source of the decision is traceable.
  const { data, error } = await sb
    .from("decision_snapshots")
    .insert({
      deal_id: dealId,
      status: "proposed",
      decision,
      decision_summary: summary,
      confidence,
      credit_memo_snapshot_id: creditMemoSnapshotId,
      credit_memo_dscr: creditMemoDscr,
      inputs_json: {
        dscr,
        annual_debt_service: annualDebtService,
        cash_flow_available: cashFlowAvailable,
        bank_loan_total: bankLoanTotal,
        source: "generateDecisionSnapshot:v1",
      },
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: `decision_snapshots insert failed: ${error.message}` };
  return { ok: true, id: data.id };
}

function readNum(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}
