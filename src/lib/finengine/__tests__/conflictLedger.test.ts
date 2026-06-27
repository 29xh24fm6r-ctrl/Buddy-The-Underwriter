import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  detectSlotConflicts,
  buildConflictLedgerRows,
  pickWinner,
  type FactRow,
} from "@/lib/finengine/conflictLedger";

let seq = 0;
function row(partial: Partial<FactRow>): FactRow {
  seq += 1;
  return {
    id: partial.id ?? `id-${seq}`,
    deal_id: partial.deal_id ?? "deal-1",
    bank_id: partial.bank_id ?? "bank-1",
    fact_type: partial.fact_type ?? "FINANCIAL_ANALYSIS",
    fact_key: partial.fact_key ?? "DSCR",
    owner_type: partial.owner_type ?? "DEAL",
    owner_entity_id: partial.owner_entity_id ?? null,
    fact_period_end: partial.fact_period_end ?? "2024-12-31",
    fact_value_num: partial.fact_value_num ?? null,
    is_superseded: partial.is_superseded ?? false,
    source_canonical_type: partial.source_canonical_type ?? null,
    created_at: partial.created_at ?? "2024-01-01T00:00:00Z",
    provenance: partial.provenance ?? null,
  };
}

describe("detectSlotConflicts", () => {
  it("flags a slot with two differing live values for the same key/period/owner", () => {
    const rows = [
      row({ id: "a", fact_value_num: 1.25, provenance: { source_ref: "computed:classic_spread:v2" } }),
      row({ id: "b", fact_value_num: 7.12, provenance: { source_ref: "computed:noi/total_debt" } }),
    ];
    const conflicts = detectSlotConflicts(rows);
    assert.equal(conflicts.length, 1);
    assert.deepEqual(conflicts[0].liveFactIds.sort(), ["a", "b"]);
  });

  it("does NOT flag a slot whose live values are identical (within rounding)", () => {
    const rows = [
      row({ id: "a", fact_value_num: 1.2500001, provenance: { source_ref: "computed:classic_spread:v2" } }),
      row({ id: "b", fact_value_num: 1.25, provenance: { source_ref: "computed:noi/total_debt" } }),
    ];
    assert.equal(detectSlotConflicts(rows).length, 0);
  });

  it("ignores superseded rows when detecting conflicts", () => {
    const rows = [
      row({ id: "a", fact_value_num: 1.25 }),
      row({ id: "b", fact_value_num: 7.12, is_superseded: true }),
    ];
    assert.equal(detectSlotConflicts(rows).length, 0);
  });

  it("separates slots by period and owner", () => {
    const rows = [
      row({ id: "a", fact_value_num: 1.25, fact_period_end: "2023-12-31" }),
      row({ id: "b", fact_value_num: 7.12, fact_period_end: "2024-12-31" }),
    ];
    // different periods -> two single-value slots -> no conflict
    assert.equal(detectSlotConflicts(rows).length, 0);
  });
});

describe("pickWinner (§2.3 / decision D3)", () => {
  it("never lets the hardcoded golden-run fact win", () => {
    const rows = [
      row({ id: "golden", fact_value_num: 7.12, provenance: { source_ref: "synthesis:golden_run:80fe6f7a" } }),
      row({ id: "real", fact_value_num: 1.25, provenance: { source_ref: "computed:classic_spread:v2" } }),
    ];
    const w = pickWinner(rows);
    assert.equal(w?.id, "real");
  });

  it("prefers the stronger source-quality rank", () => {
    const rows = [
      row({ id: "taxreturn", fact_value_num: 100, source_canonical_type: "BUSINESS_TAX_RETURN" }),
      row({ id: "ocr", fact_value_num: 200, provenance: { source_ref: "deal_documents:x", confidence: 0.2 } }),
    ];
    assert.equal(pickWinner(rows)?.id, "taxreturn");
  });

  it("tie-breaks deterministically by newest created_at then id", () => {
    const rows = [
      row({ id: "old", fact_value_num: 1, source_canonical_type: "BUSINESS_TAX_RETURN", created_at: "2024-01-01T00:00:00Z" }),
      row({ id: "new", fact_value_num: 2, source_canonical_type: "BUSINESS_TAX_RETURN", created_at: "2024-06-01T00:00:00Z" }),
    ];
    assert.equal(pickWinner(rows)?.id, "new");
  });

  it("returns null when only an ineligible hardcode row exists", () => {
    const rows = [row({ id: "golden", fact_value_num: 7.12, provenance: { source_ref: "synthesis:golden_run:x" } })];
    assert.equal(pickWinner(rows), null);
  });
});

describe("buildConflictLedgerRows", () => {
  it("shapes a resolved conflict with winner + losers superseded", () => {
    const rows = [
      row({ id: "a", fact_value_num: 1.25, source_canonical_type: "BUSINESS_TAX_RETURN" }),
      row({ id: "b", fact_value_num: 7.12, provenance: { source_ref: "deal_documents:x", confidence: 0.2 } }),
    ];
    const conflicts = detectSlotConflicts(rows);
    const ledger = buildConflictLedgerRows(conflicts);
    assert.equal(ledger.length, 1);
    const lr = ledger[0];
    assert.equal(lr.conflict_type, "cross_engine_value_mismatch");
    assert.equal(lr.status, "resolved");
    assert.equal(lr.resolved_fact_id, "a"); // tax return wins
    assert.deepEqual(conflicts[0].loserIds, ["b"]);
    assert.equal(lr.resolved_by, "finengine.phase0.source_rank");
  });

  it("leaves a golden-run-only conflict open (no eligible winner)", () => {
    const rows = [
      row({ id: "g1", fact_value_num: 7.12, provenance: { source_ref: "synthesis:golden_run:x" } }),
      // a second golden-run alias making it a multi-value slot but all ineligible
      row({ id: "g2", fact_value_num: 9.99, provenance: { source_ref: "synthesis:canonical_alias:x" } }),
    ];
    const conflicts = detectSlotConflicts(rows);
    const ledger = buildConflictLedgerRows(conflicts);
    assert.equal(ledger[0].status, "open");
    assert.equal(ledger[0].resolved_fact_id, null);
  });
});
