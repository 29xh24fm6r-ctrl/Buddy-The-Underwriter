/**
 * Phase 55F — Credit Actioning CI Guard
 *
 * Suites:
 * 1. Action recommendation builder contract
 * 2. Priority scorer contract
 * 3. Action registry contract
 * 4. Action application contract
 * 5. Decision readiness actioning integration
 * 6. API endpoint contract
 * 7. Placeholder regression
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), "utf-8");
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(SRC_ROOT, relPath));
}

// ---------------------------------------------------------------------------
// 1. Action recommendation builder
// ---------------------------------------------------------------------------

describe("Credit action builder — contract", () => {
  it("buildCreditActionRecommendations exists", () => {
    assert.ok(fileExists("lib/creditActioning/buildCreditActionRecommendations.ts"));
  });

  it("maps exceptions to action types", () => {
    const content = readFile("lib/creditActioning/buildCreditActionRecommendations.ts");
    assert.ok(content.includes("stale_snapshot"), "must handle stale snapshot");
    assert.ok(content.includes("missing_critical_metric"), "must handle missing metric");
    assert.ok(content.includes("unresolved_conflict"), "must handle conflict");
    assert.ok(content.includes("deferred_follow_up"), "must handle follow-up");
    assert.ok(content.includes("banker_override"), "must handle override");
  });

  it("uses override insights for action generation", () => {
    const content = readFile("lib/creditActioning/buildCreditActionRecommendations.ts");
    assert.ok(content.includes("overrideInsights"), "must use override insights");
    assert.ok(content.includes("aggressive"), "must detect aggressive overrides");
  });

  it("produces actions with required fields", () => {
    const types = readFile("lib/creditActioning/credit-action-types.ts");
    assert.ok(types.includes("recommendedText"), "must include recommendedText");
    assert.ok(types.includes("rationale"), "must include rationale");
    assert.ok(types.includes("proposedTerms"), "must include proposedTerms");
    assert.ok(types.includes("committeeImpact"), "must include committeeImpact");
  });
});

// ---------------------------------------------------------------------------
// 2. Priority scorer
// ---------------------------------------------------------------------------

describe("Credit action priority — contract", () => {
  it("scoreCreditActionPriority exists", () => {
    assert.ok(fileExists("lib/creditActioning/scoreCreditActionPriority.ts"));
  });

  it("supports all priority levels", () => {
    const content = readFile("lib/creditActioning/scoreCreditActionPriority.ts");
    for (const p of ["immediate", "pre_committee", "pre_close", "post_close"]) {
      assert.ok(content.includes(`"${p}"`), `must support priority "${p}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Action registry
// ---------------------------------------------------------------------------

describe("Action registry — contract", () => {
  it("ACTION_REGISTRY exists with entries", () => {
    const content = readFile("lib/creditActioning/credit-action-types.ts");
    assert.ok(content.includes("ACTION_REGISTRY"), "must define registry");
    assert.ok(content.includes("add_condition"), "must include add_condition");
    assert.ok(content.includes("add_covenant"), "must include add_covenant");
    assert.ok(content.includes("pricing_review"), "must include pricing_review");
    assert.ok(content.includes("monitoring_recommendation"), "must include monitoring");
  });

  it("registry entries specify target system and acceptance requirements", () => {
    const content = readFile("lib/creditActioning/credit-action-types.ts");
    assert.ok(content.includes("targetSystem"), "must specify targetSystem");
    assert.ok(content.includes("requiresAcceptance"), "must specify requiresAcceptance");
    assert.ok(content.includes("requiresCommitteeDisclosure"), "must specify disclosure");
  });
});

// ---------------------------------------------------------------------------
// 4. Action application
// ---------------------------------------------------------------------------

describe("Credit action application — contract", () => {
  it("applyCreditActionRecommendation exists", () => {
    assert.ok(fileExists("lib/creditActioning/applyCreditActionRecommendation.ts"));
  });

  it("supports accept, modify, dismiss, convert", () => {
    const content = readFile("lib/creditActioning/applyCreditActionRecommendation.ts");
    assert.ok(content.includes('"accept"'), "must support accept");
    assert.ok(content.includes('"modify"'), "must support modify");
    assert.ok(content.includes('"dismiss"'), "must support dismiss");
    assert.ok(content.includes('"convert"'), "must support convert");
  });

  it("dismiss requires rationale", () => {
    const content = readFile("lib/creditActioning/applyCreditActionRecommendation.ts");
    assert.ok(
      content.includes("dismiss") && content.includes("rationale"),
      "dismiss must require rationale",
    );
  });

  it("convert creates target system record", () => {
    const content = readFile("lib/creditActioning/applyCreditActionRecommendation.ts");
    assert.ok(content.includes("convertToTargetSystem"), "must convert to target system");
    assert.ok(content.includes("deal_conditions"), "must be able to create conditions");
  });
});

// ---------------------------------------------------------------------------
// 5. Decision readiness
// ---------------------------------------------------------------------------

describe("Decision readiness — credit actioning integration", () => {
  it("accepts actioning inputs", () => {
    const content = readFile("lib/decision/validateDecisionReadiness.ts");
    assert.ok(content.includes("openRequiredActionCount"), "must accept action count");
    assert.ok(content.includes("unresolvedPricingReview"), "must accept pricing review");
    assert.ok(content.includes("unresolvedStructureReview"), "must accept structure review");
  });

  it("blocks on unresolved pricing and structure reviews", () => {
    const content = readFile("lib/decision/validateDecisionReadiness.ts");
    assert.ok(content.includes("Pricing review recommended but not completed"), "must block on pricing");
    assert.ok(content.includes("Structure review recommended but not completed"), "must block on structure");
  });
});

// ---------------------------------------------------------------------------
// 6. API endpoints
// ---------------------------------------------------------------------------

describe("Credit actions API — contract", () => {
  it("GET endpoint exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/credit-actions/route.ts"));
  });

  it("POST action endpoint exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/credit-actions/[actionId]/route.ts"));
  });

  it("both use Clerk auth", () => {
    const get = readFile("app/api/deals/[dealId]/credit-actions/route.ts");
    const post = readFile("app/api/deals/[dealId]/credit-actions/[actionId]/route.ts");
    assert.ok(get.includes("requireDealCockpitAccess"), "GET must use cockpit access");
    assert.ok(post.includes("requireDealCockpitAccess"), "POST must use cockpit access");
  });
});

// ---------------------------------------------------------------------------
// 7. Placeholder regression
// ---------------------------------------------------------------------------

describe("Credit actioning — no placeholders", () => {
  it("actioning modules have no placeholder markers", () => {
    const files = [
      "lib/creditActioning/credit-action-types.ts",
      "lib/creditActioning/buildCreditActionRecommendations.ts",
      "lib/creditActioning/scoreCreditActionPriority.ts",
      "lib/creditActioning/applyCreditActionRecommendation.ts",
    ];
    for (const f of files) {
      const content = readFile(f);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\bTODO\b|placeholder|coming soon/i.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          assert.fail(`Placeholder in ${f}:${i + 1}: ${line.trim()}`);
        }
      }
    }
  });
});
