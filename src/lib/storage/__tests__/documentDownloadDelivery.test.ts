import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.join(process.cwd(), file), "utf8");
}

test("document delivery proves stored identity before creating a provider URL", async () => {
  const helper = await source("src/lib/storage/documentDownloadDelivery.ts");
  const downloadAt = helper.indexOf("await downloadDocumentBytes");
  const verifyAt = helper.indexOf("verifyDocumentContentIdentity", downloadAt);
  const signAt = helper.indexOf("await createDocumentDownloadUrl");

  assert.ok(downloadAt >= 0);
  assert.ok(verifyAt > downloadAt);
  assert.ok(signAt > verifyAt);
  assert.match(helper, /DOCUMENT_DOWNLOAD_TTL_SECONDS = 60/);
  assert.match(
    helper,
    /document\.size_bytes !== null && document\.size_bytes !== undefined/,
  );
  assert.match(helper, /!hasStoredSize \|\| !Number\.isSafeInteger\(expectedSizeBytes\)/);
  assert.match(helper, /expectedSha256: expectedSha256 \|\| null/);
  assert.match(helper, /document_integrity_check_failed/);
});

test("canonical signed-url route ignores caller bucket claims and proves canonical bytes", async () => {
  const route = await source("src/app/api/deals/[dealId]/files/signed-url/route.ts");
  // The canonical lookup, tenant binding and byte proof moved into the shared
  // helper so both download surfaces inherit them; the properties are unchanged
  // and are asserted at their new location.
  const helper = await source("src/lib/storage/createAuthorizedDocumentDownload.ts");

  assert.match(
    helper,
    /select\("id, deal_id, bank_id, storage_bucket, storage_path, size_bytes, sha256"\)/,
  );
  assert.match(helper, /proveCanonicalDocumentDownload\(/);
  // Stronger than the previous in-route comparison: tenancy is enforced in the
  // query itself, so a foreign row is never fetched at all.
  assert.match(helper, /\.eq\("bank_id", bankId\)/);
  assert.match(helper, /document_integrity_unavailable/);

  assert.doesNotMatch(route, /body\?\.storage_bucket|body\.storage_bucket/);
  // Neither surface may sign for itself — signing belongs to the proof path.
  assert.doesNotMatch(route, /signGcsReadUrl|\.createSignedUrl\(/);
  assert.doesNotMatch(helper, /signGcsReadUrl|\.createSignedUrl\(/);
  assert.doesNotMatch(route, /docErr\.message|signErr\?\.message/);
});

test("document redirect fails closed on state and byte-integrity failures", async () => {
  const route = await source(
    "src/app/api/deals/[dealId]/files/[documentId]/download/route.ts",
  );
  const helper = await source("src/lib/storage/createAuthorizedDocumentDownload.ts");

  // Ordering is preserved, now inside the helper: canonical lookup, then byte
  // proof, then durable audit — and only then is a URL returned to the caller.
  const lookupAt = helper.indexOf('.from("deal_documents")');
  const proofAt = helper.indexOf("proveCanonicalDocumentDownload(");
  const auditAt = helper.indexOf('.from("deal_pipeline_ledger")');
  const returnAt = helper.indexOf("return {\n    ok: true,");

  assert.ok(lookupAt >= 0);
  assert.ok(proofAt > lookupAt);
  assert.ok(auditAt > proofAt);
  assert.ok(returnAt > auditAt);

  // The route redirects only to a URL the helper vouched for.
  const callAt = route.indexOf("createAuthorizedDocumentDownload(");
  const redirectAt = route.indexOf("NextResponse.redirect(result.signedUrl");
  assert.ok(callAt >= 0);
  assert.ok(redirectAt > callAt);
  assert.match(route, /if \(!result\.ok\) return json\(result\.error, result\.status\)/);

  assert.match(helper, /document_state_unavailable/);
  assert.match(helper, /document_integrity_unavailable/);
  assert.doesNotMatch(route, /error\?\.message \|\| "Internal server error"/);
});

test("legacy signer requires a bank-owned canonical row before signing", async () => {
  const route = await source("src/app/api/storage/signed-url/route.ts");
  const authorizeAt = route.indexOf("await assertDealAccess(parsedKey.dealId)");
  const canonicalAt = route.indexOf('.from("deal_documents")');
  const bankAt = route.indexOf('.eq("bank_id", access.bankId)');
  const pathAt = route.indexOf('.eq("storage_path", parsedKey.normalizedKey)');
  const proofAt = route.indexOf("await proveCanonicalDocumentDownload(document)");

  assert.ok(authorizeAt >= 0);
  assert.ok(canonicalAt > authorizeAt);
  assert.ok(bankAt > canonicalAt);
  assert.ok(pathAt > bankAt);
  assert.ok(proofAt > pathAt);
  assert.doesNotMatch(route, /getSupabaseStorageClient/);
  assert.doesNotMatch(route, /\.from\("deal_uploads"\)\.createSignedUrl/);
  assert.match(route, /documents\.download_signed/);
});
