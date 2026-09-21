# Borrower startup validation repair

## Observed production failure

After PR #1109, the isolated 7 Brew startup test saved 86 answers and processed
two documents without staff confirmation. Preparation then failed because
the historical completeness validator required revenue, net income, cash flow,
debt service and DSCR before the projection engine had run. No completed
package was produced by that test.

## Repair

- Use the saved business-stage answer to identify a pre-opening business.
  Missing history, a newly formed entity, or a franchise purchase alone does
  not establish startup status. Contradictory operating/acquisition evidence
  blocks preparation.
- Share the existing package calculation with validation. Artifact-facing
  generation retains its validation gate; calculation does not publish a
  package or manufacture historical facts.
- Require a documented opening balance sheet, including opening cash, and
  reconcile its detailed amounts with the totals. Interim opening statements
  do not need to be fiscal year-end statements.
- Validate all three forecast years using the existing reconciliation rules.
  Persist a forecast-basis warning and include assumptions/model output in the
  validation cache hash. Historical facts remain unchanged.
- Label the pre-opening projection anchor explicitly in the PDF and workbook.
  Version the package financial snapshot so older output cannot be reused.
- Show preparation failure above the optimistic input-readiness message.

## Verification and limits

The regression tests exercise the actual financial model, projection
calculator, validator and preparation workflow, with database doubles and a
stub at final artifact admission. They cover startup success, established
business requirements, conflicting history, missing cash, imbalanced opening
balances, non-finite forecasts, changed assumptions, tenant mismatch and
storage failure. They assert that forecasts never enter historical facts.

The full unit run passed 14,388 tests with 9 existing skips; the additional
final focused run passed 27 tests. TypeScript, ESLint and the select-column
schema gate passed. CI and preview deployment must also pass before merge.

This is proof of the repaired preparation dependency, not proof that a full
production loan package has been generated. After deployment, resume the
isolated startup test and inspect the generated forms, business plan,
feasibility, projections, spreads and credit memo. Document sufficiency and
content quality still require verification. Bank-acceptance and borrower
release gates are unchanged.
