import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertBoundedJsonContentLength,
  assertPreparedPortalUpload,
  MAX_PORTAL_UPLOAD_BYTES,
  parsePortalUploadCommitRequest,
  parsePortalUploadPrepareRequest,
  PortalUploadBoundaryError,
} from "../uploadCommitBoundary";

const ids = {
  deal: "11111111-1111-4111-8111-111111111111",
  bank: "22222222-2222-4222-8222-222222222222",
  session: "33333333-3333-4333-8333-333333333333",
  file: "44444444-4444-4444-8444-444444444444",
};

function commitBody(overrides: Record<string, unknown> = {}) {
  return {
    token: "borrower-token",
    filename: "2025-tax-return.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    uploadSessionId: ids.session,
    fileId: ids.file,
    path: `${ids.deal}/${ids.session}/2025-tax-return.pdf`,
    ...overrides,
  };
}

test("prepare requires a bounded positive file size", () => {
  assert.equal(parsePortalUploadPrepareRequest(commitBody()).sizeBytes, 1024);
  for (const sizeBytes of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => parsePortalUploadPrepareRequest(commitBody({ sizeBytes })),
      PortalUploadBoundaryError,
    );
  }
  assert.throws(
    () => parsePortalUploadPrepareRequest(commitBody({ sizeBytes: MAX_PORTAL_UPLOAD_BYTES + 1 })),
    (error: unknown) => error instanceof PortalUploadBoundaryError && error.status === 413,
  );
});

test("commit requires UUID session and file identities", () => {
  assert.equal(parsePortalUploadCommitRequest(commitBody(), null).fileId, ids.file);
  assert.throws(
    () => parsePortalUploadCommitRequest(commitBody({ fileId: "caller-file" }), null),
    PortalUploadBoundaryError,
  );
  assert.throws(
    () => parsePortalUploadCommitRequest(commitBody({ uploadSessionId: "session" }), null),
    PortalUploadBoundaryError,
  );
});

test("prepared upload is the authority for every storage and file claim", () => {
  const request = parsePortalUploadCommitRequest(commitBody(), null);
  const prepared = {
    session_id: ids.session,
    deal_id: ids.deal,
    bank_id: ids.bank,
    file_id: ids.file,
    filename: request.filename,
    content_type: request.mimeType,
    size_bytes: request.sizeBytes,
    object_key: request.path,
    bucket: "borrower_uploads",
    status: "ready",
  };
  const verified = assertPreparedPortalUpload({ prepared, request, dealId: ids.deal, bankId: ids.bank });
  assert.equal(verified.bucket, "borrower_uploads");
  assert.equal(verified.sizeBytes, 1024);

  for (const mutation of [
    { object_key: "other/path" },
    { filename: "other.pdf" },
    { content_type: "text/plain" },
    { size_bytes: 1023 },
    { bank_id: ids.deal },
    { deal_id: ids.bank },
  ]) {
    assert.throws(
      () => assertPreparedPortalUpload({ prepared: { ...prepared, ...mutation }, request, dealId: ids.deal, bankId: ids.bank }),
      (error: unknown) => error instanceof PortalUploadBoundaryError && error.status === 409,
    );
  }
});

test("JSON body limit fails closed", () => {
  assert.doesNotThrow(() => assertBoundedJsonContentLength("8192"));
  assert.throws(
    () => assertBoundedJsonContentLength("8193"),
    (error: unknown) => error instanceof PortalUploadBoundaryError && error.status === 413,
  );
  assert.throws(() => assertBoundedJsonContentLength("not-a-number"), PortalUploadBoundaryError);
});

test("route wiring verifies stored bytes before intake and persistence", () => {
  const route = readFileSync("src/app/api/portal/upload/commit/route.ts", "utf8");
  const verify = route.indexOf("verifyDocumentContentIdentity");
  const intake = route.indexOf("await initializeIntake");
  const record = route.indexOf("await recordBorrowerUploadAndMaterialize");
  assert.ok(verify >= 0 && intake > verify && record > intake);
  assert.match(route, /storageBucket: prepared\.bucket/);
  assert.match(route, /storagePath: prepared\.path/);
  assert.match(route, /sha256: identity\.sha256/);
  assert.doesNotMatch(route, /storageBucket: "borrower_uploads"/);
  assert.doesNotMatch(route, /stack: error/);
});

test("authoritative mutations require returned-row proof and non-green failures", () => {
  const route = readFileSync("src/app/api/portal/upload/commit/route.ts", "utf8");
  assert.match(route, /borrower_document_requests[\s\S]*\.eq\("deal_id", invite\.deal_id\)[\s\S]*\.select\("id, status"\)/);
  assert.match(route, /deal_upload_session_files[\s\S]*\.select\("id, status"\)/);
  assert.match(route, /deal_upload_sessions[\s\S]*\.select\("id, status"\)/);
  assert.match(route, /document_queue_unproven/);
  assert.doesNotMatch(route, /swallow: don't block portal/);
  assert.doesNotMatch(route, /best-effort/);
  assert.match(route, /const status = known \? error\.status : 503/);
});

test("prepare persists and proves the browser's exact size", () => {
  const prepare = readFileSync("src/app/api/portal/upload/prepare/route.ts", "utf8");
  assert.match(prepare, /sizeBytes: input\.sizeBytes/);
  assert.match(prepare, /Number\(row\.size_bytes\) !== input\.sizeBytes/);
  assert.doesNotMatch(prepare, /sizeBytes: 0/);
  assert.match(prepare, /cache-control": "no-store"/);
});
