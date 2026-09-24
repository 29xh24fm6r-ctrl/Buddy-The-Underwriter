import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import { reviewCheckpointRpc } from "../../../../test/utils/reviewCheckpointClient";
import type { ReviewCheckpoint, ReviewCheckpointStore } from "../reviewCheckpoint";
mockServerOnly();
const require = createRequire(import.meta.url);
let provider: (role: string, req: { prompt: string }) => Promise<{ text: string }>;
require.cache[require.resolve("../gateway")] = { loaded: true, exports: { runRole: (role: string, req: { prompt: string }) => provider(role, req) } } as any;
const { finishInstitutionalArtifact, reviewContentHash } = require("../frontierArtifactFactory") as typeof import("../frontierArtifactFactory");
const { withReviewCheckpoint } = require("../reviewCheckpoint") as typeof import("../reviewCheckpoint");
const input = { artifactType: "feasibility" as const, dealId: "deal", facts: { dscr: 1.4 }, sections: [{ key: "a", text: "Original" }] };
const issue = { sectionKey: "a", claim: "Wrong", reason: "Conflicts with evidence", severity: "critical", category: "numeric_inconsistency", repairInstruction: "Use evidence" };
const reply = (value: unknown) => ({ text: JSON.stringify(value) });
function journal() {
  let state: ReviewCheckpoint | null = null;
  return { get state() { return structuredClone(state); }, async save(next: ReviewCheckpoint) { state = structuredClone(next); } } satisfies ReviewCheckpointStore;
}

test("review-three denial resumes repaired prose without replaying either paid review or repair", async () => {
  const checkpoint = journal();
  let reviews = 0, repairs = 0;
  provider = async role => {
    if (role === "verifier") {
      if (++reviews === 3) throw new Error("Package token budget exceeded: 119189 + 40973");
      return reply({ issues: [issue] });
    }
    return reply({ sections: [{ key: "a", text: `Repair ${++repairs}` }] });
  };
  await assert.rejects(finishInstitutionalArtifact({ ...input, checkpoint }), /119189/);
  assert.equal(checkpoint.state?.cycle, 2);
  assert.equal(checkpoint.state?.reviewPasses, 2);
  assert.equal(checkpoint.state?.sections[0].text, "Repair 2");
  assert.equal(checkpoint.state?.remaining[0].severity, "critical");
  provider = async (role, req) => {
    assert.equal(role, "verifier");
    reviews++;
    assert.match(req.prompt, /Repair 2/);
    return reply({ issues: [] });
  };
  const result = await finishInstitutionalArtifact({ ...input, checkpoint });
  assert.equal(result.verdict, "pass");
  assert.equal(result.reviewPasses, 3);
  assert.equal(repairs, 2);
  provider = async () => { throw new Error("terminal result must be reused"); };
  assert.deepEqual(await finishInstitutionalArtifact({ ...input, checkpoint }), result);
});

test("partial batch failure retains successful sections privately and retries only the missing batch", async () => {
  const checkpoint = journal();
  const sections = ["a", "b", "c"].map(key => ({ key, text: "Original" }));
  let calls = 0;
  provider = async (role, req) => {
    if (role === "verifier") return reply({ issues: sections.map(s => ({ ...issue, sectionKey: s.key })) });
    calls++;
    if (req.prompt.includes('["c"]')) throw new Error("provider offline");
    return reply({ sections: sections.slice(0, 2).map(s => ({ ...s, text: "Saved repair" })) });
  };
  await assert.rejects(finishInstitutionalArtifact({ ...input, sections, checkpoint }), /offline/);
  assert.deepEqual(checkpoint.state?.sections, sections, "partial prose must not be considered reviewed");
  assert.equal(Object.keys(checkpoint.state!.completedBatches).length, 1);
  provider = async (role, req) => {
    if (role === "verifier") {
      assert.match(req.prompt, /Saved repair/);
      assert.match(req.prompt, /Final repair/);
      return reply({ issues: [] });
    }
    calls++;
    assert.match(req.prompt, /\["c"\]/);
    return reply({ sections: [{ key: "c", text: "Final repair" }] });
  };
  assert.equal((await finishInstitutionalArtifact({ ...input, sections, checkpoint })).verdict, "pass");
  assert.equal(calls, 3);
});

test("checkpoint save failure stops before additional paid work or a pass", async () => {
  let calls = 0;
  provider = async () => { calls++; return reply({ issues: [issue] }); };
  await assert.rejects(finishInstitutionalArtifact({ ...input, checkpoint: { state: null, save: async () => { throw new Error("database offline"); } } }), /database offline/);
  assert.equal(calls, 1);
});

test("unchanged retries preserve three-repair bound and unresolved critical findings", async () => {
  const checkpoint = journal();
  let reviews = 0, repairs = 0;
  provider = async role => {
    if (role === "verifier") { reviews++; return reply({ issues: [issue] }); }
    repairs++; return reply({ sections: input.sections });
  };
  const first = await finishInstitutionalArtifact({ ...input, checkpoint });
  assert.equal(first.verdict, "flagged");
  assert.deepEqual(await finishInstitutionalArtifact({ ...input, checkpoint }), first);
  assert.equal(reviews, 4); assert.equal(repairs, 3);
});

test("the production checkpoint adapter reuses identity, resets changed facts and fails closed on corrupt state", async () => {
  const sb = { rpc: reviewCheckpointRpc() };
  const scope = { sb, bankId: "bank", dealId: "deal", artifactType: input.artifactType, artifactId: "artifact", sections: input.sections };
  let calls = 0;
  provider = async () => { calls++; return reply({ issues: [{ ...issue, severity: "warning" }] }); };
  const run = (facts = input.facts) => withReviewCheckpoint({ ...scope, inputHash: reviewContentHash({ ...input, facts }) }, checkpoint => finishInstitutionalArtifact({ ...input, facts, checkpoint }));
  assert.equal((await run()).advisoryIssues.length, 1);
  await run(); assert.equal(calls, 1);
  await run({ dscr: 2 }); assert.equal(calls, 2);
  const bad = { ...scope, sb: { rpc: async () => ({ data: { revision: 1, state: { phase: "done" } }, error: null }) }, inputHash: "a".repeat(64) };
  await assert.rejects(withReviewCheckpoint(bad, async () => { throw new Error("must not reach work"); }), error => error instanceof Error && error.message !== "must not reach work");
});
