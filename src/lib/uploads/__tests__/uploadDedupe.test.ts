import test from "node:test";
import assert from "node:assert/strict";

import { directDealDocumentUpload, uploadBorrowerFile } from "@/lib/uploads/uploadFile";

/**
 * Both sign routes answer a recognised sha256 with
 * `{ ok: true, deduped: true, existingDocumentId }` and no upload block —
 * the deal already holds those exact bytes. The clients previously required
 * an upload block unconditionally, so a duplicate file was reported to the
 * user as "Failed to get signed URL" even though the server had done exactly
 * the right thing.
 */
function stubFetch(handler: (url: string, init?: any) => { status?: number; body: unknown }) {
  const previous = globalThis.fetch;
  const calls: string[] = [];

  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    calls.push(url);
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };

  return {
    calls,
    restore() {
      (globalThis as any).fetch = previous;
    },
  };
}

function pdf(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], "2025_TaxReturn.pdf", {
    type: "application/pdf",
  });
}

test("internal upload of a known file succeeds as a dedupe, not an error", async () => {
  const stub = stubFetch((url) => {
    if (url.includes("/files/sign")) {
      return { body: { ok: true, deduped: true, existingDocumentId: "doc-existing-1" } };
    }
    throw new Error(`unexpected request to ${url}`);
  });

  try {
    const result = await directDealDocumentUpload({
      dealId: "deal-1",
      file: pdf(),
      checklistKey: "tax_returns",
    });

    assert.equal(result.ok, true);
    assert.equal((result as any).file_id, "doc-existing-1");
    assert.equal((result as any).meta?.deduped, true);

    // No PUT and no record call — the bytes and the row already exist.
    assert.equal(
      stub.calls.some((u) => u.includes("/files/record")),
      false,
      "a deduped upload must not record a second document row",
    );
  } finally {
    stub.restore();
  }
});

test("borrower upload of a known file succeeds as a dedupe", async () => {
  const stub = stubFetch((url) => {
    if (url.includes("/files/sign")) {
      return { body: { ok: true, deduped: true, existingDocumentId: "doc-existing-2" } };
    }
    throw new Error(`unexpected request to ${url}`);
  });

  let progress = 0;
  try {
    const result = await uploadBorrowerFile("token-abc", pdf(), null, (pct) => {
      progress = pct;
    });

    assert.equal(result.ok, true);
    assert.equal((result as any).file_id, "doc-existing-2");
    assert.equal(progress, 100, "a deduped upload should finish its progress bar");
    assert.equal(stub.calls.some((u) => u.includes("/files/record")), false);
  } finally {
    stub.restore();
  }
});

test("internal upload sends a sha256 so the server can dedupe at all", async () => {
  let signBody: any = null;
  const stub = stubFetch((url, init) => {
    if (url.includes("/files/sign")) {
      signBody = JSON.parse(String(init?.body ?? "{}"));
      return { body: { ok: true, deduped: true, existingDocumentId: "doc-existing-3" } };
    }
    throw new Error(`unexpected request to ${url}`);
  });

  try {
    await directDealDocumentUpload({ dealId: "deal-1", file: pdf() });
    assert.ok(signBody, "sign was never called");
    assert.equal(
      typeof signBody.sha256,
      "string",
      "the internal path must send a hash — without it the dedupe can never fire",
    );
    assert.match(signBody.sha256, /^[0-9a-f]{64}$/);
  } finally {
    stub.restore();
  }
});

test("a genuine sign failure is still an error", async () => {
  const stub = stubFetch(() => ({ status: 500, body: { ok: false, error: "boom" } }));
  try {
    const result = await directDealDocumentUpload({ dealId: "deal-1", file: pdf() });
    assert.equal(result.ok, false);
  } finally {
    stub.restore();
  }
});
