import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();

const require = createRequire(import.meta.url);
const { normalizeNarrativeForPdf } =
  require("../sbaPackageRenderer") as typeof import("../sbaPackageRenderer");

test("normalizes fenced JSON and removes Markdown presentation syntax", () => {
  const raw = "```json\n" + JSON.stringify({
    section: "**Precision machining** — borrower-specific narrative.",
  }) + "\n```";
  const result = normalizeNarrativeForPdf(raw);
  assert.equal(result, "Precision machining — borrower-specific narrative.");
  assert.doesNotMatch(result, /```|\{|\}|\*\*/);
});

test("fails safely instead of printing malformed JSON", () => {
  assert.equal(
    normalizeNarrativeForPdf("```json\n{broken}\n```"),
    "Narrative unavailable due to an invalid generation response.",
  );
});
