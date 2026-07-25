import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCompletedLegalReview, markLegalReviewApproved, FORMS_REQUIRING_LEGAL_REVIEW } from "@/lib/sba/legalReview/service";

function fakeSb(rows: Array<{ deal_id: string; form_code: string; status: string }>) {
  const upserts: any[] = [];
  return {
    upserts,
    from(table: string) {
      if (table !== "sba_legal_document_reviews") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return this;
        },
        eq(this: any, col: string, val: string) {
          this._filters = { ...(this._filters ?? {}), [col]: val };
          return this;
        },
        limit() {
          return this;
        },
        async maybeSingle(this: any) {
          const match = rows.find(
            (r) => r.deal_id === this._filters.deal_id && r.form_code === this._filters.form_code && r.status === this._filters.status,
          );
          return { data: match ? { id: "row1" } : null };
        },
        async upsert(payload: any) {
          upserts.push(payload);
          return { error: null };
        },
      };
    },
  };
}

test("hasCompletedLegalReview: form codes outside the gated set are always allowed", async () => {
  const sb = fakeSb([]);
  assert.equal(await hasCompletedLegalReview("d1", "FORM_1919", sb as any), true);
});

test("hasCompletedLegalReview: gated form with no review row -> false (fail closed)", async () => {
  const sb = fakeSb([]);
  assert.equal(await hasCompletedLegalReview("d1", "FORM_SBA_NOTE", sb as any), false);
});

test("hasCompletedLegalReview: gated form with an approved row -> true", async () => {
  const sb = fakeSb([{ deal_id: "d1", form_code: "FORM_SBA_NOTE", status: "approved" }]);
  assert.equal(await hasCompletedLegalReview("d1", "FORM_SBA_NOTE", sb as any), true);
});

test("hasCompletedLegalReview: pending (not approved) row -> still false", async () => {
  const sb = fakeSb([{ deal_id: "d1", form_code: "FORM_SBA_NOTE", status: "pending" }]);
  assert.equal(await hasCompletedLegalReview("d1", "FORM_SBA_NOTE", sb as any), false);
});

test("markLegalReviewApproved: rejects a form code outside the gated set", async () => {
  const sb = fakeSb([]);
  const result = await markLegalReviewApproved(
    { dealId: "d1", bankId: "b1", formCode: "FORM_1919", reviewedBy: "u1" },
    sb as any,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "UNSUPPORTED_FORM_CODE");
});

test("markLegalReviewApproved: upserts an approved row for a gated form code", async () => {
  const sb = fakeSb([]);
  const result = await markLegalReviewApproved(
    { dealId: "d1", bankId: "b1", formCode: "FORM_SBA_AUTHORIZATION", reviewedBy: "u1", notes: "looks good" },
    sb as any,
  );
  assert.equal(result.ok, true);
  assert.equal(sb.upserts.length, 1);
  assert.equal(sb.upserts[0].status, "approved");
  assert.equal(sb.upserts[0].reviewed_by, "u1");
});

test("FORMS_REQUIRING_LEGAL_REVIEW: exactly the Note and Authorization", () => {
  assert.deepEqual([...FORMS_REQUIRING_LEGAL_REVIEW].sort(), ["FORM_SBA_AUTHORIZATION", "FORM_SBA_NOTE"]);
});
