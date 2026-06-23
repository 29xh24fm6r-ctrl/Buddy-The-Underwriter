import "server-only";

/**
 * loadLatestCertifiedFloridaArmorySnapshot
 *
 * Returns the most-recently banker-submitted Florida Armory v1 snapshot for a
 * given (deal, bank) pair from credit_memo_snapshots. Validates the snapshot's
 * schema_version + meta.bank_id + meta.deal_id before returning.
 *
 * Spec: SPEC — Make Florida Armory Snapshot the Only Committee Memo Source of Truth
 *
 * This is the single source of truth for committee-facing memo artifacts.
 * Callers (committee PDF, committee export, committee view) MUST go through
 * this loader; they may not call buildCanonicalCreditMemo directly.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FloridaArmoryMemoSnapshot } from "@/lib/creditMemo/snapshot/types";

export type LoadCertifiedSnapshotOk = {
  ok: true;
  snapshot: FloridaArmoryMemoSnapshot;
};

export type LoadCertifiedSnapshotErr = {
  ok: false;
  reason: "not_found" | "load_failed";
  error?: string;
};

export type LoadCertifiedSnapshotResult =
  | LoadCertifiedSnapshotOk
  | LoadCertifiedSnapshotErr;

export async function loadLatestCertifiedFloridaArmorySnapshot(args: {
  dealId: string;
  bankId: string;
}): Promise<LoadCertifiedSnapshotResult> {
  const { dealId, bankId } = args;
  if (!dealId || !bankId) {
    return { ok: false, reason: "load_failed", error: "missing_args" };
  }

  const sb = supabaseAdmin();
  let row: { memo_output_json: unknown } | null = null;
  try {
    const res = await (sb as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => {
                order: (
                  col: string,
                  opts: { ascending: boolean },
                ) => {
                  limit: (n: number) => {
                    maybeSingle: () => Promise<{
                      data: { memo_output_json: unknown } | null;
                      error: { message: string } | null;
                    }>;
                  };
                };
              };
            };
          };
        };
      };
    })
      .from("credit_memo_snapshots")
      .select("memo_output_json")
      .eq("deal_id", dealId)
      .eq("status", "banker_submitted")
      .order("memo_version", { ascending: false })
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (res.error) {
      return { ok: false, reason: "load_failed", error: res.error.message };
    }
    row = res.data;
  } catch (err) {
    return {
      ok: false,
      reason: "load_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!row || row.memo_output_json === null || row.memo_output_json === undefined) {
    return { ok: false, reason: "not_found" };
  }

  const validation = validateFloridaArmorySnapshot(row.memo_output_json, {
    dealId,
    bankId,
  });
  if (!validation.ok) {
    // Treat tenant/deal/schema mismatch as not_found so callers don't leak
    // the existence of another bank's submission for the same deal id.
    return { ok: false, reason: "not_found", error: validation.error };
  }

  return { ok: true, snapshot: validation.snapshot };
}

// ---------------------------------------------------------------------------
// Snapshot validation
// ---------------------------------------------------------------------------

type ValidationOk = { ok: true; snapshot: FloridaArmoryMemoSnapshot };
type ValidationErr = { ok: false; error: string };

export function validateFloridaArmorySnapshot(
  value: unknown,
  args: { dealId: string; bankId: string },
): ValidationOk | ValidationErr {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "memo_output_json_missing" };
  }
  const candidate = value as Partial<FloridaArmoryMemoSnapshot> & {
    schema_version?: unknown;
    meta?: { deal_id?: unknown; bank_id?: unknown };
  };
  if (candidate.schema_version !== "florida_armory_v1") {
    return { ok: false, error: "schema_version_mismatch" };
  }
  if (!candidate.meta || typeof candidate.meta !== "object") {
    return { ok: false, error: "meta_missing" };
  }
  if (candidate.meta.deal_id !== args.dealId) {
    return { ok: false, error: "deal_id_mismatch" };
  }
  if (candidate.meta.bank_id !== args.bankId) {
    return { ok: false, error: "bank_id_mismatch" };
  }
  return { ok: true, snapshot: value as FloridaArmoryMemoSnapshot };
}
