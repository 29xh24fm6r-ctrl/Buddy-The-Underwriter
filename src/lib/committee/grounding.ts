export type CommitteeCitationSourceKind =
  | "deal_doc_chunk"
  | "bank_policy_chunk";

export type CommitteeCitationClaim = {
  source_kind: CommitteeCitationSourceKind;
  chunk_id: string;
  quote: string;
};

export type CommitteeCitationSource = {
  source_kind: CommitteeCitationSourceKind;
  chunk_id: string;
  content: string;
};

function normalizeCitationText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

/**
 * Proves that every model citation points to evidence admitted for this run and
 * quotes text actually present in that evidence. The model is never allowed to
 * turn an invented chunk identifier or paraphrase into durable provenance.
 */
export function assertGroundedCommitteeCitations(
  claims: CommitteeCitationClaim[],
  sources: CommitteeCitationSource[],
): void {
  if (claims.length === 0) {
    throw new Error("committee_citations_required");
  }

  const sourceByKey = new Map(
    sources.map((source) => [
      `${source.source_kind}:${source.chunk_id}`,
      normalizeCitationText(source.content),
    ]),
  );

  for (const claim of claims) {
    const source = sourceByKey.get(
      `${claim.source_kind}:${claim.chunk_id}`,
    );
    if (!source) {
      throw new Error("committee_citation_source_invalid");
    }

    const quote = normalizeCitationText(claim.quote);
    if (quote.length < 10 || !source.includes(quote)) {
      throw new Error("committee_citation_quote_invalid");
    }
  }
}
