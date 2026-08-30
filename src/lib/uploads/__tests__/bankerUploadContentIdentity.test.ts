import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function recordRouteSource(): Promise<string> {
  return readFile(
    path.join(
      process.cwd(),
      "src/app/api/deals/[dealId]/files/record/route.ts",
    ),
    "utf8",
  );
}

test("banker upload commit verifies stored bytes before canonical materialization", async () => {
  const source = await recordRouteSource();
  const verifyAt = source.indexOf("const storedBytes = await withTimeout(");
  const materializeAt = source.indexOf('.from("deal_documents")\n        .insert(doc as any)');
  const progressAt = source.indexOf('.update({ status: "completed", completed_at:');

  assert.ok(verifyAt >= 0, "stored bytes must be downloaded for verification");
  assert.ok(materializeAt > verifyAt, "deal_documents must follow stored-byte verification");
  assert.ok(progressAt > materializeAt, "progress must follow canonical document persistence");
  assert.doesNotMatch(
    source,
    /storage\s*\n?\s*\.from\(resolvedBucket\)\s*\n?\s*\.list\(/,
    "a best-effort storage listing cannot prove upload completion",
  );
});

test("banker upload commit persists only server-proven identity and metadata", async () => {
  const source = await recordRouteSource();

  assert.match(
    source,
    /\.select\("id, filename, content_type, size_bytes, status, object_key, bucket"\)/,
  );
  assert.match(source, /original_filename: pendingSessionFile\.originalFilename/);
  assert.match(source, /mime_type: pendingSessionFile\.contentType/);
  assert.match(source, /size_bytes: storedIdentity\.sizeBytes/);
  assert.match(source, /sha256: storedIdentity\.sha256/);
  assert.match(source, /expectedSizeBytes: pendingSessionFile\.expectedSizeBytes/);
  assert.match(source, /expectedSha256: sha256 \?\? null/);
});

test("upload progress mutations require returned-row proof", async () => {
  const source = await recordRouteSource();

  assert.match(source, /upload_session_file_commit_failed/);
  assert.match(source, /upload_session_progress_read_failed/);
  assert.match(source, /upload_session_commit_failed/);
  assert.match(source, /deal_upload_progress_commit_failed/);
  assert.match(
    source,
    /\.update\(\{ status: nextSessionStatus \}\)[\s\S]*?\.select\("id, status"\)[\s\S]*?\.maybeSingle\(\)/,
  );
  assert.match(
    source,
    /\.update\(\{ intake_state: nextState \}\)[\s\S]*?\.select\("id, intake_state"\)[\s\S]*?\.maybeSingle\(\)/,
  );
});
