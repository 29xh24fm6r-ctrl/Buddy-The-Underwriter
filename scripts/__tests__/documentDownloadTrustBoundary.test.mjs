import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helper = readFileSync("src/lib/storage/createAuthorizedDocumentDownload.ts", "utf8");
const direct = readFileSync("src/app/api/deals/[dealId]/files/[documentId]/download/route.ts", "utf8");
const signer = readFileSync("src/app/api/deals/[dealId]/files/signed-url/route.ts", "utf8");

test("document signing is tenant-bound and uses only authoritative storage coordinates", () => {
  assert.match(helper, /\.eq\("deal_id", dealId\)/);
  assert.match(helper, /\.eq\("bank_id", bankId\)/);
  assert.match(helper, /doc\.storage_bucket \|\| defaultDocumentBucket\(\)/);
  assert.doesNotMatch(signer, /body\?\.storage_bucket|body\.storage_bucket/);
  assert.match(helper, /Number\(Boolean\(documentId\)\) \+ Number\(Boolean\(requestedPath\)\) !== 1/);
});

test("signed delivery requires durable audit evidence and redacts internal coordinates", () => {
  assert.match(helper, /\.from\("deal_pipeline_ledger"\)/);
  assert.match(helper, /\.select\("id, deal_id, bank_id, event_key, status"\)/);
  assert.match(helper, /audit\.data\.deal_id !== dealId/);
  assert.doesNotMatch(helper, /logLedgerEventRequired/);
  assert.match(helper, /download_audit_unavailable/);
  assert.doesNotMatch(helper, /storage_path:/);
  assert.doesNotMatch(helper, /storage_bucket:/);
  assert.doesNotMatch(direct, /error\?\.message|String\(error\)|console\.error/);
  assert.doesNotMatch(signer, /\.message|console\.error/);
});

test("both download surfaces are bounded and explicitly non-cacheable", () => {
  assert.match(helper, /MAX_STORAGE_PATH_LENGTH = 1_024/);
  assert.match(helper, /MAX_BUCKET_LENGTH = 128/);
  assert.match(helper, /expiresSeconds: 300/);
  assert.match(helper, /createSignedUrl\(storagePath, 300\)/);
  assert.match(helper, /withDocumentDownloadTimeout\(query\.maybeSingle\(\), 8_000\)/);
  assert.match(helper, /12_000/);
  assert.match(direct, /private, no-store, max-age=0/);
  assert.match(signer, /private, no-store, max-age=0/);
  assert.match(signer, /contentLength > 4_096/);
  assert.match(signer, /Buffer\.byteLength\(raw, "utf8"\) > 4_096/);
});
