# Package financial authority and reliability repair

The complete-package workflow prepares one immutable `deal_model_snapshots.package_output` before forms or AI generation. It extends Model Engine V2 using the existing projection, funding, historical spread and cash-flow calculators; it does not add a replacement engine.

The saved output contains historical periods, annual/monthly projections, assumptions, sources and uses, balance sheets, global cash flow, audited spread render inputs and the complete deterministic canonical memo. Package documents bind to its ID. The memo generator reads the saved memo instead of rebuilding its financial tables. The business plan and feasibility consume the bound projection package. Forms 1919, 1244 and 148/148L receive the bound loan amount; personal disclosures, fees, lender approvals and signatures retain their distinct source records. Frozen-input checks cover those source records.

## Failure handling and reuse

- Reject conflicting historical figures, missing established-business history, changed inputs, tampered outputs and cross-deal snapshot reads before generation.
- Verify persisted projection figures and memo/spread bindings before publication.
- Reuse only identical financial/input versions. Do not attach old feasibility to a different projection package, reuse preview content as final, or adopt missing files.
- Cache reviews against the final reviewed text and evidence. Preserve warning disclosures without repeatedly rewriting them. Critical findings still block release.
- Stop final generation when the assumptions narrative is unavailable. Classify budget, billing, input and review failures as terminal for that attempt rather than retrying immediately.
- Extend the existing atomic gateway reservation ledger: 150,000 tokens per role per run and half of each daily role budget for QA. Admission checks headroom; it does not promise that the complete run will fit or reserve all future capacity. Reservations are estimates; settled usage replaces them.

## Database and deployment

Migration `20260917162449_package_financial_authority.sql` is additive and was applied to Buddy on September 17, 2026. Package output cannot be mutated; only server credentials can invoke the new reservation function. Existing metric-only snapshots and non-package routes retain compatibility.

Snapshot identity is versioned. Changes to financial computation or review rules must invalidate the package identity rather than reuse old acceptance.

## Verification and limits

Tests cover actual financial calculations with synthetic QA facts, save/reload/reuse, tampering and tenant isolation, database immutability and reservations, numeric publication checks, review hashing and missing-file/cross-package resume behavior. Existing regression and architecture checks also run.

This change centralizes the complete-package path. It does not establish that every legacy diagnostic or interactive financial endpoint has been retired; the repository guard still lists seven legacy producer consumers. A shared output also cannot supply missing evidence or external API credits. Before claiming full-package acceptance, run the deployed QA application, download all six deliverables and inspect/reconcile their contents. Microphone capture, lender approval and signature completion are separate acceptance checks.
