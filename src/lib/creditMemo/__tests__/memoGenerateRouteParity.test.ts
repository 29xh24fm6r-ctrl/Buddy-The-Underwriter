import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/app/api/deals/[dealId]/credit-memo/generate/route.ts"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/lib/creditMemo/canonical/generateCanonicalMemoArtifact.ts"), "utf8");

test("memo generation has one canonical live path", () => {
  assert.match(route, /generateCanonicalMemoArtifact/);
  assert.doesNotMatch(route, /getAIProvider|memoRenderSource|ai_risk_runs/);
});

test("the shared precondition helper remains the one route gate", () => {
  assert.match(route, /enforceMemoGenerationPreconditions\(dealId\)/);
  assert.doesNotMatch(route, /loadAndEnforceResearchTrust|BLOCK_GENERATION/);
});

test("canonical service owns deterministic build, review, and one writer", () => {
  assert.match(service, /buildCanonicalCreditMemo/);
  assert.match(service, /verifyMemoNarratives/);
  assert.equal((service.match(/canonical_memo_narratives/g) ?? []).length, 1);
  assert.match(service, /input_hash:\s*inputHash/);
});
