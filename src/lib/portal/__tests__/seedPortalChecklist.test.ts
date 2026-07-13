import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const mod = require("../seedPortalChecklist") as typeof import("../seedPortalChecklist");
const { normalizeLoanTypeForChecklist, seedPortalChecklist } = mod;

test("normalizeLoanTypeForChecklist maps loose wizard-style aliases to the strict LoanType union", () => {
  assert.equal(normalizeLoanTypeForChecklist("SBA"), "SBA_7A");
  assert.equal(normalizeLoanTypeForChecklist("sba_7a"), "SBA_7A");
  assert.equal(normalizeLoanTypeForChecklist("sba7a"), "SBA_7A");
  assert.equal(normalizeLoanTypeForChecklist("SBA504"), "SBA_504");
  assert.equal(normalizeLoanTypeForChecklist("SBA_504"), "SBA_504");
  assert.equal(normalizeLoanTypeForChecklist("C&I"), "TERM");
  assert.equal(normalizeLoanTypeForChecklist("LOC"), "LOC");
  assert.equal(normalizeLoanTypeForChecklist("CRE"), "CRE");
});

test("normalizeLoanTypeForChecklist defaults unknown/empty loan types to CRE", () => {
  assert.equal(normalizeLoanTypeForChecklist(null), "CRE");
  assert.equal(normalizeLoanTypeForChecklist(undefined), "CRE");
  assert.equal(normalizeLoanTypeForChecklist(""), "CRE");
  assert.equal(normalizeLoanTypeForChecklist("something_unrecognized"), "CRE");
});

function makeMockSb(capture: { rows?: unknown[]; error?: { message: string } }) {
  return {
    from: (table: string) => ({
      upsert: async (rows: unknown[], opts: { onConflict: string }) => {
        assert.equal(table, "deal_portal_checklist_items");
        assert.equal(opts.onConflict, "deal_id,code");
        capture.rows = rows;
        return { error: capture.error ?? null };
      },
    }),
  };
}

test("seedPortalChecklist upserts one row per document with stable codes and required flags", async () => {
  const capture: { rows?: unknown[] } = {};
  const sb = makeMockSb(capture);
  const result = await seedPortalChecklist(sb as any, { dealId: "deal-1", loanType: "SBA" });

  assert.equal(result.seeded, true);
  assert.ok(result.count > 0);
  assert.equal(capture.rows?.length, result.count);

  const rows = capture.rows as Array<Record<string, unknown>>;
  assert.ok(rows.every((r) => r.deal_id === "deal-1"));
  assert.ok(rows.every((r) => typeof r.code === "string" && r.code.length > 0));
  assert.ok(rows.some((r) => r.code === "SBA_1919"));
  assert.ok(rows.some((r) => r.code === "PFS_CURRENT"));
});

test("seedPortalChecklist reports failure without throwing when the upsert errors", async () => {
  const sb = makeMockSb({ error: { message: "boom" } });
  const result = await seedPortalChecklist(sb as any, { dealId: "deal-1", loanType: "CRE" });
  assert.equal(result.seeded, false);
  assert.equal(result.count, 0);
});
