import test from "node:test";
import assert from "node:assert/strict";
import {
  __formatCommitteeEvidenceForTests,
  __selectCitedEvidenceForTests,
  type PersonaEvaluation,
} from "../../sba/committee";
import type { Citation } from "../../retrieval/retrievalCore";

const evidence: Citation[] = [
  {
    source_kind: "DEAL_DOC",
    chunk_id: "deal-1",
    label: "2025 tax return",
    quote: "Reported revenue was one million dollars.",
    similarity: 0.92,
  },
  {
    source_kind: "BANK_POLICY",
    chunk_id: "policy-1",
    label: "Credit policy",
    quote: "Minimum debt service coverage is 1.25 times.",
    similarity: 0.88,
  },
  {
    source_kind: "SBA_SOP",
    chunk_id: "sop-1",
    label: "SBA 7(a) SOP",
    quote: "The lender must document repayment ability.",
    similarity: 0.85,
  },
];

function evaluation(
  persona: PersonaEvaluation["persona"],
  citations: PersonaEvaluation["citations"],
): PersonaEvaluation {
  return {
    persona,
    display_name: persona,
    stance: "APPROVE_WITH_CONDITIONS",
    concerns: [],
    required_fixes: [],
    citations,
  };
}

test("committee evidence prompt preserves stable citation identities", () => {
  const formatted = __formatCommitteeEvidenceForTests(evidence);

  assert.match(formatted, /EVIDENCE \[1\]/);
  assert.match(formatted, /source_kind: DEAL_DOC/);
  assert.match(formatted, /chunk_id: deal-1/);
  assert.match(formatted, /label: 2025 tax return/);
  assert.match(formatted, /quote: Reported revenue was one million dollars\./);
  assert.match(formatted, /EVIDENCE \[3\]/);
});

test("committee persistence selects only evidence actually cited", () => {
  const selected = __selectCitedEvidenceForTests(
    [
      evaluation("credit", [{ i: 2, reason: "policy threshold" }]),
      evaluation("risk", [
        { i: 3, reason: "SBA repayment requirement" },
        { i: 2, reason: "same policy threshold" },
      ]),
    ],
    evidence,
  );

  assert.deepEqual(
    selected.map((citation) => citation.chunk_id),
    ["policy-1", "sop-1"],
  );
});

test("committee evidence selection fails closed on invalid or empty references", () => {
  assert.throws(
    () =>
      __selectCitedEvidenceForTests(
        [evaluation("credit", [{ i: 4, reason: "out of range" }])],
        evidence,
      ),
    /committee_evaluation_citation_invalid/,
  );
  assert.throws(
    () => __selectCitedEvidenceForTests([], evidence),
    /committee_evidence_selection_failed/,
  );
});
