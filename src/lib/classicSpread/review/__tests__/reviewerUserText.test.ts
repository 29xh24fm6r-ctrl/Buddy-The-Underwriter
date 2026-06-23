import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { applyReviewDecisions, type ReviewDecision } from "../applyReviewDecisions";
import { reviewFindingKey } from "../buildReviewActions";
import type { SpreadAuditResult, SpreadAuditFinding } from "../../audit/spreadAccuracyAudit";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

/**
 * reviewer_user_id holds the app user id from auth (Clerk: "user_2ab..."), which is NOT a UUID.
 * The column must be text, and the decision path must accept a non-UUID reviewer id.
 */

describe("reviewer_user_id supports non-UUID app user ids", () => {
  it("the follow-up migration widens reviewer_user_id to text", () => {
    const sql = read("supabase/migrations/20260615_classic_spread_review_actions_reviewer_user_text.sql");
    assert.match(sql, /ALTER COLUMN reviewer_user_id TYPE text USING reviewer_user_id::text/);
  });

  it("the base table defines reviewer_user_id as text (not uuid)", () => {
    const base = read("supabase/migrations/20260615_classic_spread_review_actions.sql");
    assert.match(base, /reviewer_user_id\s+text/);
    assert.doesNotMatch(base, /reviewer_user_id\s+uuid/);
  });

  it("a non-UUID Clerk user id is honored as a real reviewer (decision applies)", () => {
    const f: SpreadAuditFinding = {
      period: "2024", statement: "balance_sheet", rowLabel: "TOTAL NET WORTH", issueType: "rejected_source_value",
      expectedValue: 4_512_938, actualValue: 6_800_000, difference: 2_287_062, tolerance: 1,
      sourceFactIds: [], documentIds: [], severity: "blocker", detail: "rejected SL_TOTAL_EQUITY",
    };
    const audit: SpreadAuditResult = {
      status: "blocker", findings: [f],
      summary: { blockers: 1, warnings: 0, infos: 0, periodsAudited: ["2024"], footingsChecked: 5, mappedFactKeys: 3, unmappedFactKeys: 0 },
      blockedCells: [{ period: "2024", statement: "balance_sheet", rowLabel: "TOTAL NET WORTH" }],
      actionSummary: { byPeriod: {}, byDocument: {}, byAction: {}, unresolvedActionCount: 1, actions: [] },
    };
    const decision: ReviewDecision = {
      findingKey: reviewFindingKey(f),
      status: "confirmed_resolved_value",
      reviewedAt: "2026-06-15T00:00:00Z",
      reviewerUserId: "user_2abcDEF456ghiJKL", // Clerk-style, non-UUID
    };
    const out = applyReviewDecisions(audit, [decision]);
    assert.equal(out.summary.blockers, 0);
    assert.equal(out.findings[0]!.severity, "warning");
    assert.equal(out.findings[0]!.reviewStatus, "confirmed_resolved_value");
  });
});
