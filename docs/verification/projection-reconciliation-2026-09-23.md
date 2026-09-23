# Borrower package projection reconciliation

Verification used saved synthetic startup QA inputs and the real package engine and renderers with outbound networking disabled. No production facts, budgets, identities, signatures or release state were changed. No paid generation ran.

## Defect and repair

The previous startup output showed Year 1 assets of $518,041.08 against liabilities plus equity of $568,493.15. The cash forecast included transaction funding and uses, but the balance sheet did not recognize the new loan or funded assets. The P&L also omitted interest from profit, monthly cash omitted taxes, and the pre-opening PDF displayed the internal 99x coverage sentinel.

One shared projection ledger now supplies debt amortization, closing entries and asset roll-forwards to the existing annual, monthly and balance-sheet builders. Working-capital reserves remain cash, closing inventory is not purchased twice, opening startup equity is not counted as a second contribution, and current principal is separated from long-term debt. Monthly seasonality is applied per revenue stream, using the same working-capital day count as the balance sheet.

All forecast statements must reconcile before package admission or the alternate borrower PDF's first AI call. Unsupported project allocations, unclassified other funding, incomplete retained-debt schedules and payoff mismatches block preparation. No cash or equity balancing plug is used. Package snapshot version 5 rejects/recomputes earlier cached outputs.

The interview and roadmap share one accepted business/opening/funding basis and one memoized projection model. The alternate borrower PDF consumes the same package financial output. The Excel workbook retains formulas and canonical cached values, includes the complete forecast P&L and intangible assets, and exposes a balance check. PDF and spreadsheet show N/A for pre-opening or zero-debt-service coverage.

## Saved QA replay

| Measure | Year 1 | Year 2 | Year 3 |
|---|---:|---:|---:|
| Assets | $1,245,935.58 | $1,297,527.14 | $1,373,759.66 |
| Liabilities + equity | $1,245,935.58 | $1,297,527.14 | $1,373,759.66 |
| Ending loan principal | $891,725.25 | $827,348.37 | $756,230.40 |
| Cash | $416,409.33 | $660,191.24 | $928,556.96 |
| Interest expense | $92,377.09 | $86,274.96 | $79,533.86 |

Year 1 monthly cash equals balance-sheet cash. The real canonical memo and deterministic package preflight pass. Historical income remains empty for the unopened business; personal facts remain outside the business model. The replay client has no write methods and rejects uncaptured reads.

## Validation

- 3,913 network-disabled regression tests passed (3,889 standard + 24 react-server).
- Added coverage for startup funding, existing business debt/equity, seller debt maturity, payoff, multi-stream seasonality, zero-rate loans, unknown allocations, corrupt statements, formula caches, PDF text, unauthenticated access and rejection before AI.
- Rendered the actual PDF and Excel outputs from saved QA data. Inspected the balance-sheet page visually and verified the pre-opening N/A display and financial rows in the PDF.
- Imported the emitted workbook into an independent spreadsheet engine and recalculated it. All four balance-sheet columns reconcile within one cent; remaining differences were binary floating-point noise below $0.000001.

## Modeling basis and limits

The documents expose the deterministic planning basis: taxes at 25% of positive pretax income, monthly tax payments, five-year straight-line depreciation for new tangible assets, and 15-year amortization for identified initial franchise fees. These are forecasting conventions, not borrower tax elections or certified accounting lives. Initial franchise fees are separated from recurring royalties; the general 15-year intangible reference is the [IRS Form 4562 instructions](https://www.irs.gov/instructions/i4562).

Year-one planned capex includes funded tangible assets; only the excess is additional cash spending. Retained-note interest is inferred only where the supplied balance, payment and term form a fully amortizing schedule. Unspecified or balloon financing is rejected for review.

This verifies deterministic financial preparation and artifact rendering. It does not attest AI-written narrative quality, identity verification, signatures, bank acceptance or final release. Those remain governed by the existing completion and release gates.
