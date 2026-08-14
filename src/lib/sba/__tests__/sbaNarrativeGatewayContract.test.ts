import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("shared SBA narrative helper does not constrain varied section JSON to an empty object", () => {
  const source = readFileSync("src/lib/sba/sbaPackageNarrative.ts", "utf8");
  const helper = source.slice(
    source.indexOf("export async function callGeminiJSON"),
    source.indexOf("/** Call 1:"),
  );
  assert.doesNotMatch(helper, /responseSchema\s*:\s*\{\s*type\s*:\s*["']object["']\s*\}/);
  assert.match(helper, /runRole\("generator"/);
});
