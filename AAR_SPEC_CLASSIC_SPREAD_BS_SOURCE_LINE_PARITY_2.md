# AAR — SPEC-CLASSIC-SPREAD-BS-SOURCE-LINE-PARITY-2

**Date:** 2026-06-16
**Scope:** Balance-sheet source-line parity for the Classic Spread. Income-statement behaviour
(shipped in `b8dd4e34`), route count, schema, PDF/memo rendering, and the canonical VM reconcile
path are all unchanged.

## Problem

Three OmniCare balance-sheet rows rendered the wrong number because a fact was *classified* under the
wrong canonical key during extraction — not because the dollar amount was wrong. Fixing them by
numeric heuristics would be fragile and could corrupt other deals, so each fix is **scoped to the
fact's provenance / source line**: we only re-classify when the source text proves the correct line.

| # | Symptom (OmniCare) | Root cause | Fix |
|---|---|---|---|
| 1 | 2023 Other Current Liabilities (10,669) excluded from current liabilities | Schedule L "Other **current** liabilities" (Statement 2) lands under `SL_OTHER_LIABILITIES`, which the resolver treats as **non**-current | Remap to `SL_OPERATING_CURRENT_LIABILITIES` **only** when the source line says "other current liabilities" / line 18 (and not long-term / line 20–21) |
| 2 | 2024 Inventory / Other Current Assets / Loans-to-Shareholders rendered as $4 / $6 / $10 | OCR read a **line number** as the value; provenance snippet is `"line 3, 6"`, `"line 6 from line 4"`, `"Line 10: 10"` | Suppress the fact **only** when the provenance matches the stub signature **and** a stronger same-period sourced fact contradicts it |
| 3 | 2026 interim AR (3,097,345) rendered as Total Current Assets | An "Accounts receivable" line was mapped to `SL_TOTAL_CURRENT_ASSETS` | Remap to `SL_AR_GROSS` **only** when the source line says accounts receivable; `TOTAL_CURRENT_ASSETS` is kept only when the source line actually says total current assets; if both lines exist, both are preserved |

## Why provenance-scoped (not numeric)

- A small value, an "other liabilities" balance, or a value sitting under a totals key are all
  **legitimate** on most returns. The defect is specific to *how the line was read*, which only the
  provenance/source-line snippet reveals. Triggering on magnitude alone would suppress real data and
  mis-reclassify other deals.
- The rules **fail closed**: with no/ambiguous provenance, nothing is changed (existing behaviour is
  preserved), so deals without these exact source-line signatures render exactly as before.

## Implementation

- **`src/lib/classicSpread/audit/balanceSheetSourceLineResolver.ts`** — pure
  `resolveBalanceSheetSourceLines(facts)` → `{ facts, audit }`. Re-keys / suppresses an **in-memory
  copy** of the facts (never mutates or deletes the underlying facts, never globally lowers OCR rank,
  never touches `reconcileFinancialFacts`). Each correction emits a `BalanceSheetSourceLineAudit`
  entry: `{ periodEnd, originalKey, resolvedKey | null, value, sourceLine, code, severity, reason }`.
- **`src/lib/classicSpread/classicSpreadLoader.ts`** — runs the resolver on the business facts right
  before `buildPeriodMaps` (the single path that builds the balance-sheet rows). `provenance` was
  added to the existing fact `select` (no schema change). Corrections are `console.info`-logged; no
  render/route/memo surface changed.

## Verification

- New `src/lib/classicSpread/__tests__/balanceSheetSourceLineParity.test.ts` — fixture-first, with
  OmniCare-shaped facts carrying provenance snippets; includes negative cases (no remap without the
  source line; no suppression without the stub signature or without a stronger contradicting fact;
  both lines preserved when both exist).
- `pnpm test:unit` 8352 pass / 0 fail · `pnpm build` exit 0 · `pnpm check:routes` exit 0, count 908
  (unchanged). Income-statement parity tests still pass.

## Deviations

None. All acceptance criteria met; no schema/route/PDF/memo changes.
