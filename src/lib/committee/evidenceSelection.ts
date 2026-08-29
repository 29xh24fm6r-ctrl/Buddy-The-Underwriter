import type { Citation } from "@/lib/retrieval/retrievalCore";

type EvaluationCitation = {
  i: number;
};

type EvaluationWithCitations = {
  citations: EvaluationCitation[];
};

export function formatCommitteeEvidence(citations: Citation[]): string {
  return citations
    .map((citation, index) =>
      [
        `EVIDENCE [${index + 1}]`,
        `source_kind: ${citation.source_kind}`,
        `chunk_id: ${citation.chunk_id}`,
        `label: ${citation.label}`,
        `quote: ${citation.quote.trim()}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function selectCitedEvidence(
  evaluations: EvaluationWithCitations[],
  evidence: Citation[],
): Citation[] {
  const citedIndices = new Set<number>();

  for (const evaluation of evaluations) {
    for (const citation of evaluation.citations) {
      if (citation.i < 1 || citation.i > evidence.length) {
        throw new Error("committee_evaluation_citation_invalid");
      }
      citedIndices.add(citation.i);
    }
  }

  const selected = Array.from(citedIndices)
    .sort((left, right) => left - right)
    .map((index) => evidence[index - 1]);

  if (selected.length === 0) {
    throw new Error("committee_evidence_selection_failed");
  }

  return selected;
}
