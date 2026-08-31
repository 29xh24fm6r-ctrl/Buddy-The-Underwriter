import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "src/app/api/borrower/portal/[token]/generate-pdf/route.ts",
  "utf8",
);
const story = readFileSync("src/lib/sba/sbaBorrowerStory.ts", "utf8");

test("projection inputs are tenant-bound, authoritative, and fail closed", () => {
  assert.match(route, /\.eq\("id", ctx\.dealId\)[\s\S]*\.eq\("bank_id", ctx\.bankId\)/);
  assert.match(route, /assumptionsResult\.data\.status !== "confirmed"/);
  assert.match(route, /assumptions_state_unavailable/);
  assert.match(route, /financial_facts_unavailable/);
  assert.match(route, /research_state_unavailable/);
  assert.match(route, /projection_inputs_unavailable/);
  assert.match(story, /loadBorrowerStoryWithEvidence/);
  assert.match(story, /borrower_story_read_failed/);
  assert.doesNotMatch(story, /loadBorrowerStory error:/);
});

test("the projection model receives the governed opening-cash facts", () => {
  assert.match(route, /"SL_CASH",\s*"CASH"/);
  assert.match(route, /openingCash: getFact\("SL_CASH", "CASH"\)/);
});

test("stored PDF bytes and durable audit evidence gate successful delivery", () => {
  assert.match(route, /upsert: false/);
  assert.match(route, /bucket\.download\(pdfPath\)/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(route, /storedBytes\.length !== pdfBuffer\.length/);
  assert.match(route, /createSignedUrl\(pdfPath, 300\)/);
  assert.match(route, /\.from\("deal_pipeline_ledger"\)/);
  assert.match(route, /\.select\("id, deal_id, bank_id, event_key, status"\)/);
  assert.match(route, /audit\.data\.bank_id !== ctx\.bankId/);
  assert.match(route, /pdf_audit_unavailable/);
  assert.match(route, /bucket\.remove\(\[pdfPath\]\)/);
});

test("projection responses are bounded, redacted, and explicitly private", () => {
  assert.match(route, /MAX_TOKEN_LENGTH = 512/);
  assert.match(route, /MAX_PDF_BYTES = 25 \* 1024 \* 1024/);
  assert.match(route, /private, no-store, max-age=0/);
  assert.match(route, /return json\(\{ ok: true, pdfUrl \}\)/);
  assert.doesNotMatch(route, /pdfPath,\s*\n\s*\}\)/);
  assert.doesNotMatch(route, /console\.error/);
  assert.doesNotMatch(route, /uploadError\?\.message|signResult\?\.error\?\.message/);
});
