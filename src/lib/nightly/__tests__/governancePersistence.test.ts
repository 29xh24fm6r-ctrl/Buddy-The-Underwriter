import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const drift = require("../policyDrift") as typeof import("../policyDrift");
const living = require("../livingPolicy") as typeof import("../livingPolicy");
type DriftDependencies = import("../policyDrift").PolicyDriftDependencies;
type LivingDependencies = import("../livingPolicy").LivingPolicyDependencies;

function driftDeps(
  overrides: Partial<DriftDependencies> = {},
): DriftDependencies {
  return {
    readApprovedRules: async () => ({
      data: [{ rules_json: { dscr: 1.25, leverage: 4 } }],
      error: null,
    }),
    readFinalDecisions: async () => ({
      data: [
        { policy_eval_json: { dscr: 1.1, leverage: 3 } },
        { policy_eval_json: { dscr: 1.2, leverage: 3 } },
      ],
      error: null,
    }),
    insertFinding: async () => ({ error: null }),
    ...overrides,
  };
}

test("policy drift fails closed on authoritative reads", async () => {
  await assert.rejects(
    () =>
      drift.detectPolicyDrift(
        "bank-1",
        driftDeps({
          readApprovedRules: async () => ({
            data: null,
            error: { message: "rules unavailable" },
          }),
        }),
      ),
    /approved-policy read failed.*rules unavailable/,
  );
  await assert.rejects(
    () =>
      drift.detectPolicyDrift(
        "bank-2",
        driftDeps({
          readFinalDecisions: async () => ({
            data: null,
            error: { message: "snapshots unavailable" },
          }),
        }),
      ),
    /final-decision read failed.*snapshots unavailable/,
  );
});

test("policy drift attempts independent writes and reports failures", async () => {
  const inserted: string[] = [];
  await assert.rejects(
    () =>
      drift.detectPolicyDrift(
        "bank-3",
        driftDeps({
          insertFinding: async (finding) => {
            inserted.push(finding.rule_key);
            return {
              error:
                finding.rule_key === "dscr"
                  ? { message: "write rejected" }
                  : null,
            };
          },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof drift.PolicyDriftRunError);
      assert.equal(error.failures.length, 1);
      assert.equal(error.persistedFindings, 1);
      return true;
    },
  );
  assert.deepEqual(inserted, ["dscr", "leverage"]);
});

test("policy drift returns durable completion counts", async () => {
  assert.deepEqual(
    await drift.detectPolicyDrift("bank-4", driftDeps()),
    {
      status: "completed",
      evaluatedRules: 2,
      significantFindings: 2,
      persistedFindings: 2,
    },
  );
});

function livingDeps(
  overrides: Partial<LivingDependencies> = {},
): LivingDependencies {
  return {
    readRecentFindings: async () => ({
      data: [
        { rule_key: "dscr", expected_value: "1.25", drift_rate: 0.2 },
        { rule_key: "leverage", expected_value: "4", drift_rate: 0.3 },
      ],
      error: null,
    }),
    generateSuggestion: async ({ ruleKey }) => ({
      ok: true,
      result: {
        suggested_change: "Change " + ruleKey,
        rationale: "Observed durable drift",
      },
    }),
    insertSuggestion: async () => ({ error: null }),
    ...overrides,
  };
}

test("living policy fails closed on drift reads", async () => {
  await assert.rejects(
    () =>
      living.suggestPolicyUpdates(
        "bank-5",
        livingDeps({
          readRecentFindings: async () => ({
            data: null,
            error: { message: "drift unavailable" },
          }),
        }),
      ),
    /drift read failed.*drift unavailable/,
  );
});

test("living policy continues independent rules after provider failure", async () => {
  const generated: string[] = [];
  const persisted: string[] = [];
  await assert.rejects(
    () =>
      living.suggestPolicyUpdates(
        "bank-6",
        livingDeps({
          generateSuggestion: async ({ ruleKey }) => {
            generated.push(ruleKey);
            return ruleKey === "dscr"
              ? { ok: false, error: "provider unavailable" }
              : {
                  ok: true,
                  result: {
                    suggested_change: "Raise review",
                    rationale: "Persistent drift",
                  },
                };
          },
          insertSuggestion: async (row) => {
            persisted.push(row.rule_key);
            return { error: null };
          },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof living.LivingPolicyRunError);
      assert.equal(error.failures.length, 1);
      assert.equal(error.persistedSuggestions, 1);
      return true;
    },
  );
  assert.deepEqual(generated, ["dscr", "leverage"]);
  assert.deepEqual(persisted, ["leverage"]);
});

test("living policy reports every persistence failure", async () => {
  const inserted: string[] = [];
  await assert.rejects(
    () =>
      living.suggestPolicyUpdates(
        "bank-7",
        livingDeps({
          insertSuggestion: async (row) => {
            inserted.push(row.rule_key);
            return { error: { message: "write unavailable" } };
          },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof living.LivingPolicyRunError);
      assert.equal(error.failures.length, 2);
      assert.equal(error.generatedSuggestions, 2);
      assert.equal(error.persistedSuggestions, 0);
      return true;
    },
  );
  assert.deepEqual(inserted, ["dscr", "leverage"]);
});

test("living policy rejects schema-shaped AI fallbacks", async () => {
  await assert.rejects(
    () =>
      living.suggestPolicyUpdates(
        "bank-8",
        livingDeps({
          readRecentFindings: async () => ({
            data: [{ rule_key: "dscr", drift_rate: 0.2 }],
            error: null,
          }),
          generateSuggestion: async () => ({
            ok: true,
            result: {
              suggested_change: { type: "string" },
              rationale: { type: "string" },
            },
          }),
        }),
      ),
    /incomplete suggested_change\/rationale payload/,
  );
});
