import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSendPackage } from "../sendPackageBuilder";
import type { SpreadFlag, BorrowerQuestion } from "../types";

function makeQuestion(overrides: Partial<BorrowerQuestion> = {}): BorrowerQuestion {
  return {
    question_id: "q_1",
    flag_id: "flag_1",
    question_text: "Test question text",
    question_context: "Test context",
    document_urgency: "preferred",
    recipient_type: "borrower",
    ...overrides,
  };
}

function makeFlag(
  status: string,
  question: BorrowerQuestion | null,
  triggerType = "test_trigger",
): SpreadFlag {
  return {
    flag_id: "flag_1",
    deal_id: "deal-1",
    category: "financial_irregularity",
    severity: "elevated",
    trigger_type: triggerType,
    canonical_keys_involved: [],
    observed_value: null,
    banker_summary: "Summary",
    banker_detail: "Detail",
    banker_implication: "Implication",
    borrower_question: question,
    status: status as SpreadFlag["status"],
    auto_generated: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe("sendPackageBuilder", () => {
  // ── Only banker_reviewed flags ─────────────────────────────────────────
  it("only includes flags with status=banker_reviewed and non-null question", () => {
    const flags = [
      makeFlag("banker_reviewed", makeQuestion({ question_id: "q_1" })),
      makeFlag("open", makeQuestion({ question_id: "q_2" })),
      makeFlag("banker_reviewed", null),
      makeFlag("resolved", makeQuestion({ question_id: "q_3" })),
    ];
    const pkg = buildSendPackage(flags, "Acme Corp");
    assert.equal(pkg.questions.length, 1);
    assert.equal(pkg.questions[0].question_id, "q_1");
  });

  // ── Document request separation ────────────────────────────────────────
  it("separates document requests from general questions", () => {
    const flags = [
      makeFlag("banker_reviewed", makeQuestion({
        question_id: "q_general",
        document_requested: undefined,
      }), "dscr_below_1x"),
      makeFlag("banker_reviewed", makeQuestion({
        question_id: "q_doc",
        document_requested: "Current AR aging report",
        document_format: "PDF",
      }), "dso_above_90"),
    ];
    const pkg = buildSendPackage(flags, "Acme Corp");
    assert.equal(pkg.questions.length, 2);
    assert.equal(pkg.document_requests.length, 1);
    assert.equal(pkg.document_requests[0].question_id, "q_doc");
  });

  // ── Cover message ──────────────────────────────────────────────────────
  it("generates cover message with deal name and item count", () => {
    const flags = [
      makeFlag("banker_reviewed", makeQuestion(), "dscr_below_1x"),
      makeFlag("banker_reviewed", makeQuestion({
        question_id: "q_2",
        document_requested: "AR aging",
      }), "dso_above_90"),
    ];
    const pkg = buildSendPackage(flags, "Acme Corp");
    assert.ok(pkg.cover_message.includes("Acme Corp"));
    assert.ok(pkg.cover_message.includes("2 items"));
  });

  it("generates no-items cover message when no approved questions", () => {
    const pkg = buildSendPackage([], "Acme Corp");
    assert.ok(pkg.cover_message.includes("no outstanding items"));
    assert.ok(pkg.cover_message.includes("Acme Corp"));
    assert.equal(pkg.questions.length, 0);
  });

  // ── assembled_at ───────────────────────────────────────────────────────
  it("sets assembled_at to an ISO string", () => {
    const pkg = buildSendPackage([], "Test");
    assert.ok(pkg.assembled_at.includes("T"));
    assert.ok(!isNaN(new Date(pkg.assembled_at).getTime()));
  });
});
