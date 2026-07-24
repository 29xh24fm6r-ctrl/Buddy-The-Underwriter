import { test } from "node:test";
import assert from "node:assert/strict";
import { mockRequestSignature } from "@/lib/esign/signwell/mockService";

function makeSb(verified: boolean) {
  return {
    from(_table: string) {
      const q: any = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        not() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({
            data: verified ? { id: "verification-1", completed_at: "2026-01-01" } : null,
            error: null,
          });
        },
      };
      return q;
    },
  } as any;
}

const BASE_ARGS = {
  dealId: "deal-1",
  bankId: "bank-1",
  formCode: "SBA_1919",
  templateVersion: "v1",
  signerOwnershipEntityId: "owner-1",
  signerRole: "applicant" as const,
  signerEmail: "test@example.com",
  signerName: "Test Borrower",
};

test("mockRequestSignature: blocks when IAL2 is not completed, same as the real requestSignature", async () => {
  const result = await mockRequestSignature(BASE_ARGS, { sb: makeSb(false) });
  assert.deepEqual(result, { ok: false, reason: "IAL2_NOT_COMPLETED" });
});

test("mockRequestSignature: returns a mock submission + embed URL once IAL2 is verified", async () => {
  const result = await mockRequestSignature(BASE_ARGS, { sb: makeSb(true) });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.documentId, /^mock_/);
    assert.match(result.embedUrl, /^\/api\/brokerage\/deals\/deal-1\/borrower-actions\/mock-complete-esign\?/);
    assert.ok(result.embedUrl.includes(encodeURIComponent(result.documentId)));
    assert.ok(result.embedUrl.includes(encodeURIComponent("deal:deal-1:form:SBA_1919:signer:owner-1")));
  }
});
