import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("artifact queue claim failures cannot masquerade as an empty queue", () => {
  const source = read("src/lib/artifacts/processArtifact.ts");
  const claimFailureStart = source.indexOf("if (error) {", source.indexOf("claim_next_artifact_for_processing"));
  const emptyQueueStart = source.indexOf("if (!artifacts", claimFailureStart);
  const claimFailureBlock = source.slice(claimFailureStart, emptyQueueStart);

  assert.match(claimFailureBlock, /throw new Error\("artifact_claim_failed"\)/);
  assert.doesNotMatch(claimFailureBlock, /return null/);
  assert.match(
    source,
    /const result = await processNextArtifact\(\);\s*if \(!result\) break;/s,
  );
});

test("artifact batch failures make the scheduled invocation non-green", () => {
  const route = read("src/app/api/artifacts/process/route.ts");

  assert.match(route, /getCronOutcome\(summary\.failed\)/);
  assert.match(route, /ok: outcome\.ok/);
  assert.match(route, /status: outcome\.status/);
  assert.doesNotMatch(
    route,
    /return NextResponse\.json\(\{\s*ok: true,\s*\.\.\.summary/s,
  );
});
