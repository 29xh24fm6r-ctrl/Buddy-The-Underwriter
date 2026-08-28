import test from "node:test";
import assert from "node:assert/strict";
import {
  assertGroundedCommitteeCitations,
  type CommitteeCitationClaim,
  type CommitteeCitationSource,
} from "../grounding";

const sources: CommitteeCitationSource[] = [
  {
    source_kind: "deal_doc_chunk",
    chunk_id: "deal-1",
    content: "Trailing twelve-month revenue was $1.25 million.",
  },
  {
    source_kind: "bank_policy_chunk",
    chunk_id: "policy-1",
    content: "Minimum debt service coverage is 1.25x.",
  },
];

test("accepts citations whose source and quote are admitted evidence", () => {
  assert.doesNotThrow(() =>
    assertGroundedCommitteeCitations(
      [
        {
          source_kind: "deal_doc_chunk",
          chunk_id: "deal-1",
          quote: "revenue was $1.25 million",
        },
      ],
      sources,
    ),
  );
});

test("rejects a model-invented chunk identifier", () => {
  assert.throws(
    () =>
      assertGroundedCommitteeCitations(
        [
          {
            source_kind: "deal_doc_chunk",
            chunk_id: "invented",
            quote: "revenue was $1.25 million",
          },
        ],
        sources,
      ),
    /committee_citation_source_invalid/,
  );
});

test("rejects a paraphrase that is not present in the admitted evidence", () => {
  assert.throws(
    () =>
      assertGroundedCommitteeCitations(
        [
          {
            source_kind: "bank_policy_chunk",
            chunk_id: "policy-1",
            quote: "The bank always requires strong coverage.",
          },
        ],
        sources,
      ),
    /committee_citation_quote_invalid/,
  );
});

test("rejects an answer with no citations", () => {
  assert.throws(
    () =>
      assertGroundedCommitteeCitations(
        [] as CommitteeCitationClaim[],
        sources,
      ),
    /committee_citations_required/,
  );
});
