import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(p: string) {
  return fs.readFileSync(p, "utf8");
}

test("extractByDocType.ts must not reference page_count", () => {
  const p = path.join(process.cwd(), "src/lib/extract/router/extractByDocType.ts");
  const s = read(p);
  assert.ok(
    !/\bpage_count\b/.test(s),
    "extractByDocType.ts still references page_count — deal_documents does not have this column",
  );
});

test("extractWithGoogleDocAi.ts must not reference page_count", () => {
  const p = path.join(
    process.cwd(),
    "src/lib/extract/googleDocAi/extractWithGoogleDocAi.ts",
  );
  const s = read(p);
  assert.ok(
    !/\bpage_count\b/.test(s),
    "extractWithGoogleDocAi.ts still references page_count — deal_documents does not have this column",
  );
});
