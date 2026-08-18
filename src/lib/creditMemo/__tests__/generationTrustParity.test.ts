import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("finengine and legacy memo generation persist the same research trust evidence", () => {
  const route = readFileSync(
    resolve(process.cwd(), "src/app/api/deals/[dealId]/credit-memo/generate/route.ts"),
    "utf8",
  );
  assert.equal(
    route.match(/research_trust_grade:\s*currentTrustGrade/g)?.length,
    2,
    "both memo render paths must persist the current trust grade",
  );
  assert.equal(
    route.match(/research_trace_json:\s*researchTrace/g)?.length,
    2,
    "both memo render paths must persist the research trace",
  );
});
