import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

/**
 * Since 2026-08-20 every blocking finding across both artifact gates was rated
 * `warning`; none was rated `critical`. Three warnings — one on a business
 * plan, two on feasibility studies — are the entire reason those commissioning
 * runs were discarded:
 *
 *   business_plan   warning   1
 *   feasibility     warning   2
 *                   critical  0
 *
 * These are the real reasons, transcribed from verification_flagged_claims.
 */
const PRODUCTION_WARNINGS = [
  "The projections_assumptions_narrative flags that the officer-compensation add-back was not provided (null) and cannot be treated as a confirmed zero",
  "Restates the evidence value ($3 revenue per capita) but the narrative does not reconcile that $2,753,880 Year-1 revenue over 978,000 population equals roughly $2.82 per capita",
  "The industry_analysis section explicitly states that generalized statements about aerospace, defense, and regional industry demand are unverified",
];

let issueQueue: unknown[][] = [];

require.cache[require.resolve("../gateway")] = {
  id: "gw-stub", filename: "gw-stub", loaded: true,
  exports: {
    runRole: async (_role: string, opts: { purpose?: string }) => {
      // The repair role echoes the sections back unchanged, so findings
      // survive the whole budget — the case this contract is about.
      if ((opts.purpose ?? "").includes("repair")) {
        return { text: JSON.stringify({ sections: [{ key: "s1", text: "unchanged" }] }) };
      }
      const issues = issueQueue.length > 1 ? issueQueue.shift()! : (issueQueue[0] ?? []);
      return { text: JSON.stringify({ issues }) };
    },
  },
} as never;

const { finishInstitutionalArtifact } =
  require("../frontierArtifactFactory") as typeof import("../frontierArtifactFactory");

function issue(severity: "info" | "warning" | "critical", claim: string) {
  return {
    sectionKey: "s1", claim, reason: claim, severity,
    category: "unsupported_fact", repairInstruction: "fix it",
  };
}

async function run(issues: unknown[]) {
  issueQueue = [issues];
  return finishInstitutionalArtifact({
    artifactType: "feasibility",
    facts: {},
    sections: [{ key: "s1", text: "unchanged" }],
    dealId: "deal-1",
  });
}

test("a surviving warning publishes and is disclosed, not discarded", async () => {
  const result = await run(PRODUCTION_WARNINGS.map((c) => issue("warning", c)));

  assert.equal(result.verdict, "pass", "three warnings must not discard the run");
  assert.equal(result.advisoryIssues.length, 3);
  assert.deepEqual(result.reviewIssues, [], "nothing blocking survived");
});

test("every surviving finding is still written as a condition", async () => {
  const result = await run(PRODUCTION_WARNINGS.map((c) => issue("warning", c)));

  // persistArtifactFlags consumes flaggedClaims. The disclosure is the point:
  // previously the finding went into a failure string instead of in front of
  // the banker who needed it.
  assert.equal(result.flaggedClaims.length, 3);
  for (const claim of result.flaggedClaims) assert.equal(claim.severity, "warning");
});

test("a surviving critical still blocks publication", async () => {
  const result = await run([
    issue("critical", "monthly ending cash +$163,012 vs. balance-sheet Year 1 cash -$314,068"),
    issue("warning", PRODUCTION_WARNINGS[0]),
  ]);

  assert.equal(result.verdict, "flagged");
  assert.equal(result.reviewIssues.length, 1);
  assert.equal(result.reviewIssues[0].severity, "critical");
  assert.equal(result.advisoryIssues.length, 1, "the warning is still disclosed alongside");
});

test("info findings are neither blocking nor disclosed", async () => {
  const result = await run([issue("info", "stylistic note")]);

  assert.equal(result.verdict, "pass");
  assert.deepEqual(result.advisoryIssues, []);
  assert.deepEqual(result.flaggedClaims, []);
});

test("a clean review still passes with nothing attached", async () => {
  const result = await run([]);

  assert.equal(result.verdict, "pass");
  assert.deepEqual(result.advisoryIssues, []);
  assert.equal(result.reviewPasses, 1, "a clean first pass costs one review, not four");
});
