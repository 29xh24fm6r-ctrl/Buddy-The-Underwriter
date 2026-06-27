import "server-only";

import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
import { stampProvenance } from "@/lib/finengine/provenance";

/** Sentinel values matching NOT NULL DEFAULT in the DB schema. */
export const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";
export const SENTINEL_DATE = "1900-01-01";

/** Material drift threshold — changes above this % trigger drift detection. */
export const MATERIAL_DRIFT_THRESHOLD = 0.10; // 10%

/**
 * Compute deterministic identity hash for a fact.
 * Must mirror `compute_fact_identity_hash()` in SQL.
 */
export function computeFactIdentityHash(args: {
  sourceDocumentId: string;
  factType: string;
  factKey: string;
  factPeriodStart: string;
  factPeriodEnd: string;
  ownerEntityId: string;
}): string {
  const input = [
    args.sourceDocumentId,
    args.factType,
    args.factKey,
    args.factPeriodStart,
    args.factPeriodEnd,
    args.ownerEntityId,
  ].join("|");
  return createHash("sha256").update(input).digest("hex");
}

/** Minimum valid financial period date — no real financial document predates this. */
export const MIN_VALID_PERIOD_DATE = "1990-01-01";

export async function upsertDealFinancialFact(args: {
  dealId: string;
  bankId: string;
  sourceDocumentId: string | null;

  factType: string;
  factKey: string;

  factValueNum: number | null;
  factValueText?: string | null;

  confidence: number | null;
  currency?: string;

  factPeriodStart?: string | null;
  factPeriodEnd?: string | null;

  provenance: FinancialFactProvenance;

  ownerType?: string;
  ownerEntityId?: string | null;
  sourceCanonicalType?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; skipped?: boolean }> {
  try {
    const sb = supabaseAdmin();

    const sourceDocId = args.sourceDocumentId ?? SENTINEL_UUID;
    const periodEnd = args.factPeriodEnd ?? SENTINEL_DATE;
    const ownerType = args.ownerType ?? "DEAL";
    const ownerEntityId = args.ownerEntityId ?? SENTINEL_UUID;

    // SPEC-EXTRACTION-PERIOD-INTEGRITY-1 Fix 1:
    // Reject sentinel and invalid period dates — a fact with no valid period
    // is worse than no fact. Sentinel 1900-01-01 means the extractor couldn't
    // determine the period; writing it pollutes spreads with phantom columns.
    if (!periodEnd || periodEnd <= MIN_VALID_PERIOD_DATE) {
      console.warn("[upsertDealFinancialFact] Skipping fact with invalid period date", {
        factKey: args.factKey,
        factType: args.factType,
        factPeriodEnd: args.factPeriodEnd,
        dealId: args.dealId,
      });
      return { ok: false, error: "invalid_period_date", skipped: true };
    }

    const periodStart = args.factPeriodStart ?? SENTINEL_DATE;

    // SPEC-FACT-DISAMBIGUATION-1: Resolve source_canonical_type.
    // If caller provided it, use it. Otherwise auto-resolve from deal_documents
    // when we have a real (non-sentinel) source document ID.
    let sourceCanonicalType = args.sourceCanonicalType ?? null;
    if (!sourceCanonicalType && sourceDocId !== SENTINEL_UUID) {
      try {
        const { data: docRow } = await (sb as any)
          .from("deal_documents")
          .select("canonical_type")
          .eq("id", sourceDocId)
          .maybeSingle();
        if (docRow?.canonical_type) {
          sourceCanonicalType = docRow.canonical_type as string;
        }
      } catch {
        // Non-fatal — fact still writes without the denormalized type
      }
    }

    // Phase 1A: Compute deterministic identity hash
    const identityHash = computeFactIdentityHash({
      sourceDocumentId: sourceDocId,
      factType: args.factType,
      factKey: args.factKey,
      factPeriodStart: periodStart,
      factPeriodEnd: periodEnd,
      ownerEntityId,
    });

    // Phase 6: Detect material drift on rerun
    let priorValueNum: number | null = null;
    let driftPct: number | null = null;
    if (args.factValueNum != null) {
      try {
        const { data: existing } = await (sb as any)
          .from("deal_financial_facts")
          .select("fact_value_num")
          .eq("fact_identity_hash", identityHash)
          .maybeSingle();

        if (existing?.fact_value_num != null) {
          priorValueNum = existing.fact_value_num;
          const oldVal = Number(priorValueNum);
          const newVal = args.factValueNum;
          if (oldVal !== 0 && Number.isFinite(oldVal) && Number.isFinite(newVal)) {
            driftPct = Math.abs(newVal - oldVal) / Math.abs(oldVal);
          }
        }
      } catch {
        // Non-fatal — drift detection is observational
      }
    }

    const row: Record<string, unknown> = {
      deal_id: args.dealId,
      bank_id: args.bankId,
      source_document_id: sourceDocId,
      fact_type: args.factType,
      fact_key: args.factKey,
      fact_period_start: periodStart,
      fact_period_end: periodEnd,
      fact_value_num: args.factValueNum,
      fact_value_text: args.factValueText ?? null,
      currency: args.currency ?? "USD",
      confidence: args.confidence,
      // SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 Phase 0: normalized provenance.
      // Every canonical fact write is stamped with `engine` + `version` (+ rank)
      // at this single chokepoint. Additive — no existing field is altered and
      // no computed value changes. Enforced by guard G2.
      provenance: stampProvenance(args.provenance, { sourceCanonicalType }),
      owner_type: ownerType,
      owner_entity_id: ownerEntityId,
      fact_identity_hash: identityHash,
      is_superseded: false,
      source_canonical_type: sourceCanonicalType,
    };

    // Phase 6: Include drift data if detected
    if (priorValueNum != null) {
      row.prior_value_num = priorValueNum;
    }
    if (driftPct != null) {
      row.drift_pct = driftPct;
    }

    const { error } = await (sb as any)
      .from("deal_financial_facts")
      .upsert(row, {
        onConflict:
          "deal_id,bank_id,source_document_id,fact_type,fact_key,fact_period_start,fact_period_end,owner_type,owner_entity_id",
      } as any);

    if (error) return { ok: false, error: error.message };

    // Phase 6: Emit material drift event when threshold exceeded
    if (driftPct != null && driftPct > MATERIAL_DRIFT_THRESHOLD) {
      try {
        const { writeEvent } = await import("@/lib/ledger/writeEvent");
        void writeEvent({
          dealId: args.dealId,
          kind: "fact.material_drift_detected",
          scope: "extraction",
          action: "drift_detected",
          requiresHumanReview: true,
          meta: {
            fact_key: args.factKey,
            fact_type: args.factType,
            source_document_id: sourceDocId,
            prior_value: priorValueNum,
            new_value: args.factValueNum,
            drift_pct: Math.round(driftPct * 10000) / 100, // e.g. 15.23%
            threshold_pct: MATERIAL_DRIFT_THRESHOLD * 100,
            fact_identity_hash: identityHash,
          },
        }).catch(() => {});
      } catch {
        // Non-fatal — drift event emission is observational
      }
    }

    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
