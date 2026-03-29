import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  computeLoanRequestStatus,
  deriveLoanRequestBlocker,
  deriveNextBestAction,
  buildBankerExplanation,
} from "../loanRequestCompleteness";
import type { LoanRequest } from "../loanRequestTypes";

function makeRequest(overrides: Partial<LoanRequest> = {}): LoanRequest {
  return {
    id: "lr-1",
    dealId: "d-1",
    requestName: "Test Request",
    loanAmount: 500000,
    loanPurpose: "Working capital",
    loanType: "term",
    collateralType: "real_estate",
    collateralDescription: "Office building",
    termMonths: 120,
    amortizationMonths: 240,
    interestType: "fixed",
    rateIndex: null,
    repaymentType: "amortizing",
    facilityPurpose: "working_capital",
    occupancyType: "owner_occupied",
    recourseType: "full",
    guarantorRequired: false,
    guarantorNotes: null,
    requestedCloseDate: null,
    useOfProceedsJson: null,
    covenantNotes: null,
    structureNotes: null,
    source: "banker",
    createdBy: "user-1",
    updatedBy: "user-1",
    ...overrides,
  };
}

// ─── Loan request completeness ────────────────────────────────────────────────

describe("computeLoanRequestStatus", () => {
  it("missing when null", () => {
    assert.equal(computeLoanRequestStatus(null).status, "missing");
  });

  it("complete when all required fields present", () => {
    const { status, missingFields } = computeLoanRequestStatus(makeRequest());
    assert.equal(status, "complete");
    assert.equal(missingFields.length, 0);
  });

  it("draft when loan_amount missing", () => {
    const { status, missingFields } = computeLoanRequestStatus(makeRequest({ loanAmount: null }));
    assert.equal(status, "draft");
    assert.ok(missingFields.includes("loan_amount"));
  });

  it("draft when multiple fields missing", () => {
    const { status, missingFields } = computeLoanRequestStatus(
      makeRequest({ loanAmount: null, loanPurpose: null, loanType: null }),
    );
    assert.equal(status, "draft");
    assert.equal(missingFields.length, 3);
  });

  it("requires occupancy_type for real estate collateral", () => {
    const { status, missingFields } = computeLoanRequestStatus(
      makeRequest({ collateralType: "real_estate", occupancyType: null }),
    );
    assert.equal(status, "draft");
    assert.ok(missingFields.includes("occupancy_type"));
  });

  it("requires guarantor_notes when guarantor required", () => {
    const { status, missingFields } = computeLoanRequestStatus(
      makeRequest({ guarantorRequired: true, guarantorNotes: null }),
    );
    assert.equal(status, "draft");
    assert.ok(missingFields.includes("guarantor_notes"));
  });

  it("deterministic", () => {
    const r1 = computeLoanRequestStatus(makeRequest({ loanAmount: null }));
    const r2 = computeLoanRequestStatus(makeRequest({ loanAmount: null }));
    assert.deepEqual(r1, r2);
  });
});

// ─── Blocker derivation ───────────────────────────────────────────────────────

describe("deriveLoanRequestBlocker", () => {
  it("returns loan_request_missing when null", () => {
    const blocker = deriveLoanRequestBlocker(null);
    assert.ok(blocker);
    assert.equal(blocker!.code, "loan_request_missing");
  });

  it("returns loan_request_incomplete when draft", () => {
    const blocker = deriveLoanRequestBlocker(makeRequest({ loanAmount: null }));
    assert.ok(blocker);
    assert.equal(blocker!.code, "loan_request_incomplete");
    assert.ok(blocker!.details.some((d) => d.includes("loan amount")));
  });

  it("returns null when complete", () => {
    assert.equal(deriveLoanRequestBlocker(makeRequest()), null);
  });
});

// ─── Next best action ─────────────────────────────────────────────────────────

