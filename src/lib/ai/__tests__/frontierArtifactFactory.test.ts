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

test("numeric and cross-artifact warnings trigger repair rather than advisory publication", async () => {
  for (const category of ["numeric_inconsistency", "cross_artifact_conflict"]) {
    let reviews = 0;
    __setProviderImplForTests("anthropic", async () => ({ text: JSON.stringify({ issues: ++reviews === 1 ? [{
      sectionKey: "repayment", claim: "4.00x coverage", reason: "Saved coverage is 1.42x", severity: "warning", category,
      repairInstruction: "Correct coverage to 1.42x",
    }] : [] }), tokensIn: 10, tokensOut: 10 }));
    __setProviderImplForTests("openai", async () => ({ text: JSON.stringify({ sections: [{ key: "repayment", text: "Coverage is 1.42x." }] }), tokensIn: 10, tokensOut: 10 }));
    const result = await finishInstitutionalArtifact({ artifactType: "credit_memo", dealId: "qa", facts: { dscr: 1.42 }, sections: [{ key: "repayment", text: "Coverage is 4.00x." }] });
    assert.equal(result.verdict, "pass");
    assert.equal(result.repaired, true);
    assert.equal(reviews, 2);
    assert.equal(result.sections[0].text, "Coverage is 1.42x.");
  }
});

