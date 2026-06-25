/**
 * SPEC-LIFECYCLE-CHECKLIST-READINESS-CANONICAL-FLOW-1 — helper behavior.
 *
 * Required tests #1 (positive self-heal) and #2 (negative cases). Exercised
 * against an in-memory fake Supabase client injected via the helper's `sb` arg,
 * so the deterministic marking logic is covered without a DB.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { reconcileChecklistSatisfactionForDeal } from "../reconcileChecklistSatisfaction";

type Row = Record<string, any>;

/** Minimal fake supporting select(...).eq(deal_id) and update(...).eq(id). */
function makeSb(tables: { deal_checklist_items: Row[]; deal_documents: Row[] }) {
  return {
    from(table: keyof typeof tables) {
      let op: "select" | "update" | null = null;
      let payload: Row | null = null;
      const b: any = {
        select() {
          op = "select";
          return b;
        },
        update(p: Row) {
          op = "update";
          payload = p;
          return b;
        },
        eq(col: string, val: any) {
          const rows = tables[table] ?? [];
          if (op === "select") {
            return Promise.resolve({
              data: rows.filter((r) => r[col] === val),
              error: null,
            });
          }
          if (op === "update") {
            for (const r of rows) if (r[col] === val) Object.assign(r, payload);
            return Promise.resolve({ error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
      };
      return b;
    },
  };
}

const DEAL = "1d7e7c1b-6237-4f59-a8ba-0eb84dfa0057";

function omnicareItem(): Row {
  return {
    id: "ci-pfs",
    deal_id: DEAL,
    checklist_key: "PFS_CURRENT",
    status: "missing",
    required: true,
    received_at: "2026-06-18T17:48:07.000Z",
    received_document_id: "doc-pfs",
  };
}

function omnicareDoc(overrides: Row = {}): Row {
  return {
    id: "doc-pfs",
    deal_id: DEAL,
    checklist_key: null,
    canonical_type: "PFS",
    document_type: "PFS",
    quality_status: "PASSED",
    finalized_at: "2026-06-18",
    ...overrides,
  };
}

describe("reconcileChecklistSatisfactionForDeal — #1 positive", () => {
  test("Omnicare PFS_CURRENT missing + valid linked doc → received + satisfied_at", async () => {
    const item = omnicareItem();
    const sb = makeSb({ deal_checklist_items: [item], deal_documents: [omnicareDoc()] });

    const r = await reconcileChecklistSatisfactionForDeal({ dealId: DEAL, sb });

    assert.equal(r.ok, true);
    assert.equal(r.itemsMarkedReceived, 1);
    assert.deepEqual(r.repairedKeys, ["PFS_CURRENT"]);
    assert.equal(item.status, "received");
    assert.ok(item.satisfied_at, "satisfied_at must be stamped");
    assert.equal(item.received_at, "2026-06-18T17:48:07.000Z", "received_at preserved");
    assert.equal(item.received_document_id, "doc-pfs", "received_document_id preserved");
  });

  test("valid finalized PFS with checklist_key=null and NO pointer → satisfied via case (b)", async () => {
    const item: Row = { ...omnicareItem(), received_document_id: null };
    const sb = makeSb({ deal_checklist_items: [item], deal_documents: [omnicareDoc()] });

    const r = await reconcileChecklistSatisfactionForDeal({ dealId: DEAL, sb });
    assert.equal(r.itemsMarkedReceived, 1);
    assert.equal(item.status, "received");
  });
});

describe("reconcileChecklistSatisfactionForDeal — #2 negatives", () => {
  async function runWith(doc: Row) {
    const item = omnicareItem();
    const sb = makeSb({ deal_checklist_items: [item], deal_documents: [doc] });
    const r = await reconcileChecklistSatisfactionForDeal({ dealId: DEAL, sb });
    return { r, item };
  }

  test("inactive doc does not satisfy", async () => {
    const { r, item } = await runWith(omnicareDoc({ is_active: false }));
    assert.equal(r.itemsMarkedReceived, 0);
    assert.equal(item.status, "missing");
  });

  test("failed-quality doc does not satisfy", async () => {
    const { r, item } = await runWith(omnicareDoc({ quality_status: "FAILED" }));
    assert.equal(r.itemsMarkedReceived, 0);
    assert.equal(item.status, "missing");
  });

  test("rejected-quality doc does not satisfy", async () => {
    const { r, item } = await runWith(omnicareDoc({ quality_status: "REJECTED" }));
    assert.equal(r.itemsMarkedReceived, 0);
    assert.equal(item.status, "missing");
  });

  test("superseded doc does not satisfy", async () => {
    const { r, item } = await runWith(omnicareDoc({ quality_status: "SUPERSEDED" }));
    assert.equal(r.itemsMarkedReceived, 0);
    assert.equal(item.status, "missing");
  });

  test("wrong-type doc does not satisfy PFS_CURRENT", async () => {
    const { r, item } = await runWith(
      omnicareDoc({ canonical_type: "BUSINESS_TAX_RETURN", document_type: "business_tax_return" }),
    );
    assert.equal(r.itemsMarkedReceived, 0);
    assert.equal(item.status, "missing");
  });

  test("non-finalized doc without a pointer does not satisfy via case (b)", async () => {
    const item: Row = { ...omnicareItem(), received_document_id: null };
    const sb = makeSb({
      deal_checklist_items: [item],
      deal_documents: [omnicareDoc({ finalized_at: null })],
    });
    const r = await reconcileChecklistSatisfactionForDeal({ dealId: DEAL, sb });
    assert.equal(r.itemsMarkedReceived, 0);
    assert.equal(item.status, "missing");
  });
});

describe("reconcileChecklistSatisfactionForDeal — guardrails", () => {
  test("year-count keys (IRS_*) are skipped (left to year-aware reconcile)", async () => {
    const item = {
      id: "ci-btr",
      deal_id: DEAL,
      checklist_key: "IRS_BUSINESS_3Y",
      status: "missing",
      required: true,
      received_document_id: "doc-btr",
    };
    const sb = makeSb({
      deal_checklist_items: [item],
      deal_documents: [
        { id: "doc-btr", checklist_key: null, canonical_type: "BUSINESS_TAX_RETURN", document_type: "business_tax_return", quality_status: "PASSED", finalized_at: "2026-01-01" },
      ],
    });
    const r = await reconcileChecklistSatisfactionForDeal({ dealId: DEAL, sb });
    assert.equal(r.itemsMarkedReceived, 0);
    assert.equal(item.status, "missing");
  });

  test("optional (required=false) rows are not repaired", async () => {
    const item = { ...omnicareItem(), required: false };
    const sb = makeSb({ deal_checklist_items: [item], deal_documents: [omnicareDoc()] });
    const r = await reconcileChecklistSatisfactionForDeal({ dealId: DEAL, sb });
    assert.equal(r.itemsMarkedReceived, 0);
  });

  test("already-received rows are left untouched (idempotent)", async () => {
    const item = { ...omnicareItem(), status: "received" };
    const sb = makeSb({ deal_checklist_items: [item], deal_documents: [omnicareDoc()] });
    const r = await reconcileChecklistSatisfactionForDeal({ dealId: DEAL, sb });
    assert.equal(r.itemsMarkedReceived, 0);
  });
});
