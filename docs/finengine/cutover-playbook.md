# Finengine Cutover Playbook

> SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 27

Cutover is **per-product, gated, and reversible**. Nothing flips by default.

## Preconditions (all required to enable a product on finengine)

1. **Shadow reconciliation clean.** Run the metric reconciliation matrix (PR 18)
   for the product's deals. Every canonical metric must be `zero`, `intended`, or
   `quality_adjusted` — **no `unexpected`**. Any `unexpected` divergence must be
   classified in the intentional-divergence registry (as `legacy_bug`,
   `finengine_bug`, `data_quality`, or `intended`) and resolved before proceeding.
2. **Cutover flag on.** Set the product's flag in `ProductCutoverFlagMap`
   (PR 21). Default is false.
3. **Fail-safe verified.** `resolveProductCutover` returns `finengine` only when
   the flag is on AND reconciliation is clean. A blocked reconciliation with the
   flag on returns `legacy` — confirm this in a dry run.

## Step-by-step (first candidate: C&I term DSCR, PR 25)

1. Compute legacy and finengine DSCR for the target deals.
2. Feed both into `cutoverCiTermDscr`. Confirm `reconciliation.reason ===
   "dscr_match"` (or a registered `intended_divergence`).
3. Enable `CI_TERM` in the product flag map for a **test/local** scope only.
4. Confirm `path === "finengine"` for reconciled deals and `legacy` for any
   deal with an unresolved gap.
5. Leave **production default legacy** until an operator explicitly approves the
   production flag flip.

## Certified writes (optional, PR 24)

The certified-fact writer is disabled by default. To enable, ALL must hold:
`FINENGINE_CERTIFICATION_WRITER_ENABLED=true`, the product cutover allowed,
reconciliation clean, and a real writer injected by the caller. Missing any → no
write. Writes carry `source_ref: finengine:certified:<product>` and supersede
only prior finengine certs — never legacy facts.

## GCF circular writer (PR 19)

The rendered-spread→facts circular writer is enabled by default (no change).
To quarantine it once finengine GCF is reconciled, set
`GCF_CIRCULAR_WRITER_DISABLED=true`; `planGcfFactWrites` then writes nothing.