test("terminal checkpoints cannot preserve warning severity for numeric contradictions", async () => {
  const sections = [{ key: "repayment", text: "Coverage is 4.00x." }];
  const result = await finishInstitutionalArtifact({ artifactType: "credit_memo", dealId: "qa", facts: { dscr: 1.42 }, sections,
    checkpoint: { state: { version: 1, cycle: 0, phase: "done", sections, repaired: false, reviewPasses: 1, completedBatches: {},
      remaining: [{ sectionKey: "repayment", claim: "4.00x", reason: "Saved 1.42x", severity: "warning", category: "numeric_inconsistency", repairInstruction: "Correct" }] }, save: async () => {} } });
  assert.equal(result.verdict, "flagged");
  assert.equal(result.advisoryIssues.length, 0);
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

test("feasibility repairs use small batches then independently review the complete artifact", async () => {
  const sections = Array.from({ length: 7 }, (_, i) => ({ key: `section${i}`, text: `Unsupported claim ${i}` }));
  let reviews = 0;
  let repairs = 0;
  __setProviderImplForTests("anthropic", async (req) => {
    reviews++;
    if (reviews > 1) for (let i = 0; i < 7; i++) assert.match(req.prompt, new RegExp(`Verified section${i}`));
    return { text: JSON.stringify({ issues: reviews === 1 ? sections.map(s => ({ sectionKey: s.key, claim: s.text, reason: "Unsupported", severity: "critical", category: "unsupported_fact", repairInstruction: "Use supplied facts" })) : [] }), tokensIn: 1, tokensOut: 1 };
  });
  __setProviderImplForTests("openai", async (req) => {
    repairs++;
    const keys = JSON.parse(req.prompt.split("REQUESTED REPAIR SECTION KEYS:\n\n")[1].split("\n\n")[0]) as string[];
    assert.ok(keys.length <= 2);
    return { text: JSON.stringify({ sections: keys.map(key => ({ key, text: `Verified ${key}` })) }), tokensIn: 1, tokensOut: 1 };
  });
  const result = await finishInstitutionalArtifact({ artifactType: "feasibility", dealId: "qa", facts: {}, sections });
  assert.equal(repairs, 4);
  assert.equal(reviews, 2);
  assert.equal(result.verdict, "pass");
  assert.equal(result.sections.length, 7);
});

test("a failed feasibility batch never publishes partial repairs and reports exhausted timeout recovery", async () => {
  const sections = [{ key: "identity", text: "Wrong managers" }, { key: "market", text: "Invented competitors" }, { key: "location", text: "Wrong city" }];
  let failedCalls = 0;
  __setProviderImplForTests("anthropic", async () => ({ text: JSON.stringify({ issues: sections.map(s => ({ sectionKey: s.key, claim: s.text, reason: "Unsupported", severity: "critical", category: "unsupported_fact", repairInstruction: "Use supplied facts" })) }), tokensIn: 1, tokensOut: 1 }));
  __setProviderImplForTests("openai", async (req) => {
    const keys = JSON.parse(req.prompt.split("REQUESTED REPAIR SECTION KEYS:\n\n")[1].split("\n\n")[0]) as string[];
    if (keys.includes("location")) { failedCalls++; throw new Error("This operation was aborted"); }
    return { text: JSON.stringify({ sections: keys.map(key => ({ key, text: `Verified ${key}` })) }), tokensIn: 1, tokensOut: 1 };
  });
  const result = await finishInstitutionalArtifact({ artifactType: "feasibility", dealId: "qa", facts: {}, sections });
  assert.equal(failedCalls, 2);
  assert.equal(result.verdict, "flagged");
  assert.deepEqual(result.sections, sections);
  assert.equal(result.repaired, false);
  assert.match(result.flaggedClaims.at(-1)!.reason, /timed out; no partial rewrite/);
});

test("accepted repaired content is the reusable review fingerprint", async () => {
  let reviews = 0;
  __setProviderImplForTests("anthropic", async () => ({ text: JSON.stringify(++reviews === 1 ? {
    issues: [{ sectionKey: "a", claim: "4x", reason: "Evidence says 1.4x", severity: "critical", category: "numeric_inconsistency", repairInstruction: "Use 1.4x" }],
  } : { issues: [] }), tokensIn: 10, tokensOut: 10 }));
  __setProviderImplForTests("openai", async () => ({ text: JSON.stringify({ sections: [{ key: "a", text: "Coverage is 1.4x." }] }), tokensIn: 10, tokensOut: 10 }));
  const args = { artifactType: "credit_memo" as const, dealId: "deal-1", facts: { dscr: 1.4 }, sections: [{ key: "a", text: "Coverage is 4x." }] };
  const result = await finishInstitutionalArtifact(args);
  const { reviewContentHash } = require("../frontierArtifactFactory") as typeof import("../frontierArtifactFactory");
  assert.equal(result.contentHash, reviewContentHash({ ...args, sections: result.sections }));
  assert.notEqual(result.contentHash, reviewContentHash(args));
});

test("a disclosed advisory condition does not spend three repair cycles", async () => {
  let reviews = 0;
  __setProviderImplForTests("anthropic", async () => ({ text: JSON.stringify({ issues: [{
    sectionKey: "a", claim: "Lender pricing pending", reason: "Lender must confirm pricing", severity: "warning", category: "credit_policy", repairInstruction: "Obtain lender confirmation",
  }] }), tokensIn: ++reviews, tokensOut: 5 }));
  __setProviderImplForTests("openai", async () => { throw new Error("No repair should run"); });
  const result = await finishInstitutionalArtifact({ artifactType: "credit_memo", dealId: "deal-1", facts: {}, sections: [{ key: "a", text: "Lender pricing pending." }] });
  assert.equal(result.verdict, "pass");
  assert.equal(result.advisoryIssues.length, 1);
  assert.equal(result.repaired, false);
  assert.equal(reviews, 1);
});

test("production funding regression: an otherwise correct rewrite cannot erase the authoritative schedule", async () => {
  const schedule = { sources: [{ label: "SBA loan", amount: 950000 }, { label: "Owner equity", amount: 250000 }], uses: [
    { label: "Working capital per startup budget. Total costs $1,200,000 funded by loan and equity.", amount: 175000 },
    { label: "Opening inventory", amount: 25000 }, { label: "Equipment", amount: 350000 },
    { label: "Illustrative franchise fee; not an actual brand quote", amount: 50000 },
    { label: "Leasehold construction; no real-estate purchase", amount: 600000 },
  ], totalSources: 1200000, totalUses: 1200000 };
  const { fundingScheduleText } = await import("../packageNarrativeEvidence");
  const anchor = fundingScheduleText(schedule);
  let reviews = 0;
  __setProviderImplForTests("anthropic", async req => {
    reviews++;
    assert.ok(req.prompt.includes(anchor));
    return { text: JSON.stringify({ issues: reviews === 1 ? [{ sectionKey: "operations_plan",
      claim: "Unsupported operating guarantee", reason: "The scenario is conditional", severity: "critical",
      category: "unsupported_fact", repairInstruction: "Qualify the operating assumptions" }] : [] }), tokensIn: 1, tokensOut: 1 };
  });
  const prose = Array(50).fill("Conditional operating assumptions need borrower confirmation.").join(" ");
  __setProviderImplForTests("openai", async () => ({ text: JSON.stringify({ sections: [{ key: "operations_plan", text: prose }] }), tokensIn: 1, tokensOut: 1 }));
  const result = await finishInstitutionalArtifact({ artifactType: "business_plan", dealId: "qa",
    facts: { sources_and_uses: schedule }, sections: [{ key: "operations_plan", text: prose }], narrativeRequirements: { operations_plan: 45 } });
  assert.equal(result.verdict, "pass"); assert.equal(result.reviewPasses, 2);
  assert.equal(result.sections[0].text.split(anchor).length, 2, "one exact protected schedule after a rewrite that omitted it");
  assert.ok(result.sections[0].text.startsWith(prose));
});

test("cross-section findings repair their explicit targets rather than repeatedly rewriting the correct quoted section", async () => {
  let reviews = 0;
  __setProviderImplForTests("anthropic", async () => ({ text: JSON.stringify({ issues: ++reviews === 1 ? [{
    sectionKey: "operations_plan", repairSectionKeys: ["business_overview_narrative", "executive_summary"],
    claim: "Franchise fee $50,000", reason: "The other two sections call the franchise fee other expenses.", severity: "critical",
    category: "cross_artifact_conflict", repairInstruction: "Identify the franchise fee in business_overview_narrative and executive_summary.",
  }] : [] }), tokensIn: 1, tokensOut: 1 }));
  __setProviderImplForTests("openai", async req => {
    assert.match(req.prompt, /REQUESTED REPAIR SECTION KEYS:\n\n\["business_overview_narrative","executive_summary"\]/);
    assert.match(req.prompt, /The other two sections/);
    return { text: JSON.stringify({ sections: ["business_overview_narrative", "executive_summary"].map(key => ({ key, text: "Illustrative franchise fee $50,000; lender confirmation remains pending." })) }), tokensIn: 1, tokensOut: 1 };
  });
  const result = await finishInstitutionalArtifact({ artifactType: "business_plan", dealId: "qa", facts: {}, sections: [
    { key: "operations_plan", text: "Franchise fee $50,000" },
    { key: "business_overview_narrative", text: "Other expenses $50,000" },
    { key: "executive_summary", text: "Other initial costs $50,000" },
  ] });
  assert.equal(result.verdict, "pass"); assert.equal(reviews, 2);
  assert.equal(result.sections[0].text, "Franchise fee $50,000");
});

test("protected funding evidence never suppresses a contradiction in surrounding prose", async () => {
  __setProviderImplForTests("anthropic", async () => ({ text: JSON.stringify({ issues: [{
    sectionKey: "operations_plan", repairSectionKeys: ["operations_plan"], claim: "Equipment $900",
    reason: "Saved use is working capital $100", severity: "critical", category: "numeric_inconsistency",
    repairInstruction: "Correct the contradictory use in the prose",
  }] }), tokensIn: 1, tokensOut: 1 }));
  __setProviderImplForTests("openai", async () => ({ text: JSON.stringify({ sections: [{ key: "operations_plan", text: "Equipment $900" }] }), tokensIn: 1, tokensOut: 1 }));
  const result = await finishInstitutionalArtifact({ artifactType: "business_plan", dealId: "qa",
    facts: { sourcesAndUses: { sources: [{ label: "Loan", amount: 100 }], uses: [{ label: "Working capital", amount: 100 }], totalSources: 100, totalUses: 100 } },
    sections: [{ key: "operations_plan", text: "Equipment $900" }] });
  assert.equal(result.verdict, "flagged"); assert.equal(result.reviewPasses, 4);
  assert.equal(result.reviewIssues[0].claim, "Equipment $900");
});