describe("deriveNextBestAction", () => {
  it("prioritizes loan request missing over documents", () => {
    const action = deriveNextBestAction({
      loanRequestStatus: "missing",
      reviewRequiredCount: 5,
      missingRequiredCount: 3,
    });
    assert.ok(action);
    assert.equal(action!.code, "add_loan_request");
  });

  it("prioritizes loan request incomplete over documents", () => {
    const action = deriveNextBestAction({
      loanRequestStatus: "draft",
      reviewRequiredCount: 5,
      missingRequiredCount: 3,
    });
    assert.ok(action);
    assert.equal(action!.code, "complete_loan_request");
  });

  it("review_documents when loan request complete but docs need review", () => {
    const action = deriveNextBestAction({
      loanRequestStatus: "complete",
      reviewRequiredCount: 2,
      missingRequiredCount: 0,
    });
    assert.equal(action!.code, "review_documents");
  });

  it("upload_missing when loan request complete and no review needed", () => {
    const action = deriveNextBestAction({
      loanRequestStatus: "complete",
      reviewRequiredCount: 0,
      missingRequiredCount: 3,
    });
    assert.equal(action!.code, "upload_missing_documents");
  });

  it("open_underwriting when all clear", () => {
    const action = deriveNextBestAction({
      loanRequestStatus: "complete",
      reviewRequiredCount: 0,
      missingRequiredCount: 0,
    });
    assert.equal(action!.code, "open_underwriting");
  });
});

// ─── Banker explanation ───────────────────────────────────────────────────────

describe("buildBankerExplanation", () => {
  it("ready when no blockers", () => {
    const lines = buildBankerExplanation([]);
    assert.ok(lines[0].includes("ready for underwriting"));
  });

  it("explains blockers with numbered list", () => {
    const lines = buildBankerExplanation([
      { code: "loan_request_missing", title: "No loan request", details: ["Create one"] },
      { code: "required_documents_missing", title: "Missing 2 docs", details: ["Bank statements", "Rent roll"] },
    ]);
    assert.ok(lines.some((l) => l.includes("not ready")));
    assert.ok(lines.some((l) => l.includes("No loan request")));
    assert.ok(lines.some((l) => l.includes("Bank statements")));
  });
});

// ─── Pure file guards ─────────────────────────────────────────────────────────

describe("Deal control pure file guards", () => {
  const DIR = path.resolve(__dirname, "..");

  it("no DB imports in pure files", () => {
    for (const f of ["loanRequestTypes.ts", "loanRequestCompleteness.ts"]) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("supabaseAdmin"), `${f} must not import supabaseAdmin`);
    }
  });

  it("no Math.random", () => {
    for (const f of ["loanRequestTypes.ts", "loanRequestCompleteness.ts"]) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("Math.random"), `${f}`);
    }
  });

  it("loan request route writes audit log", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../../app/api/deals/[dealId]/loan-request/route.ts"),
      "utf-8",
    );
    assert.ok(content.includes("deal_audit_log"));
    assert.ok(content.includes("loan_request_created"));
    assert.ok(content.includes("loan_request_updated"));
  });

  it("document confirm route triggers recompute", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../../app/api/deals/[dealId]/documents/[documentId]/confirm/route.ts"),
      "utf-8",
    );
    assert.ok(content.includes("recomputeDealDocumentState"));
    assert.ok(content.includes("document_confirmed"));
  });

  it("document reject route triggers recompute", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../../app/api/deals/[dealId]/documents/[documentId]/reject/route.ts"),
      "utf-8",
    );
    assert.ok(content.includes("recomputeDealDocumentState"));
    assert.ok(content.includes("document_rejected"));
  });

  it("cockpit-state includes nextBestAction and guidance", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../../app/api/deals/[dealId]/cockpit-state/route.ts"),
      "utf-8",
    );
    assert.ok(content.includes("nextBestAction"));
    assert.ok(content.includes("bankerExplanation"));
    assert.ok(content.includes("loanRequest"));
    assert.ok(content.includes("permissions"));
  });
});
