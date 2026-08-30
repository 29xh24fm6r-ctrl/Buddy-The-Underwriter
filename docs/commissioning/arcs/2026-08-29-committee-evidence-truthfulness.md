# Committee evidence truthfulness commissioning arc

Date: 2026-08-29
Product boundary: Buddy The Underwriter only

## Evidence

The deployed-source SBA committee path accepted numbered citation references from each
AI persona, but the prompt supplied unnumbered quote text without source identity.
After generation, it persisted every retrieved citation rather than the subset the
personas actually referenced. Database errors from individual retrieval stores were
also converted to empty result sets, allowing a recommendation to proceed on a
silently partial evidence corpus.

## Root cause

The evaluation contract and the evidence prompt evolved independently. Citation
indexes were validated only against the count of retrieved rows, while the durable
AI event did not preserve the index-to-source catalog. Persistence treated retrieval
as equivalent to citation. Retrieval helpers also used best-effort empty-array
fallbacks even though committee recommendations are authoritative underwriting
outputs.

## Repair

- Format every model-visible evidence item with a stable one-based index, source
  kind, chunk ID, label, and quote.
- Preserve the index-to-source catalog in the AI event.
- Resolve the union of evidence actually cited by personas and persist only that
  subset.
- Require returned-row count and chunk-identity proof for citation persistence.
- Fail closed when deal-document, SBA SOP, or bank-policy retrieval reports a
  database error.

## Regression coverage

- Runtime tests prove stable prompt identities, cited-only selection, deduplication,
  and invalid/empty-reference rejection.
- Architecture tests require returned-row proof and fail-closed retrieval behavior.
- Broad repository CI remains the merge gate.

## Production verification

This repair is not in production until its pull request is merged and deployed.
Post-merge closure requires an authorized committee evaluation fixture with at least
two evidence sources, followed by direct verification that the AI event catalog,
persona indexes, and persisted citation rows agree exactly.

## Unresolved adjacent risk

Repeated SignWell signature requests have no proven provider or database
idempotency claim. That repair conflicts with the open signed-PDF immutability
branch and needs verified production schema evidence before a uniqueness contract
can be chosen safely.

The Golden Trident seal-to-marketplace-to-lender transaction remains blocked on a
verified Buddy-owned Supabase connection and an authorized sealed transaction.
