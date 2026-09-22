# Borrower score finalization and reserve coverage

Production baseline: main `90a32e758b3d2731924bc61594917b68a7eae40a` (PR 1113).

The borrower package factory never called score locking, although submission requires a locked score. Score reads also used unbounded `maybeSingle()` against versioned projection and feasibility tables, and read legacy equity field names. Feasibility always supplied null for reserve months.

The final factory now computes the existing deterministic SBA score after artifact/release validation and before atomic publication. It pins projection and feasibility IDs to the bundle, checks their deal/bank relationship, records the bundle/input hash and scoring inputs, and compare-and-sets the exact score row. Retrying identical evidence reuses its score. A replaced score, unavailable evidence or failed lock blocks publication. Frozen inputs are checked again after scoring. Low/ineligible results remain low/ineligible and existing submission gates still enforce them. Superseded scores cannot satisfy sealing.

Feasibility now consumes the reconciled package's explicit working-capital allocation and year-one COGS plus operating expenses. Coverage division uses the existing financial engine defensive-interval calculation, converted to months. Missing, invalid, zero-cost or unbalanced inputs remain unknown; explicit zero reserve stays zero. Output is labeled planned coverage before debt service, not verified bank cash. No historical cash is manufactured or added twice.

Local verification: typecheck/lint; 76 focused tests covering version pinning, tenant/mismatched evidence, canonical equity fields, retry persistence, score replacement/write failures, unchanged low-score eligibility, reserve completeness and the existing preparation/release gates. The final generation integration fixture also verifies a locked score is present at publication. Full CI remains the merge gate.

No database migration or production data edits. Bank acceptance, borrower artifact-release rules, identity verification and lender submission authorization are unchanged. This repair does not supply the QA application's missing market evidence, correct its $250,000 budget gap, or establish completed production certification. Retest with complete supported inputs after deployment.
