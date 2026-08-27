import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("parseDealScopedStorageKey accepts canonical deal-scoped keys", async () => {
  const { parseDealScopedStorageKey } = await import("../legacyRouteAccess");
  assert.deepEqual(parseDealScopedStorageKey("deal-123/uploads/file.pdf"), {
    dealId: "deal-123",
    normalizedKey: "deal-123/uploads/file.pdf",
  });
});

test("parseDealScopedStorageKey rejects absolute and traversal keys", async () => {
  const { parseDealScopedStorageKey } = await import("../legacyRouteAccess");
  for (const key of [
    "/deal-123/file.pdf",
    "../other-deal/file.pdf",
    "deal-123/../other-deal/file.pdf",
    "deal-123\\file.pdf",
    "file.pdf",
  ]) {
    assert.equal(parseDealScopedStorageKey(key), null, key);
  }
});

test("clampSignedUrlTtl bounds private URL lifetime", async () => {
  const { clampSignedUrlTtl } = await import("../legacyRouteAccess");
  assert.equal(clampSignedUrlTtl(null), 600);
  assert.equal(clampSignedUrlTtl("invalid"), 600);
  assert.equal(clampSignedUrlTtl("1"), 60);
  assert.equal(clampSignedUrlTtl("120"), 120);
  assert.equal(clampSignedUrlTtl("3600"), 600);
});


test("signed URL route authorizes before privileged signing", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src/app/api/storage/signed-url/route.ts"),
    "utf8",
  );
  const authorizeAt = source.indexOf("await assertDealAccess(parsedKey.dealId)");
  const signAt = source.indexOf(".createSignedUrl(");
  assert.ok(authorizeAt >= 0);
  assert.ok(signAt > authorizeAt);
});

test("upload route authorizes before privileged storage writes", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src/app/api/storage/upload/route.ts"),
    "utf8",
  );
  const authorizeAt = source.indexOf("await assertDealAccess(dealId)");
  const supabaseUploadAt = source.indexOf(".upload(fileKey");
  const gcsUploadAt = source.indexOf("await fetch(signedUploadUrl");

  assert.ok(authorizeAt >= 0);
  assert.ok(supabaseUploadAt > authorizeAt);
  assert.ok(gcsUploadAt > authorizeAt);
});

test("deal upload inventory authorizes before filesystem reads", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src/app/api/deals/[dealId]/uploads/route.ts"),
    "utf8",
  );
  const authorizeAt = source.indexOf("await assertDealAccess(dealId)");
  const readAt = source.indexOf("await fs.readdir(dir)");

  assert.ok(authorizeAt >= 0);
  assert.ok(readAt > authorizeAt);
});

test("legacy upload commits both providers before reporting success", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src/app/api/storage/upload/route.ts"),
    "utf8",
  );
  const gcsWriteAt = source.indexOf("await fetch(signedUploadUrl");
  const firstCommitAt = source.indexOf("return await commitUploadedObject");
  const supabaseWriteAt = source.indexOf(".upload(fileKey");
  const secondCommitAt = source.indexOf(
    "return await commitUploadedObject",
    firstCommitAt + 1,
  );

  assert.ok(gcsWriteAt >= 0);
  assert.ok(firstCommitAt > gcsWriteAt);
  assert.ok(supabaseWriteAt > firstCommitAt);
  assert.ok(secondCommitAt > supabaseWriteAt);
  assert.match(source, /recordBorrowerUploadAndMaterialize/);
  assert.match(source, /deleteGcsObject/);
  assert.match(source, /\.remove\(\[data\.path\]\)/);
});

test("durable upload audit ownership is explicit before reconciliation", async () => {
  const source = await readFile(
    path.join(
      process.cwd(),
      "src/lib/uploads/recordBorrowerUploadAndMaterialize.ts",
    ),
    "utf8",
  );
  const ensureAt = source.indexOf("upload = await ensureBorrowerUploadRow");
  const preCommitErrorAt = source.indexOf(
    "Failed to persist upload audit row",
  );
  const reconcileAt = source.indexOf("await reconcileUploadsForDeal");
  const durableCommentAt = source.indexOf(
    "The audit row now owns the object",
  );

  assert.ok(ensureAt >= 0);
  assert.ok(preCommitErrorAt > ensureAt);
  assert.ok(reconcileAt > preCommitErrorAt);
  assert.ok(durableCommentAt > reconcileAt);
  assert.match(source, /new UploadCommitError\([\s\S]*?false/);
  assert.match(
    source.slice(durableCommentAt),
    /new UploadCommitError\([\s\S]*?true/,
  );
});

