# Borrower factory build — September 19, 2026

## Invariants

- Keep the existing financial engine, fact transactions, preparation workflow and document generators.
- Preparation, required forms, borrower input review and signatures must not depend on borrower artifact release.
- Release generated borrower documents only after an active bank claim and matching borrower selection, backed by an unrevoked full package grant and a still-sealed package for the same deal/listing/claim/bank.
- A claim is not a credit approval. The credit memo remains lender/internal-only after borrower release too.
- Read errors fail closed for artifact access, not for package preparation.

## Implemented in this increment

- An exhaustive 165-question-to-24-activity catalog, including each reviewed treatment (reuse/merge/review/conditional/keep).
- Small activity groups (at most four ordinary inputs) with one save action through the existing conflict-checked transactions; partial failures retain remaining drafts.
- Saved input reuse, an editable single-question/voice fallback, and unchanged protected identity/legal confirmations/specialized financial editors.
- Activity-based full application map; saved project goal shown in the header.
- Franchise follow-ups enter missions when franchise intent is present. Buying franchise rights is not silently classified as buying an operating company.
- Server-enforced borrower release on cookie and token download/preview surfaces, status-only responses before release, filtered borrower manifests and no premature download CTA.
- Bank/internal access and generation admission remain independent of borrower release. No database migration or financial calculation changes.

## Scope and verification limits

This is an incremental factory build, not a claim that all 24 activities have bespoke editors or all 165 prompts have been replaced by automated extraction. The existing document, ownership, personal-financial and assumptions editors remain in place. Further consolidation must preserve entity, owner, period, provenance and explicit confirmation distinctions.

Automated regression tests cover the activity catalog, partial saves, franchise routing, access mismatches/revocation, preview sanitization and existing generation/delivery behavior. Local unit tests are not proof of a live borrower completing identity verification, signatures, document acceptance and bank selection.

Before production sign-off, run an authenticated borrower journey using test data, inspect the generated business plan/feasibility/projections/spreads/forms and lender memo, and verify both locked and released states with a sanctioned bank-selection test. Test applications remain distribution-blocked; do not bypass that safety control to manufacture a passing end-to-end result.

## Rollout

Ship through the normal reviewed PR and CI flow. Do not merge or declare production completion from this document alone. The release evaluator uses existing production columns, verified read-only; no production records were changed during development.
