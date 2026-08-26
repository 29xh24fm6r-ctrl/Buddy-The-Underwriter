import { test } from "node:test";
import assert from "node:assert/strict";
import { mockRequestSignature } from "@/lib/esign/signwell/mockService";

function makeSb(verified: boolean) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const sb = {
    from(table: string) {
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
        order() {
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
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return q;
    },
  } as any;

  return { sb, inserts };
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
  const { sb, inserts } = makeSb(false);
  const result = await mockRequestSignature(BASE_ARGS, { sb });
  assert.deepEqual(result, { ok: false, reason: "IAL2_NOT_COMPLETED" });
  assert.equal(inserts.length, 0);
});

test("mockRequestSignature: returns a mock submission + embed URL once IAL2 is verified", async () => {
  const { sb, inserts } = makeSb(true);
  const result = await mockRequestSignature(BASE_ARGS, { sb });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.documentId, /^mock_/);
    assert.match(result.embedUrl, /^\/api\/brokerage\/deals\/deal-1\/borrower-actions\/mock-complete-esign\?/);
    assert.ok(result.embedUrl.includes(encodeURIComponent(result.documentId)));
    assert.ok(result.embedUrl.includes(encodeURIComponent("deal:deal-1:form:SBA_1919:signer:owner-1")));

    const tracking = inserts.find((entry) => entry.table === "signing_requests");
    assert.ok(tracking, "mock initiation must persist the same durable provenance as production");
    assert.equal(tracking.row.signwell_document_id, result.documentId);
    assert.equal(tracking.row.signer_ownership_entity_id, BASE_ARGS.signerOwnershipEntityId);
    assert.deepEqual(tracking.row.metadata, {
      template_version: BASE_ARGS.templateVersion,
      identity_verification_id: "verification-1",
      test_mode: true,
    });

    const requestedEvent = inserts.find((entry) => entry.table === "deal_events");
    assert.ok(requestedEvent, "mock initiation must emit an esign.requested event");
    assert.equal(requestedEvent.row.kind, "esign.requested");
  }
});
