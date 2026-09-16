import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { finishInstitutionalArtifact } =
  require("../frontierArtifactFactory") as typeof import("../frontierArtifactFactory");
const { __setProviderImplForTests, __resetGatewayTestOverrides, __resetGatewayBudgetForTests } =
  require("../gateway") as typeof import("../gateway");
const { __setVendorApprovalForTests, __resetVendorApprovalForTests } =
  require("../vendorApproval") as typeof import("../vendorApproval");

test.beforeEach(() => {
  __setVendorApprovalForTests("anthropic", "APPROVED");
  __setVendorApprovalForTests("openai", "APPROVED");
});

test.afterEach(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
  __resetVendorApprovalForTests();
});

test("releases a strong artifact without paying for an unnecessary repair", async () => {
  let repairs = 0;
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({ issues: [] }), tokensIn: 20, tokensOut: 5,
  }));
  __setProviderImplForTests("openai", async () => {
    repairs += 1;
    throw new Error("should not run");
  });

  const result = await finishInstitutionalArtifact({
    artifactType: "credit_memo",
    dealId: "deal-1",
    facts: { dscr: 1.42 },
    sections: [{ key: "repayment", text: "DSCR is 1.42x." }],
  });
  assert.equal(result.verdict, "pass");
  assert.equal(result.repaired, false);
  assert.equal(repairs, 0);
});

test("Claude diagnoses, GPT repairs, and Claude independently clears the repair", async () => {
  let reviews = 0;
  __setProviderImplForTests("anthropic", async () => {
    reviews += 1;
    return {
      text: JSON.stringify(reviews === 1 ? {
        issues: [{
          sectionKey: "repayment",
          claim: "DSCR is 4.00x",
          reason: "The deterministic result is 1.42x.",
          severity: "critical",
          category: "numeric_inconsistency",
          repairInstruction: "Replace 4.00x with 1.42x.",
        }],
      } : { issues: [] }),
      tokensIn: 30,
      tokensOut: 10,
    };
  });
  __setProviderImplForTests("openai", async () => ({
    text: JSON.stringify({ sections: [{ key: "repayment", text: "DSCR is 1.42x." }] }),
    tokensIn: 40,
    tokensOut: 12,
  }));

  const result = await finishInstitutionalArtifact({
    artifactType: "credit_memo",
    dealId: "deal-1",
    facts: { dscr: 1.42 },
    sections: [{ key: "repayment", text: "DSCR is 4.00x." }],
  });
  assert.equal(result.verdict, "pass");
  assert.equal(result.repaired, true);
  assert.equal(result.reviewPasses, 2);
  assert.equal(result.sections[0].text, "DSCR is 1.42x.");
});

test("fails closed when automated repair is unavailable", async () => {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({
      issues: [{
        sectionKey: "repayment", claim: "Unsupported", reason: "No evidence",
        severity: "critical", category: "unsupported_fact", repairInstruction: "Remove it",
      }],
    }),
    tokensIn: 20,
    tokensOut: 10,
  }));
  __setProviderImplForTests("openai", async () => { throw new Error("provider down"); });

  const result = await finishInstitutionalArtifact({
    artifactType: "business_plan",
    dealId: "deal-1",
    facts: {},
    sections: [{ key: "overview", text: "Unsupported" }],
  });
  assert.equal(result.verdict, "flagged");
  assert.equal(result.repaired, false);
  assert.equal(result.flaggedClaims.length, 1);
  assert.equal(result.reviewIssues.length, 1);
  assert.equal(result.reviewIssues[0].sectionKey, "repayment");
  assert.equal(result.reviewIssues[0].category, "unsupported_fact");
  assert.equal(result.reviewIssues[0].repairInstruction, "Remove it");
});

test("repairs only flagged sections, preserves other prose and reviews the whole result", async () => {
  let reviews = 0;
  let repairs = 0;
  __setProviderImplForTests("anthropic", async (req) => {
    reviews++;
    if (reviews === 2) {
      assert.match(req.prompt, /Unchanged management biography/);
      assert.match(req.prompt, /Base-case cash shortfall; downside debt service is not covered/);
    }
    return { text: JSON.stringify({ issues: reviews === 1 ? [{
      sectionKey: "sensitivity", claim: "Downside cash dip", reason: "Base case misattributed",
      severity: "critical", category: "cross_artifact_conflict", repairInstruction: "Label the base case and disclose deficient downside coverage",
    }] : [] }), tokensIn: 1, tokensOut: 1 };
  });
  __setProviderImplForTests("openai", async (req) => {
    repairs++;
    assert.match(req.prompt, /REQUESTED REPAIR SECTION KEYS:\n\n\["sensitivity"\]/);
    if (repairs === 1) throw new Error("This operation was aborted");
    return { text: JSON.stringify({ sections: [{ key: "sensitivity", text: "Base-case cash shortfall; downside debt service is not covered." }] }), tokensIn: 1, tokensOut: 1 };
  });
  const result = await finishInstitutionalArtifact({ artifactType: "business_plan", dealId: "qa", facts: {},
    sections: [{ key: "management", text: "Unchanged management biography" }, { key: "sensitivity", text: "Downside cash dip" }] });
  assert.equal(result.verdict, "pass");
  assert.equal(repairs, 2);
  assert.equal(reviews, 2);
  assert.equal(result.sections[0].text, "Unchanged management biography");
});

test("missing review contract cannot silently approve an artifact", async () => {
  __setProviderImplForTests("anthropic", async () => ({ text: "{}", tokensIn: 1, tokensOut: 1 }));
  __setProviderImplForTests("openai", async () => { throw new Error("Unavailable"); });
  const result = await finishInstitutionalArtifact({ artifactType: "business_plan", dealId: "qa", facts: {}, sections: [{ key: "a", text: "Claim" }] });
  assert.equal(result.verdict, "flagged");
});

test("bounded retry does not retry billing errors or accept out-of-scope section edits", async () => {
  for (const mode of ["billing", "extra", "duplicate", "missing", "timeout"]) {
    __resetGatewayBudgetForTests();
    let calls = 0;
    __setProviderImplForTests("anthropic", async () => ({ text: JSON.stringify({ issues: [{
      sectionKey: "a", claim: "Wrong", reason: "Wrong", severity: "critical",
      category: "unsupported_fact", repairInstruction: "Correct a",
    }] }), tokensIn: 1, tokensOut: 1 }));
    __setProviderImplForTests("openai", async () => {
      calls++;
      if (mode === "billing") throw new Error("credit_balance_exhausted");
      if (mode === "timeout") throw new Error("This operation was aborted");
      const patch = mode === "missing" ? [] : mode === "duplicate"
        ? [{ key: "a", text: "Fixed" }, { key: "a", text: "Again" }]
        : [{ key: "a", text: "Fixed" }, { key: "b", text: "Unauthorized rewrite" }];
      return { text: JSON.stringify({ sections: patch }), tokensIn: 1, tokensOut: 1 };
    });
    const result = await finishInstitutionalArtifact({ artifactType: "business_plan", dealId: "qa", facts: {},
      sections: [{ key: "a", text: "Wrong" }, { key: "b", text: "Keep" }] });
    assert.equal(result.verdict, "flagged", mode);
    assert.equal(calls, mode === "timeout" ? 2 : 1, mode);
    assert.equal(result.sections[1].text, "Keep");
  }
});
