import { test } from "node:test";
import assert from "node:assert/strict";

import { createBuilderUploadHandler } from "@/lib/builder/builderUploadCore";

type FakeSupabaseRow = Record<string, any>;

type FakeSupabase = {
  from: (table: string) => any;
};

function createFakeSupabase(): FakeSupabase {
  return {
    from(table: string) {
      const builder: any = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle: async () => {
          if (table === "deals") {
            return { data: { id: "deal-1", bank_id: "bank-1" }, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (value: { data: FakeSupabaseRow[]; error: null }) => void) =>
          Promise.resolve(resolve({ data: [], error: null })),
      };
      return builder;
    },
  };
}

test("builder upload rejects missing token", async () => {
  const handler = createBuilderUploadHandler({
    mustBuilderToken: () => {
      throw new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
      });
    },
  } as any);

  const req = new Request(
    "http://localhost/api/builder/deals/deal-1/documents/upload",
    { method: "POST", body: new FormData() },
  );

  const res = await handler(req, { params: Promise.resolve({ dealId: "deal-1" }) });
  assert.equal(res.status, 401);
});

test("builder upload rejects missing file", async () => {
  const handler = createBuilderUploadHandler({
    mustBuilderToken: () => ({ ok: true }),
  } as any);

  const req = new Request(
    "http://localhost/api/builder/deals/deal-1/documents/upload",
    {
      method: "POST",
      headers: { "x-buddy-builder-token": "token" },
      body: new FormData(),
    },
  );

  const res = await handler(req, { params: Promise.resolve({ dealId: "deal-1" }) });
  assert.equal(res.status, 400);

  const json = await res.json();
  assert.equal(json.error, "missing_file");
});

test("builder upload accepts pdf and calls ingest", async () => {
  let ingestCalled = false;

  const handler = createBuilderUploadHandler({
    mustBuilderToken: () => ({ ok: true }),
    supabaseAdmin: () => createFakeSupabase() as any,
    resolveBuilderBankId: async () => "bank-1",
    initializeIntake: async () => ({ ok: true } as any),
    getSupabaseStorageClient: () =>
      ({
        from: () => ({
          upload: async () => ({ data: { path: "deal-1/uploads/test.pdf" }, error: null }),
        }),
      }) as any,
    ingestDocument: async () => {
      ingestCalled = true;
      return {
        documentId: "doc-1",
        checklistKey: "PFS_CURRENT",
        docYear: null,
        matchConfidence: 1,
        matchReason: "task_selected",
      } as any;
    },
    logLedgerEvent: async () => undefined,
    getLatestLockedQuoteId: async () => null,
    verifyUnderwriteCore: async () => ({ ok: false, recommendedNextAction: "checklist_incomplete" }),
  } as any);

  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array([1, 2, 3])], "test.pdf", {
      type: "application/pdf",
    }),
  );

  const req = new Request(
    "http://localhost/api/builder/deals/deal-1/documents/upload",
    {
      method: "POST",
      headers: { "x-buddy-builder-token": "token" },
      body: form,
    },
  );

  const res = await handler(req, { params: Promise.resolve({ dealId: "deal-1" }) });
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.document.id, "doc-1");
  assert.equal(ingestCalled, true);
});
