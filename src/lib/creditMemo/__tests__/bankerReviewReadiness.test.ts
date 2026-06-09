/**
 * BANKER_REVIEW_READINESS_CONTRACT_V1
 *
 * Proves that banker review required completion uses canonical memo data
 * before falling back to legacy override fields.
 *
 * PURITY NOTE: Imports only pure modules (no "server-only").
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  hasMemoBusinessDescription,
  hasMemoManagementBio,
  hasMemoCollateral,
  buildRequiredItems,
} from "@/lib/creditMemo/review/bankerReviewReadiness";

// Minimal memo stub factory
function stubMemo(overrides: Record<string, any> = {}): any {
  return {
    business_summary: {
      business_description: overrides.business_description ?? "Pending",
      ...overrides.business_summary,
    },
    banker_context: overrides.banker_context ?? undefined,
    management_qualifications: {
      principals: overrides.principals ?? [],
    },
    collateral: {
      gross_value: { value: overrides.gross_value ?? null },
      ar_borrowing_base: overrides.ar_borrowing_base ?? null,
      line_items: overrides.line_items ?? [],
    },
    financial_analysis: {
      dscr: { value: overrides.dscr ?? null },
    },
    key_metrics: {
      loan_amount: { value: overrides.loan_amount ?? null },
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// A. Canonical borrower story + canonical management, no overrides
// ══════════════════════════════════════════════════════════════════════════

describe("READINESS §A — Canonical sources satisfy requirements", () => {
  it("canonical borrower story passes business description check", () => {
    const memo = stubMemo({
      business_description: "OmniCare365 provides comprehensive home healthcare staffing services to hospitals and facilities.",
    });
    assert.ok(hasMemoBusinessDescription(memo, {}), "Canonical desc must pass");
  });

  it("canonical management profile passes bio check", () => {
    const memo = stubMemo({
      principals: [{
        id: "p1",
        name: "Matt Hunt",
        bio: "Founded OmniCare 365 in 2018. 25+ years in healthcare staffing. Prior: VP of Operations at MedStaff Inc. Credit: Strong personal credit.",
      }],
    });
    assert.ok(hasMemoManagementBio(memo, {}), "Canonical bio must pass");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. Legacy overrides only
// ══════════════════════════════════════════════════════════════════════════

describe("READINESS §B — Legacy overrides as fallback", () => {
  it("legacy override business_description passes when canonical is Pending", () => {
    const memo = stubMemo({ business_description: "Pending" });
    const overrides = { business_description: "This is a legacy business description that is longer than twenty characters." };
    assert.ok(hasMemoBusinessDescription(memo, overrides), "Legacy fallback must pass");
  });

  it("legacy override principal_bio passes when canonical bio is Pending", () => {
    const memo = stubMemo({
      principals: [{ id: "p1", name: "John", bio: "Pending — complete interview." }],
    });
    const overrides = { principal_bio_p1: "This is a detailed management biography from legacy overrides." };
    assert.ok(hasMemoManagementBio(memo, overrides), "Legacy bio fallback must pass");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. AR borrowing-base deal with stale collateral override
// ══════════════════════════════════════════════════════════════════════════

describe("READINESS §C — AR borrowing-base collateral", () => {
  it("AR borrowing base passes collateral check even without gross_value", () => {
    const memo = stubMemo({
      gross_value: null,
      ar_borrowing_base: { total_ar: 3_000_000, eligible_ar: 2_800_000, advance_rate: 0.80 },
    });
    assert.ok(hasMemoCollateral(memo), "AR BB must satisfy collateral");
  });

  it("AR line item passes collateral check", () => {
    const memo = stubMemo({
      gross_value: null,
      line_items: [{ description: "Accounts Receivable (AR Borrowing Base)" }],
    });
    assert.ok(hasMemoCollateral(memo), "AR line item must satisfy collateral");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D. Empty canonical + empty overrides
// ══════════════════════════════════════════════════════════════════════════

describe("READINESS §D — Empty state", () => {
  it("no business description from any source fails", () => {
    const memo = stubMemo({ business_description: "Pending" });
    assert.ok(!hasMemoBusinessDescription(memo, {}), "Empty must fail");
  });

  it("no management bio from any source fails", () => {
    const memo = stubMemo({ principals: [{ id: "p1", name: "X", bio: "Pending — complete interview." }] });
    assert.ok(!hasMemoManagementBio(memo, {}), "Pending bio must fail");
  });

  it("no collateral from any source fails", () => {
    const memo = stubMemo({ gross_value: null });
    assert.ok(!hasMemoCollateral(memo), "No collateral must fail");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// E. OmniCare-style fixture: full canonical = 5/5
// ══════════════════════════════════════════════════════════════════════════

describe("READINESS §E — Full canonical deal = 6/6", () => {
  it("all required items pass from canonical memo data alone", () => {
    const memo = stubMemo({
      business_description: "OmniCare365 provides comprehensive home healthcare staffing services to hospitals, assisted living facilities, and rehabilitation centers across the southeastern United States.",
      principals: [{
        id: "p1",
        name: "Matt Hunt",
        bio: "Founded OmniCare 365 in 2018. 25+ years in healthcare staffing and BPO services. Prior: VP of Operations at MedStaff Inc. Credit: Strong personal credit, significant net worth.",
      }],
      ar_borrowing_base: { total_ar: 3_007_506, eligible_ar: 2_854_124, advance_rate: 0.80 },
      dscr: 7.12,
      loan_amount: 1_500_000,
    });

    const items = buildRequiredItems(memo, {});
    const doneCount = items.filter((r) => r.ok).length;
    // 6 items incl. committee_ready (no committee model on this fixture → gate n/a, ok).
    assert.equal(doneCount, 6, `Expected 6/6, got ${doneCount}/6: ${items.filter((r) => !r.ok).map((r) => r.id).join(", ")}`);

    // Verify labels are canonical-friendly (no "filled ≥ 20 chars")
    assert.ok(!items.some((r) => r.label.includes("≥ 20")), "Labels must not mention char counts");
    assert.ok(items.some((r) => r.label === "Business profile available"), "Must use canonical label");
    assert.ok(items.some((r) => r.label === "Management profile available"), "Must use canonical label");
  });
});
