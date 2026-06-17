/**
 * BUGFIX-CLASSIC-SPREAD-BORROWER-REQUESTED-STILL-OPEN-1 — `borrower_detail_requested` is an ACTIVE,
 * blocking state (request created, support not yet uploaded), NOT a reviewed/closed one.
 *
 * Proves: the status predicate treats it as active; the open/reviewed split (used by the panel) keeps
 * it in the open list; the certification open-action count includes it; and the panel + loader are
 * wired to the shared predicate (+ the "awaiting upload" copy). Reviewed/closed statuses stay settled.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { isActiveReviewActionStatus, ACTIVE_REVIEW_ACTION_STATUSES } from "../reviewActionStatus";
import { buildClassicSpreadCertificationSummary } from "../../certification/certificationSummary";
import type { ClassicSpreadCertificationAudit } from "../../certification/certifiedSpreadGateCore";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

describe("isActiveReviewActionStatus", () => {
  it("treats open AND borrower_detail_requested as active/blocking", () => {
    assert.equal(isActiveReviewActionStatus("open"), true);
    assert.equal(isActiveReviewActionStatus("borrower_detail_requested"), true);
    assert.deepEqual([...ACTIVE_REVIEW_ACTION_STATUSES], ["open", "borrower_detail_requested"]);
  });

  it("treats reviewed/closed/waived/confirmed/verified as settled (not active)", () => {
    for (const s of ["confirmed_resolved_value", "rejected_source_value", "source_verified", "waived", "closed"]) {
      assert.equal(isActiveReviewActionStatus(s), false, `${s} must be settled`);
    }
    assert.equal(isActiveReviewActionStatus(null), false);
    assert.equal(isActiveReviewActionStatus(undefined), false);
  });
});

describe("open/reviewed split (panel + open-count semantics)", () => {
  const rows = [
    { id: "1", status: "open" },
    { id: "2", status: "borrower_detail_requested" },
    { id: "3", status: "confirmed_resolved_value" },
    { id: "4", status: "closed" },
  ];
  it("borrower_detail_requested counts as OPEN, not reviewed", () => {
    const open = rows.filter((a) => isActiveReviewActionStatus(a.status));
    const reviewed = rows.filter((a) => !isActiveReviewActionStatus(a.status));
    assert.deepEqual(open.map((r) => r.id), ["1", "2"]); // 1 real + the borrower-requested one
    assert.deepEqual(reviewed.map((r) => r.id), ["3", "4"]);
  });

  it("the loader open-count includes borrower_detail_requested", () => {
    const decisions = [
      { status: "borrower_detail_requested" },
      { status: "open" },
      { status: "waived" },
    ];
    const openReviewActionCount = decisions.filter((d) => isActiveReviewActionStatus(d.status)).length;
    assert.equal(openReviewActionCount, 2);
  });
});

describe("certification summary surfaces borrower_detail_requested as an open action", () => {
  const cleanAudit = (): ClassicSpreadCertificationAudit => ({
    certificationVersion: 0,
    domains: {
      balance_sheet: { status: "clean", blocked: [] },
      personal_income: { status: "clean", replacements: [] },
      global_cash_flow: { status: "clean", preliminary: false, blocked: [] },
      ratios: { status: "clean", suppressed: [] },
    },
    dependencyStatuses: { personalIncome: "ok" },
    suppressions: [],
    spreadAccuracy: {
      status: "clean", findings: [],
      summary: { blockers: 0, warnings: 0, infos: 0, periodsAudited: [], footingsChecked: 0, mappedFactKeys: 0, unmappedFactKeys: 0 },
      blockedCells: [], actionSummary: { byPeriod: {}, byDocument: {}, byAction: {}, unresolvedActionCount: 0, actions: [] },
    },
  });

  it("openReviewActionCount of 1 (the borrower-requested action) keeps the spread non-certified", () => {
    const s = buildClassicSpreadCertificationSummary({ certified: true, audit: cleanAudit(), openReviewActionCount: 1 });
    assert.equal(s.openReviewActionCount, 1);
    assert.notEqual(s.status, "certified"); // an open action blocks certification (preliminary at least)
  });
});

describe("wiring guards", () => {
  it("the panel splits open/reviewed via isActiveReviewActionStatus and shows the awaiting-upload copy", () => {
    const panel = read("src/components/deals/spreads/SpreadReviewActionsPanel.tsx");
    assert.match(panel, /isActiveReviewActionStatus/);
    assert.match(panel, /Borrower detail requested — awaiting upload/);
    // must NOT regress to the old open === "open" split that hid borrower_detail_requested
    assert.doesNotMatch(panel, /a\.status === "open"/);
    assert.doesNotMatch(panel, /a\.status !== "open"/);
  });

  it("the loader open-count uses the shared active predicate (not status === 'open')", () => {
    const loader = read("src/lib/classicSpread/classicSpreadLoader.ts");
    assert.match(loader, /isActiveReviewActionStatus\(d\.status\)/);
    assert.doesNotMatch(loader, /d\.status === "open"/);
  });
});
