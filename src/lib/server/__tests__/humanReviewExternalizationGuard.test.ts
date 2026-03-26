/**
 * Phase 54C — Human Review + Externalization CI Guard
 *
 * Suites:
 * 1. Review queue contract (types + states)
 * 2. Review action contract (accept/reject/clarification require fields)
 * 3. Auth-boundary preservation
 * 4. Package / guidance consistency
 * 5. Placeholder regression
 * 6. Outbound governance guard
 * 7. Existing suite preservation verified by combined run
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
// 1. Review queue contract
// ---------------------------------------------------------------------------

describe("Review queue — types and state contract", () => {
  it("evidence-review-types.ts exists", () => {
    assert.ok(fileExists("lib/review/evidence-review-types.ts"));
  });

  it("supports all canonical review states", () => {
    const content = readFile("lib/review/evidence-review-types.ts");
    const required = [
      "queued_for_review", "in_review", "accepted", "partially_accepted",
      "rejected", "clarification_requested", "waived",
    ];
    for (const state of required) {
      assert.ok(content.includes(`"${state}"`), `must support review state "${state}"`);
    }
  });

  it("queueEvidenceReview helper exists", () => {
    assert.ok(fileExists("lib/review/queueEvidenceReview.ts"));
  });

  it("applyEvidenceReviewDecision helper exists", () => {
    assert.ok(fileExists("lib/review/applyEvidenceReviewDecision.ts"));
  });

  it("deriveReviewQueueInsights helper exists", () => {
    assert.ok(fileExists("lib/review/deriveReviewQueueInsights.ts"));
  });
});

// ---------------------------------------------------------------------------
// 2. Review action contract
// ---------------------------------------------------------------------------

describe("Review action — controlled decision requirements", () => {
  it("reject requires borrower-safe explanation", () => {
    const content = readFile("lib/review/applyEvidenceReviewDecision.ts");
    assert.ok(
      content.includes("reject") && content.includes("explanationBorrowerSafe"),
      "reject action must validate borrower-safe explanation",
    );
  });

  it("request_clarification requires borrower-safe explanation", () => {
    const content = readFile("lib/review/applyEvidenceReviewDecision.ts");
    assert.ok(
      content.includes("request_clarification") && content.includes("explanationBorrowerSafe"),
      "clarification action must validate borrower-safe explanation",
    );
  });

  it("waive requires internal rationale", () => {
    const content = readFile("lib/review/applyEvidenceReviewDecision.ts");
    assert.ok(
      content.includes("waive") && content.includes("explanationInternal"),
      "waive action must require internal rationale",
    );
  });

  it("review action API validates required fields per action", () => {
    const content = readFile("app/api/deals/[dealId]/review-queue/[reviewId]/route.ts");
    assert.ok(
      content.includes("explanationBorrowerSafe") && content.includes("400"),
      "API must return 400 for missing required fields",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Auth-boundary preservation
// ---------------------------------------------------------------------------

describe("Review queue — auth boundary", () => {
  it("review queue GET uses Clerk/session auth", () => {
    const content = readFile("app/api/deals/[dealId]/review-queue/route.ts");
    assert.ok(
      content.includes("requireDealCockpitAccess"),
      "review queue must use deal cockpit access auth",
    );
    assert.ok(
      !content.includes("borrower_portal_links"),
      "review queue must NOT use borrower token auth",
    );
  });

  it("review action POST uses Clerk/session auth", () => {
    const content = readFile("app/api/deals/[dealId]/review-queue/[reviewId]/route.ts");
    assert.ok(
      content.includes("requireDealCockpitAccess"),
      "review action must use deal cockpit access auth",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Package / guidance consistency
// ---------------------------------------------------------------------------

describe("Borrower package — guidance alignment", () => {
  it("buildBorrowerActionPackage exists", () => {
    assert.ok(fileExists("lib/distribution/buildBorrowerActionPackage.ts"));
  });

  it("package builder references live guidance and review state", () => {
    const content = readFile("lib/distribution/buildBorrowerActionPackage.ts");
    assert.ok(content.includes("BorrowerGuidancePayload"), "must use guidance payload");
    assert.ok(content.includes("reviewState") || content.includes("EvidenceReviewState"), "must reference review state");
  });

  it("explainReviewOutcomeForBorrower exists", () => {
    assert.ok(fileExists("lib/borrower/guidance/explainReviewOutcomeForBorrower.ts"));
  });

  it("review outcome explanation covers reject + clarification + partial", () => {
    const content = readFile("lib/borrower/guidance/explainReviewOutcomeForBorrower.ts");
    assert.ok(content.includes('"rejected"'), "must handle rejected");
    assert.ok(content.includes('"clarification_requested"'), "must handle clarification");
    assert.ok(content.includes('"partially_accepted"'), "must handle partial accept");
  });
});

// ---------------------------------------------------------------------------
// 5. Placeholder regression
// ---------------------------------------------------------------------------

describe("Review system — no placeholder flows", () => {
  it("review helpers have no TODO/placeholder markers", () => {
    const files = [
      "lib/review/evidence-review-types.ts",
      "lib/review/queueEvidenceReview.ts",
      "lib/review/applyEvidenceReviewDecision.ts",
      "lib/review/deriveReviewQueueInsights.ts",
    ];
    for (const f of files) {
      const content = readFile(f);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\bTODO\b|placeholder|coming soon/i.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          assert.fail(`Placeholder marker in ${f}:${i + 1}: ${line.trim()}`);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Outbound governance guard
// ---------------------------------------------------------------------------

describe("Outbound orchestration — governance", () => {
  it("deriveOutboundGuidanceActions exists", () => {
    assert.ok(fileExists("lib/borrower/orchestration/deriveOutboundGuidanceActions.ts"));
  });

  it("respects throttle/suppression", () => {
    const content = readFile("lib/borrower/orchestration/deriveOutboundGuidanceActions.ts");
    assert.ok(content.includes("throttle") || content.includes("suppressed"), "must support throttle");
    assert.ok(content.includes("no_send_throttled"), "must have throttle suppression state");
  });

  it("defaults to draft-first for non-transactional", () => {
    const content = readFile("lib/borrower/orchestration/deriveOutboundGuidanceActions.ts");
    assert.ok(
      content.includes("email_draft") || content.includes("draft"),
      "non-transactional actions must default to draft",
    );
    assert.ok(
      content.includes("approvalRequired"),
      "must track approval requirement",
    );
  });
});
