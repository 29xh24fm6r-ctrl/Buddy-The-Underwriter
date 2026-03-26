/**
 * Phase 54A — Condition-Centric Borrower Loop CI Guard
 *
 * Ensures:
 * 1. Condition upload route exists and uses borrower-token auth
 * 2. No mixed auth boundaries in condition upload
 * 3. Condition/document intent linking exists in code path
 * 4. No placeholder regression in condition upload UI
 * 5. Canonical status helper supports all required statuses
 * 6. Borrower next step helper exists with stable shape
 * 7. Borrower copy formatter exists
 * 8. Banker evidence visibility endpoint includes linked evidence
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
// 1. Condition upload route reality
// ---------------------------------------------------------------------------

describe("Condition upload route — reality check", () => {
  it("condition upload route exists", () => {
    assert.ok(
      fileExists("app/api/portal/[token]/conditions/[conditionId]/upload/route.ts"),
      "condition upload route must exist",
    );
  });

  it("condition upload route uses borrower-token auth (not Clerk)", () => {
    const content = readFile("app/api/portal/[token]/conditions/[conditionId]/upload/route.ts");
    assert.ok(
      content.includes("borrower_portal_links"),
      "route must validate against borrower_portal_links",
    );
    assert.ok(
      !content.includes("clerkAuth"),
      "route must NOT use Clerk auth",
    );
  });

  it("condition upload route verifies condition belongs to deal", () => {
    const content = readFile("app/api/portal/[token]/conditions/[conditionId]/upload/route.ts");
    assert.ok(
      content.includes("deal_conditions") || content.includes("conditions_to_close"),
      "route must verify condition ownership against deal",
    );
    assert.ok(
      content.includes("deal_id") || content.includes("dealId"),
      "route must check deal_id match",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Mixed auth boundary check
// ---------------------------------------------------------------------------

describe("Condition upload — auth boundary", () => {
  it("portal conditions API uses token auth", () => {
    const content = readFile("app/api/portal/[token]/conditions/route.ts");
    assert.ok(
      content.includes("borrower_portal_links"),
      "portal conditions API must validate token",
    );
    assert.ok(
      !content.includes("clerkAuth"),
      "portal conditions API must NOT use Clerk auth",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Condition/document intent linking
// ---------------------------------------------------------------------------

describe("Condition/document intent linking", () => {
  it("processConditionUpload creates condition_document_links", () => {
    const content = readFile("lib/conditions/processConditionUpload.ts");
    assert.ok(
      content.includes("condition_document_links"),
      "processConditionUpload must create intent links",
    );
    assert.ok(
      content.includes("borrower_targeted"),
      "link_source must include borrower_targeted",
    );
  });

  it("condition upload route calls processConditionUpload", () => {
    const content = readFile("app/api/portal/[token]/conditions/[conditionId]/upload/route.ts");
    assert.ok(
      content.includes("processConditionUpload"),
      "upload route must use processConditionUpload orchestrator",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Placeholder regression
// ---------------------------------------------------------------------------

describe("Condition upload — no placeholder regression", () => {
  it("BorrowerConditionsCard has no alert() calls", () => {
    const content = readFile("components/deals/BorrowerConditionsCard.tsx");
    assert.ok(
      !content.includes("alert("),
      "BorrowerConditionsCard must not use alert() placeholders",
    );
  });

  it("BorrowerConditionsCard has no Coming Soon text", () => {
    const content = readFile("components/deals/BorrowerConditionsCard.tsx");
    assert.ok(
      !/coming soon/i.test(content),
      "BorrowerConditionsCard must not contain 'coming soon'",
    );
  });

  it("BorrowerConditionsCard has a real upload flow", () => {
    const content = readFile("components/deals/BorrowerConditionsCard.tsx");
    assert.ok(
      content.includes("/api/portal/") && content.includes("conditions") && content.includes("upload"),
      "BorrowerConditionsCard must call the real condition upload route",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Canonical status helper
// ---------------------------------------------------------------------------

describe("Canonical condition status helper", () => {
  it("deriveConditionStatus exists", () => {
    assert.ok(fileExists("lib/conditions/deriveConditionStatus.ts"));
  });

  it("supports all required canonical statuses", () => {
    const content = readFile("lib/conditions/deriveConditionStatus.ts");
    const required = ["pending", "submitted", "under_review", "partially_satisfied", "satisfied", "rejected", "waived"];
    for (const status of required) {
      assert.ok(
        content.includes(`"${status}"`),
        `deriveConditionStatus must support "${status}" status`,
      );
    }
  });

  it("exports CanonicalConditionStatus type", () => {
    const content = readFile("lib/conditions/deriveConditionStatus.ts");
    assert.ok(
      content.includes("CanonicalConditionStatus"),
      "must export CanonicalConditionStatus type",
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Borrower next step helper
// ---------------------------------------------------------------------------

describe("Borrower next step helper", () => {
  it("getBorrowerNextStep exists", () => {
    assert.ok(fileExists("lib/conditions/getBorrowerNextStep.ts"));
  });

  it("returns stable shape with counts", () => {
    const content = readFile("lib/conditions/getBorrowerNextStep.ts");
    assert.ok(content.includes("nextConditionId"), "must return nextConditionId");
    assert.ok(content.includes("nextConditionTitle"), "must return nextConditionTitle");
    assert.ok(content.includes("counts"), "must return counts");
    assert.ok(content.includes("total"), "counts must include total");
    assert.ok(content.includes("completed"), "counts must include completed");
    assert.ok(content.includes("remaining"), "counts must include remaining");
  });
});

// ---------------------------------------------------------------------------
// 7. Borrower copy formatter
// ---------------------------------------------------------------------------

describe("Borrower condition copy formatter", () => {
  it("formatBorrowerConditionCopy exists", () => {
    assert.ok(fileExists("lib/conditions/formatBorrowerConditionCopy.ts"));
  });

  it("returns title + explanation + itemsNeeded + examples", () => {
    const content = readFile("lib/conditions/formatBorrowerConditionCopy.ts");
    assert.ok(content.includes("title"), "must return title");
    assert.ok(content.includes("explanation"), "must return explanation");
    assert.ok(content.includes("itemsNeeded"), "must return itemsNeeded");
    assert.ok(content.includes("examples"), "must return examples");
  });
});

// ---------------------------------------------------------------------------
// 8. Banker evidence visibility
// ---------------------------------------------------------------------------

describe("Banker condition evidence visibility", () => {
  it("conditions list endpoint includes linked evidence", () => {
    const content = readFile("app/api/deals/[dealId]/conditions/list/route.ts");
    assert.ok(
      content.includes("condition_document_links"),
      "conditions list must query condition_document_links",
    );
    assert.ok(
      content.includes("linked_evidence") || content.includes("linked_doc_count"),
      "conditions list must return linked evidence data",
    );
  });
});
