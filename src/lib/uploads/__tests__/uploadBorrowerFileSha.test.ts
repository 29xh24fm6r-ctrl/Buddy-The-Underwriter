import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

/**
 * Regression test for the six identical copies of 2025_TaxReturn.pdf on
 * deal b296dec2.
 *
 * The bytes go browser -> GCS directly, so only the client can hash them.
 * uploadBorrowerFile never did, `deal_documents.sha256` was NULL on every
 * borrower row, and the sha256 de-duplication the sign route already
 * implements had nothing to match on. Every re-upload became a new row.
 */

const { uploadBorrowerFile } =
  require("../uploadFile") as typeof import("../uploadFile");

type Captured = { url: string; body: any };

function installFetchStub(captured: Captured[]) {
  (globalThis as any).fetch = async (url: any, init: any = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    captured.push({ url: u, body });

    if (u.includes("/files/sign")) {
      return new Response(
        JSON.stringify({
          ok: true,
          upload_session_id: "sess-1",
          upload: {
            file_id: "f1",
            object_path: "deals/d1/f1.pdf",
            signed_url: "https://storage.example/put",
            upload_session_id: "sess-1",
            headers: { "Content-Type": "application/pdf" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u.includes("/files/record")) {
      return new Response(JSON.stringify({ ok: true, documentId: "doc-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
}

/** uploadViaSignedUrl uses XHR for byte progress; stub it to succeed. */
function installXhrStub() {
  class FakeXHR {
    upload = { addEventListener: () => {}, removeEventListener: () => {} };
    status = 200;
    readyState = 4;
    responseText = "";
    timeout = 0;
    onload: any = null;
    onerror: any = null;
    ontimeout: any = null;
    onabort: any = null;
    addEventListener(evt: string, fn: any) {
      if (evt === "load") this.onload = fn;
      if (evt === "error") this.onerror = fn;
      if (evt === "timeout") this.ontimeout = fn;
      if (evt === "abort") this.onabort = fn;
    }
    removeEventListener() {}
    open() {}
    setRequestHeader() {}
    send() { queueMicrotask(() => this.onload?.({} as any)); }
    abort() {}
    getAllResponseHeaders() { return ""; }
  }
  (globalThis as any).XMLHttpRequest = FakeXHR as any;
}

function makeFile(contents: string, name = "2025_TaxReturn.pdf"): File {
  return new File([contents], name, { type: "application/pdf" });
}

test("the borrower upload sends a sha256 to BOTH sign and record", async () => {
  const captured: Captured[] = [];
  installFetchStub(captured);
  installXhrStub();

  const result = await uploadBorrowerFile("deal-1", makeFile("%PDF-1.4 tax return"), null);
  assert.equal(result.ok, true, `upload should succeed: ${JSON.stringify(result)}`);

  const sign = captured.find((c) => c.url.includes("/files/sign"));
  const record = captured.find((c) => c.url.includes("/files/record"));
  assert.ok(sign, "sign must be called");
  assert.ok(record, "record must be called");

  // Without a hash on BOTH calls there is nothing to dedupe against: the
  // sign route's check has no input and the stored row has a NULL sha256.
  assert.match(
    String(sign!.body?.sha256 ?? ""),
    /^[0-9a-f]{64}$/,
    "sign must receive a 64-char hex sha256",
  );
  assert.match(
    String(record!.body?.sha256 ?? ""),
    /^[0-9a-f]{64}$/,
    "record must receive a 64-char hex sha256 so the row is not stored NULL",
  );
  assert.equal(sign!.body.sha256, record!.body.sha256, "both calls must carry the same hash");
});

test("identical content hashes identically, different content does not", async () => {
  const captured: Captured[] = [];
  installFetchStub(captured);
  installXhrStub();

  await uploadBorrowerFile("deal-1", makeFile("same bytes"), null);
  await uploadBorrowerFile("deal-1", makeFile("same bytes", "renamed.pdf"), null);
  await uploadBorrowerFile("deal-1", makeFile("different bytes"), null);

  const hashes = captured
    .filter((c) => c.url.includes("/files/record"))
    .map((c) => c.body.sha256);

  assert.equal(hashes.length, 3);
  assert.equal(
    hashes[0], hashes[1],
    "the same bytes under a different filename must produce the same hash — a borrower re-sending the same document is the case being deduped",
  );
  assert.notEqual(hashes[0], hashes[2], "different bytes must not collide");
});

test("an upload still succeeds when SubtleCrypto is unavailable", async () => {
  // Insecure contexts have no crypto.subtle. A missing hash must degrade to
  // "upload without dedupe", never to a blocked upload.
  const captured: Captured[] = [];
  installFetchStub(captured);
  installXhrStub();

  const realCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
  try {
    const result = await uploadBorrowerFile("deal-1", makeFile("bytes"), null);
    assert.equal(result.ok, true, "upload must not be blocked by a missing hash");
    const record = captured.find((c) => c.url.includes("/files/record"));
    assert.equal(record!.body.sha256, null);
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: realCrypto, configurable: true });
  }
});
