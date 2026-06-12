/**
 * SPEC-CLASSIC-SPREAD-CERTIFIED-NUMBER-SOURCES-1 (Phase 1)
 *
 * certifyFactSelection() turns raw deal_financial_facts into certified DIRECT-fact values:
 *   - drops superseded / rejected / system_invalidated facts (never selectable);
 *   - reconciles duplicate same-key/period/owner values via reconcileFinancialFacts
 *     (source rank → confidence → magnitude), so an OCR micro-value (WAGES_W2 = 3) can
 *     never beat a stronger same-key/period/owner fact (310,134);
 *   - applies the cross-fact relationship gates (AGI = 0 beside material wages, etc.) so an
 *     impossible value is rejected, not silently chosen;
 *   - emits FAILURES (filtered + rejected with reasons), never silent drops.
 *
 * Pure (no DB). The IO loaders pass already-fetched rows in. The output is a lookup of
 * certified direct values keyed by (fact_key, period, owner) plus the full reject/caveat
 * trace for the audit.
 */

import {
  reconcileFinancialFacts,
  type ReconcileFact,
  type RejectedFact,
  type ConfidenceTier,
} from "@/lib/financialFacts/reconcileFinancialFacts";

// Micro-stub thresholds (mirror reconcileFinancialFacts): a value at/above MATERIAL_MIN is
// "material"; below MICRO_ABS, or under TINY_RATIO of a material sibling, is a stub.
const MATERIAL_MIN = 1000;
const MICRO_ABS = 100;
const TINY_RATIO = 0.05;
import {
  certifiedDirectFact,
  type CertifiedSpreadValue,
} from "./certifiedSpreadValue";

/** A fact as loaded from deal_financial_facts, with the lifecycle columns certification needs. */
export type CertifiableFact = ReconcileFact & {
  id: string | null;
  is_superseded?: boolean | null;
  resolution_status?: string | null;
};

/** Resolution statuses that make a fact non-selectable regardless of value/confidence. */
const NON_SELECTABLE_STATUSES = new Set(["rejected", "system_invalidated"]);

export type FilteredFact = { fact: CertifiableFact; reason: string };

export type CertifiedSelection = {
  /** key `${fact_key}|${period}|${owner_type}|${owner_entity_id}` → certified direct value */
  byKeyPeriod: Map<string, CertifiedSpreadValue>;
  /** facts removed before reconciliation (superseded / rejected / system_invalidated) */
  filtered: FilteredFact[];
  /** facts excluded by reconciliation (duplicate / conflict / impossible-relationship) */
  rejected: RejectedFact[];
  confidenceTier: ConfidenceTier;
  caveats: string[];
  /** an unresolved conflict that must block canonical use (e.g. personal facts unusable) */
  blocked: boolean;
};

export function selectionKey(
  factKey: string,
  period: string | null,
  ownerType: string,
  ownerEntityId: string | null,
): string {
  return `${factKey}|${period ?? ""}|${ownerType}|${ownerEntityId ?? ""}`;
}

export function certifyFactSelection(facts: CertifiableFact[]): CertifiedSelection {
  const filtered: FilteredFact[] = [];
  const microRejected: RejectedFact[] = [];
  const selectable: CertifiableFact[] = [];

  for (const f of facts) {
    if (f.is_superseded === true) {
      filtered.push({ fact: f, reason: "superseded fact — never selectable" });
      continue;
    }
    const status = (f.resolution_status ?? "").toLowerCase();
    if (NON_SELECTABLE_STATUSES.has(status)) {
      filtered.push({ fact: f, reason: `resolution_status=${status} — never selectable` });
      continue;
    }
    if (f.fact_value_num === null) {
      filtered.push({ fact: f, reason: "null value — nothing to certify" });
      continue;
    }
    selectable.push(f);
  }

  // OCR micro-value rejection (spec hard rule): never let a tiny stub certify when a
  // materially-larger same-key/period/owner sibling exists. reconcileFinancialFacts can pick
  // the stub on its own because some weak extractors carry a high-priority "deterministic"
  // name (e.g. WAGES_W2 = 3 @ personalIncomeExtractor outranking 310,134 @ gemini), and its
  // own micro-guard only fires when the *winner* is material. Drop the contradicted stubs
  // here so reconcile only ever chooses among materially-plausible values.
  const groups = new Map<string, CertifiableFact[]>();
  for (const f of selectable) {
    const k = selectionKey(f.fact_key, f.fact_period_end, f.owner_type, f.owner_entity_id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  const reconcilable: CertifiableFact[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      reconcilable.push(group[0]);
      continue;
    }
    const maxMaterialAbs = Math.max(
      0,
      ...group.map((f) => Math.abs(f.fact_value_num as number)).filter((v) => v >= MATERIAL_MIN),
    );
    if (maxMaterialAbs === 0) {
      reconcilable.push(...group); // no material anchor — leave the group for reconcile/gates
      continue;
    }
    for (const f of group) {
      const abs = Math.abs(f.fact_value_num as number);
      const isStub = abs < MICRO_ABS || abs < maxMaterialAbs * TINY_RATIO;
      if (isStub) {
        microRejected.push({
          fact: f,
          conflictClass: "duplicate_active_same_key_period_owner",
          reason: `${f.fact_key} value ${f.fact_value_num} is an OCR micro-value contradicted by a material ${maxMaterialAbs} (same key/period/owner); rejected before selection.`,
        });
      } else {
        reconcilable.push(f);
      }
    }
  }

  const recon = reconcileFinancialFacts(reconcilable);

  const byKeyPeriod = new Map<string, CertifiedSpreadValue>();
  for (const sel of recon.selected) {
    // reconcileFinancialFacts passes original objects through, so the lifecycle/source
    // fields are intact on the selected winner.
    const f = sel as CertifiableFact;
    const key = selectionKey(f.fact_key, f.fact_period_end, f.owner_type, f.owner_entity_id);
    byKeyPeriod.set(
      key,
      certifiedDirectFact(f.fact_value_num, {
        factId: f.id ?? null,
        factKey: f.fact_key,
        documentId: f.source_document_id,
        canonicalType: f.source_canonical_type,
        confidence: f.confidence,
      }),
    );
  }

  return {
    byKeyPeriod,
    filtered,
    rejected: [...microRejected, ...recon.rejected],
    confidenceTier: recon.confidenceTier,
    caveats: recon.caveats,
    blocked: recon.blocked,
  };
}

/**
 * Look up a certified direct value for a (key, period) — optionally pinned to an owner.
 * When owner is omitted, returns the first matching key/period across owners (business
 * spreads are single-owner so this is unambiguous). Returns null when no certified value
 * exists for that slot (caller decides unavailable vs formula fallback).
 */
export function getCertified(
  selection: CertifiedSelection,
  factKey: string,
  period: string,
  ownerType?: string,
  ownerEntityId?: string | null,
): CertifiedSpreadValue | null {
  if (ownerType !== undefined) {
    return selection.byKeyPeriod.get(selectionKey(factKey, period, ownerType, ownerEntityId ?? null)) ?? null;
  }
  const prefix = `${factKey}|${period}|`;
  for (const [k, v] of selection.byKeyPeriod) {
    if (k.startsWith(prefix)) return v;
  }
  return null;
}
