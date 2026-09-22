# Startup package spread repair — 2026-09-22

## Production evidence

After PR #1111, QA bundle `dc72f659-dd1b-4110-b6c0-468dfd42e96a` completed SBA forms and failed at `canonical_credit` with `Preflight blocked: missing_financial_facts`.
Snapshot `bf765d19-cd49-4dc8-93d7-9a440c35dc96` recorded `pre_opening`, a documented opening balance (cash/assets/equity $250,000, liabilities $0), and three complete projections. Its classic historical spread had one interim period but zero balance-sheet and income-statement rows. The worker required historical rows and stopped before credit memo generation.

## Repair

- Freeze startup opening balances, their date, confirmed assumption timestamp and three forecast years in the existing package financial snapshot.
- Use the existing startup validation checks before admitting this presentation. Ordinary historical spread admission is unchanged. Missing values, imbalanced opening statements, missing/unconfirmed/mislabeled forecasts and invalid coverage remain blocked.
- Render separate preliminary opening-balance and forecast pages in the existing PDF renderer. All financial values copy the authoritative model. No forecast is written into historical facts, rows or cash flow.
- Preserve source-certification findings and personal-income pages. Do not use the historical narrative prompt for a startup forecast.
- Include startup values in the PDF content hash and increment the package snapshot version so retries compute a fresh immutable snapshot rather than reuse the old payload.
- Keep lender acceptance, borrower artifact release, signatures, research and institutional release gates unchanged.

## Verification

268 focused regression tests passed, including startup/operating-business admission, incomplete input rejection, preservation of null versus zero, unchanged model values, PDF cache invalidation, real PDF rendering, worker persistence from a frozen snapshot, tenant/snapshot argument forwarding, existing historical spread tests, and Trident release guards. TypeScript passed. Rendered the PDF and visually checked both startup pages.

## Limits and next production verification

This is a repair of the proven spread blocker, not evidence of a finished production package or credit memo. No production financial records were modified. After deployment, retry the QA journey and verify all artifacts and release restrictions.

The current QA budget separately contains $1,200,000 funding versus $950,000 itemized uses. Its $250,000 difference must be explicitly reconciled in the application; do not invent an expense or disable the sources-and-uses gate. The test also retains document-certification warnings, which remain visible in the spread.
