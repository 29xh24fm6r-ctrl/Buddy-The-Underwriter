import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { recordReceipt } = require("../receipts") as typeof import("../receipts");

test("a persisted receipt succeeds without a second timeline write", async () => {
  const tables: string[] = [];
  const sb = {
    from(table: string) {
      tables.push(table);
      // The real DB trigger writes kind/visible_to_borrower in this INSERT's
      // transaction. A separate API write previously failed after commit.
      assert.equal(table, "deal_document_receipts");
      return {
        insert(row: Record<string, unknown>) {
          assert.deepEqual(row, {
            deal_id: "qa-deal", file_name: "budget.pdf",
            doc_type: null, source: "portal",
          });
          return { select: () => ({ single: async () => ({
            data: { id: "receipt-1", ...row }, error: null,
          }) }) };
        },
      };
    },
  };
  const result = await recordReceipt({
    dealId: "qa-deal", uploaderRole: "borrower", filename: "budget.pdf",
    skipFilenameMatch: true,
  }, sb as any);
  assert.deepEqual(tables, ["deal_document_receipts"]);
  assert.equal(result.receipt.filename, "budget.pdf");
  assert.equal(result.checklistUpdated, 0);
});

test("receipt or trigger persistence failure still blocks success", async () => {
  const failure = new Error("receipt transaction failed");
  const sb = { from: () => ({ insert: () => ({ select: () => ({
    single: async () => ({ data: null, error: failure }),
  }) }) }) };
  await assert.rejects(recordReceipt({
    dealId: "qa-deal", uploaderRole: "borrower", filename: "budget.pdf",
    skipFilenameMatch: true,
  }, sb as any), failure);
});
