import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { suggestFactsFromBorrowerText } =
  require("../suggestFacts") as typeof import("../suggestFacts");
const {
  __setProviderImplForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../../ai/gateway") as typeof import("../../ai/gateway");
const { __setVendorApprovalForTests, __resetVendorApprovalForTests } =
  require("../../ai/vendorApproval") as typeof import("../../ai/vendorApproval");

test.afterEach(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
  __resetVendorApprovalForTests();
});

test("suggestFacts uses JSON-object mode and validates dynamic fact values locally", async () => {
  __setVendorApprovalForTests("openai", "APPROVED");
  let capturedRequest: any;
  __setProviderImplForTests("openai", async (request) => {
    capturedRequest = request;
    return {
      text: JSON.stringify({
        suggestions: [
          {
            field_key: "owners",
            field_value: [{ name: "Jordan", ownership_percent: 60 }],
            value_text: "Jordan owns 60%",
            confidence: 0.95,
            rationale: "Borrower said Jordan owns sixty percent.",
          },
          {
            field_key: "not_allowed",
            field_value: "ignore",
            value_text: null,
            confidence: 0.8,
            rationale: "Invalid key.",
          },
          {
            field_key: "annual_revenue",
            value_text: "$1m",
            confidence: 4,
            rationale: "Missing field_value.",
          },
        ],
      }),
      tokensIn: 20,
      tokensOut: 20,
    };
  });

  const suggestions = await suggestFactsFromBorrowerText(
    "Jordan owns sixty percent and annual revenue is one million dollars.",
  );

  assert.equal(capturedRequest.responseJsonObject, true);
  assert.equal(capturedRequest.responseSchema, undefined);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].field_key, "owners");
  assert.deepEqual(suggestions[0].field_value, [{ name: "Jordan", ownership_percent: 60 }]);
  assert.equal(suggestions[0].confidence, 0.95);
});
