import test from "node:test";
import assert from "node:assert/strict";
import { buildGuidedSnapshot } from "../../guidedPackage/questions";
import {
  chapterFor,
  CHAPTERS,
  orderedQuestions,
  recommendedQuestions,
  nextQuestion,
} from "../presentation";
import { explainProgramOptions } from "@/lib/sba/programGuidance";
import { DISCOVERY_CHOICES } from "../discovery";
import { packageInterviewAnswers } from "../../guidedPackage/interviewContext";
import {
  packageFilesForActor,
  canBorrowerDownload,
} from "@/lib/brokerage/lenderPackageFiles";
const fresh = () =>
  buildGuidedSnapshot({ rows: {}, facts: {}, revision: null });
test("first task is a goal, every question has a chapter and program choice is deferred", () => {
  const s = fresh();
  assert.equal(orderedQuestions(s, "plan")[0].id, "A11");
  assert.equal(
    chapterFor(s.questions.find((q) => q.id === "loan.sba_program")!),
    "application",
  );
  for (const q of s.questions)
    assert.ok(CHAPTERS.some((c) => c.id === chapterFor(q)));
  assert.ok(!orderedQuestions(s, "plan").some((q) => q.id === "A03"));
});
test("resume uses saved facts, false and zero count as answers", () => {
  const s = buildGuidedSnapshot({
    rows: { deal_loan_requests: [{ agent_used: false, requested_amount: 0 }] },
    facts: {
      package_answers: {
        A11: { value: "acquisition" },
        A01: { value: "Buy a shop" },
      },
    },
    revision: "v1",
  });
  assert.equal(nextQuestion(orderedQuestions(s, "plan"))?.id, "A12");
  assert.equal(
    s.questions.find((q) => q.id === "loan.agent_used")?.state,
    "saved",
  );
  assert.equal(
    s.questions.find((q) => q.id === "loan.amount_requested")?.value,
    0,
  );
});
test("structured intent remains human readable in package narrative", () => {
  assert.equal(
    packageInterviewAnswers({
      package_answers: { A11: { value: "working_capital" } },
    })[0].answer,
    "Manage cash flow",
  );
  for (const choices of Object.values(DISCOVERY_CHOICES))
    assert.equal(new Set(choices.map((c) => c[0])).size, choices.length);
});
for (const [goal, expected] of [
  ["acquisition", "7a"],
  ["property", "504"],
  ["equipment", "504"],
  ["working_capital", "working_capital"],
  ["mixed", "504"],
])
  test(`${goal} gives an explainable educational route`, () => {
    const g = explainProgramOptions({ goal }, new Date("2026-09-17"));
    assert.ok(g.topics.some((t) => t.id === expected));
    assert.equal(g.requiresPolicyRefresh, false);
    assert.match(g.missing, /lender/);
  });
test("specialist paths do not pretend Buddy can fulfill an application", () => {
  for (const specialty of ["disaster", "grant"]) {
    const g = explainProgramOptions({ goal: "growth", specialty });
    assert.ok(g.topics.every((t) => t.fulfillment === "specialist"));
  }
  assert.equal(
    explainProgramOptions({ goal: "property", occupancy: "rental" }).topics[0]
      .id,
    "property_review",
  );
  const small = explainProgramOptions({ goal: "startup", amount: 40000 });
  assert.equal(
    small.topics.find((t) => t.id === "microloan")?.fulfillment,
    "specialist",
  );
  assert.ok(
    !explainProgramOptions({ goal: "refinance", amount: 40000 }).topics.some(
      (t) => t.id === "microloan",
    ),
  );
  assert.ok(
    explainProgramOptions({
      goal: "growth",
      specialty: "manufacturing",
    }).topics.some((t) => t.id === "working_capital"),
  );
});
test("unknown facts are not qualification and future policy requires review", () => {
  assert.equal(explainProgramOptions({}).topics.length, 0);
  assert.equal(
    explainProgramOptions(
      { goal: "property" },
      new Date("2026-10-01T00:00:00Z"),
    ).requiresPolicyRefresh,
    true,
  );
});
test("borrower package omits internal memo; authorized lender package retains all six outputs", () => {
  assert.equal(canBorrowerDownload("credit_memo"), false);
  assert.equal(packageFilesForActor("borrower").length, 5);
  assert.equal(packageFilesForActor("lender").length, 6);
  assert.ok(
    !packageFilesForActor("borrower").some(
      (f) => String(f.kind) === "credit_memo",
    ),
  );
});

test("optional unrelated topics are deferred without removing saved answers or the complete map", () => {
  const s = buildGuidedSnapshot({
    rows: {},
    facts: {
      package_answers: {
        A11: { value: "working_capital" },
        I02: { value: "Previously supplied acquisition detail" },
      },
    },
    revision: null,
  });
  for (const c of CHAPTERS) {
    const recommended = recommendedQuestions(s, c.id);
    for (const q of orderedQuestions(s, c.id)) {
      if (q.required || q.state === "saved")
        assert.ok(recommended.some((r) => r.id === q.id));
      if (/^I\d{2}$/.test(q.id) && !q.required && q.state !== "saved")
        assert.ok(!recommended.some((r) => r.id === q.id));
    }
  }
});
