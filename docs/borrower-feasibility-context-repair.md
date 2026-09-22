# Borrower feasibility context and narrative recovery

## Production failure observed

On September 22, 2026, QA bundle `d28b68e0-0088-44fe-a145-c6401582bd21` stopped at feasibility narrative acceptance: four of five required sections were substantive. The executive summary contained a placeholder. The generated operational narrative also called the saved 7 Brew franchise scenario a non-franchise. The saved borrower record and interview already held the legal name, Flowery Branch location and new-franchise transaction.

## Repair

- One borrower-context loader uses saved borrower business identity/location, with legacy application/deal fallbacks. Read failures and bank mismatches fail closed.
- SBA plan generation, feasibility generation, feasibility review and feasibility resume use this context. Interview statements remain statements, not verified research or franchise-directory certification.
- Explicit saved franchise transaction choices establish declared franchise intent without requiring a directory brand link. Brand comparison still requires a linked brand. Missing franchise-support data remains an evidence gap.
- Startup policy comes from the same immutable financial snapshot as the projections when available.
- A missing, malformed or thin narrative section gets one targeted retry with the same evidence. Successful sections are reused; existing final acceptance, institutional review, score and release gates remain in force.
- The borrower receives specific recovery guidance without private errors or a request to re-enter saved answers.

## Verification

71 focused regression tests passed; TypeScript checking passed. Tests exercise missing legacy application, unlinked declared franchise, operating-city precedence, cross-bank rejection, institutional-review identity, bounded narrative retries and fail-closed acceptance.

The live repaired generation still requires deployment of this change. Do not interpret local tests as proof of production completion.

## Isolated research fixture

`scripts/qa/commission-7brew-research.sql` supplies an explicitly synthetic source/fact/citation graph for the existing QA 7 Brew scenario. It requires the exact test deal, bank, borrower name and city/state, uses qa.invalid URLs and illustrative numbers, and never writes generated documents, scores, identity-verification results or bundle success. It does not change release policy.

The attempted fixture load was rejected by the connected database's read-only transaction. No fixture changes were applied. Run it through an authorized write connection before the next complete QA generation; no schema migration is required. Missing site/FDD evidence is intentionally not invented by this fixture.
