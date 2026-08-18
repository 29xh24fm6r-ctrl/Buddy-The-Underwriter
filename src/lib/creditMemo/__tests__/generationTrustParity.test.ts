import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("the single canonical memo writer persists research trust evidence", () => {
  const route = readFileSync(
    resolve(process.cwd(), "src/app/api/deals/[dealId]/credit-memo/generate/route.ts"),
    "utf8",
  );
  const service = readFileSync(
    resolve(process.cwd(), "src/lib/creditMemo/canonical/generateCanonicalMemoArtifact.ts"),
    "utf8",
  );
  assert.match(route, /generateCanonicalMemoArtifact/);
  assert.match(service, /research_trust_grade:\s*researchTrustGrade/);
  assert.match(service, /research_trace_json:\s*researchTrace/);
});
