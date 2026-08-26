import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

test("document extraction enqueue failures propagate to the intake run", () => {
  const src = read("src/lib/intake/processing/queueDocExtractionOutbox.ts");
  assert.match(src, /throw new Error\(/);
  assert.doesNotMatch(src, /Non-fatal: log but don't throw/);
});

test("worker fan-out URL preserves NEXT_PUBLIC_APP_URL precedence", () => {
  const src = read("src/lib/intake/processing/processConfirmedIntake.ts");
  assert.match(
    src,
    /NEXT_PUBLIC_APP_URL \?\?\s*\(process\.env\.VERCEL_URL/,
  );
});

test("borrower upload completion follows ingestion and durable artifact queueing", () => {
  const src = read("src/app/api/portal/[token]/files/record/route.ts");
  const ingest = src.indexOf("const result = await ingestDocument");
  const queue = src.indexOf("await queueArtifact", ingest);
  const complete = src.indexOf("await completeUploadSessionFile", queue);
  assert.ok(ingest > 0, "canonical ingestion must exist");
  assert.ok(queue > ingest, "artifact queueing must follow canonical ingestion");
  assert.ok(complete > queue, "session completion must follow durable queueing");
  assert.equal(
    (src.match(/let dealIdForLog/g) ?? []).length,
    1,
    "error logging context must not be shadowed",
  );
});

test("duplicate uploads are cleaned and retries requeue the canonical document", () => {
  const src = read("src/app/api/portal/[token]/files/record/route.ts");
  assert.match(src, /sourceId: duplicate\.id/);
  assert.match(src, /removeRedundantUpload/);
});

test("remembered deal navigation is scoped to the current bank tenant", () => {
  const resolver = read("src/lib/navigation/resolveDealScopedRoute.ts");
  const hero = read("src/components/nav/HeroBar.tsx");
  assert.match(resolver, /lastDealKey\(bankId/);
  assert.match(hero, /getLastDealId\(currentBank\?\.id\)/);
  assert.match(hero, /setLastDealId\(activeDealId, currentBank\.id\)/);
});

test("OCR operations health uses the canonical document creation timestamp", () => {
  const src = read("src/app/admin/brokerage/uploads/page.tsx");
  assert.match(src, /original_filename, created_at, finalized_at/);
  assert.doesNotMatch(src, /uploaded_at/);
  assert.match(src, /\{!error && <StuckTable/);
});

test("raw uploaded bytes do not overstate borrower package completeness", () => {
  const src = read("src/lib/borrower/buildBorrowerDocumentExperienceViewModel.ts");
  const statuses = src.slice(
    src.indexOf("const RECEIVED_STATUSES"),
    src.indexOf("function buildPackageSummary"),
  );
  assert.doesNotMatch(statuses, /^\s*"uploaded",/m);
  assert.match(statuses, /^\s*"received",/m);
});
