import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { generateHostileInterrogation } =
  require("../committeeInterrogation") as typeof import("../committeeInterrogation");
const { __setProviderImplForTests, __resetGatewayTestOverrides, __resetGatewayBudgetForTests } =
  require("../gateway") as typeof import("../gateway");

test.afterEach(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
});

const VALID_QUESTION = {
  code: "dscr_thin_margin",
  question: "How does the deal survive a 10% revenue decline given the thin DSCR margin?",
  domain: "repayment",
  severity: "critical",
  alreadyAnswered: false,
  rationale: "computedMetrics.DSCR is 1.05, just above the 1.0 floor — no cushion for stress.",
  resolvingAction: "Document a plausible stress scenario and any add-backs supporting cash flow.",
  borrowerResolvable: true,
};

test("generateHostileInterrogation parses a valid verifier response into typed questions", async () => {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({ questions: [VALID_QUESTION] }),
    tokensIn: 100,
    tokensOut: 50,
  }));

  const questions = await generateHostileInterrogation({
    dealId: "deal-1",
    facts: { computedMetrics: { DSCR: 1.05 } },
  });

  assert.equal(questions.length, 1);
  assert.equal(questions[0].code, "dscr_thin_margin");
  assert.equal(questions[0].alreadyAnswered, false);
  assert.equal(questions[0].borrowerResolvable, true);
});

test("generateHostileInterrogation drops malformed entries but keeps valid ones", async () => {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({
      questions: [
        VALID_QUESTION,
        { code: "missing_fields_only" }, // fails isHostileQuestion validation
      ],
    }),
    tokensIn: 100,
    tokensOut: 50,
  }));

  const questions = await generateHostileInterrogation({ dealId: "deal-1", facts: {} });
  assert.equal(questions.length, 1);
  assert.equal(questions[0].code, "dscr_thin_margin");
});

test("generateHostileInterrogation returns a synthetic critical question when the verifier output is unparseable", async () => {
  __setProviderImplForTests("anthropic", async () => ({
    text: "not json at all",
    tokensIn: 10,
    tokensOut: 5,
  }));

  const questions = await generateHostileInterrogation({ dealId: "deal-1", facts: {} });
  assert.equal(questions.length, 1);
  assert.equal(questions[0].severity, "critical");
  assert.equal(questions[0].alreadyAnswered, false);
  assert.equal(questions[0].borrowerResolvable, false);
});

test("generateHostileInterrogation returns a synthetic critical question when the questions array is empty", async () => {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({ questions: [] }),
    tokensIn: 10,
    tokensOut: 5,
  }));

  const questions = await generateHostileInterrogation({ dealId: "deal-1", facts: {} });
  assert.equal(questions.length, 1);
  assert.equal(questions[0].code, "verifier_output_unparseable");
});
