# Examiner Defensibility Notes

> SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 27

Why the finengine stack is defensible to a regulator / loan reviewer.

## Every number has provenance

- Metrics compute through one registry (`METRIC_REGISTRY`) via a single
  evaluator; there is no second formula source (registry audit proves it).
- Statement quality (PR 3) classifies basis + assurance + staleness and
  conditions **confidence**, never the value.
- The certified writer (PR 24) stamps `source_type: FINENGINE_CERTIFIED`,
  `source_ref: finengine:certified:<product>`, and a supersession policy that
  never overwrites legacy facts.

## Every conclusion has evidence

- The evidence engine (PR 14) attaches supporting / contradicting / missing
  evidence with doc/page anchors and a bounded confidence to any conclusion.
- The credit-officer brain (PR 15) and examiner engine (PR 12) cite the
  supporting metric for every concern / criticism — no evidence-free findings.
- The memo contract (PR 22) consumes only certified analytical objects;
  `validateMemoCertified` proves no prose-derived conclusion enters the memo.

## Collateral & borrowing base are explainable

- The AR/ABL engine (PR 8) attributes **every excluded dollar** to a first-hit
  reason (over-90, cross-aged, concentration, contra, …) and produces an
  auditable ineligible-collateral schedule.

## SBA determinations are honest

- The SBA engine (PR 11) never claims approval; it lists blockers, required
  documents, and unresolved determinations with SOP citations.

## Change is controlled and reversible

- No cutover flag defaults true; the reconciliation matrix classifies every
  divergence; unexpected divergences block cutover; rollback is a flag change.
- The burn-down ledger keeps every legacy producer alive until reconciliation is
  clean and a human approves deletion.
