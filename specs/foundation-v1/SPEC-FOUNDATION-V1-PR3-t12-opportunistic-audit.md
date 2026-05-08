# SPEC-FOUNDATION-V1 PR3 — T12 Opportunistic Audit

**Status:** Ready for Claude Code (audit-driven scope)
**Owner:** Matt (credit-officer judgment) → Claude Code (audit + remediation)
**Branch:** opens against `feat/foundation-v1-pr3-t12-opportunistic`
**Depends on:** SPEC-FOUNDATION-V1 parent committed
**Blocks:** Conceptual cleanup; doesn't unblock any specific gate but eliminates a class of structural assumptions

## Problem in one paragraph

T12 (trailing twelve months) statements are commonly used in commercial real estate underwriting for stabilized properties but are **NOT reliably included** in most SBA or commercial banking packages, especially for small business operating companies. The bulk of Buddy's deal flow consists of business acquisitions and operating-company loans where the borrower provides 3 years of tax returns, K-1s, and a current PFS — but no T12 P&L. **Any code path that requires T12 as a primary input is structurally wrong for our market.** PIV inspection during research found one such path: `computeDscrFromSpreads` in `factsAdapter.ts` falls through to T12 when GLOBAL_CASH_FLOW is absent, which is fine — but the audit needs to verify there are no places where T12 is a HARD REQUIREMENT.

## Solution in one paragraph

Audit the entire codebase for T12 references, classify each as either (a) opportunistic — used when present, harmless when absent or (b) primary — required for some computation to succeed. For any (b) classifications, refactor to either remove the T12 dependency entirely or convert to opportunistic. Document the audit findings in a permanent reference doc at `specs/foundation-v1/T12-USAGE-AUDIT-2026-05.md` so future contributors don't reintroduce T12-as-primary patterns. The audit's scope determines the remediation effort: if zero (b) classifications found, PR3 is just the audit doc + a CI guard preventing regression. If multiple (b) classifications, PR3 expands to surgical refactors per case.

## PIV — pre-implementation verification

### PIV-1. Enumerate all T12 references in the codebase

```bash
grep -rn "T12\|t12\|TTM\|trailing.twelve\|trailingTwelve" \
  src/ --include="*.ts" --include="*.tsx"
```

**Expected:** complete list of every T12 / TTM reference. The audit classifies each.

### PIV-2. Identify spread types where T12 is enumerated

```bash
grep -n "T12\|TTM" src/lib/financialSpreads/types.ts \
  src/lib/financialSpreads/*.ts 2>/dev/null
```

**Expected:** confirms T12 is one of several SpreadType enum values; reveals where T12 spreads are produced/consumed.

### PIV-3. Identify readiness contracts that may require T12

```bash
grep -rn "T12\|TTM" src/lib/creditMemo/submission/ src/lib/creditMemo/inputs/
```

**Expected:** zero hits in the submission gate (per the methodology research, the gate doesn't require T12). If hits found, those are the bugs to fix.

### PIV-4. Identify display surfaces using T12 (acceptable use)

```bash
grep -rn "T12\|TTM\|trailing" \
  src/components/ src/app/ --include="*.tsx"
```

**Expected:** T12 used for narrative / display purposes (e.g., NOI_TTM in the canonical memo for CRE deals). These are fine — they're opportunistic by nature.

### PIV-5. Identify any audit/policy/guard tests that mandate T12

```bash
grep -rn "T12\|TTM" src/**/__tests__/
```

**Expected:** any tests that assert T12 must be present are structurally wrong; flag for remediation.

## Scope

### In scope (PR3)

#### A-1. Audit document at `specs/foundation-v1/T12-USAGE-AUDIT-2026-05.md`

Format: a table with one row per T12 reference, columns:
- File path
- Line number
- Code context (one-liner)
- Classification: `OPPORTUNISTIC` | `PRIMARY-REQUIRED` | `DISPLAY-ONLY` | `TYPE-DEFINITION`
- Remediation: `keep-as-is` | `convert-to-opportunistic` | `remove-entirely`

The audit doc is the durable artifact. Future contributors reading this doc understand WHY T12 has the role it has in the codebase.

#### A-2. Remediation per (b) classification (if any)

For each `PRIMARY-REQUIRED` classification:
- Refactor the consuming code to handle absence-of-T12 gracefully (return null, fall back to other spread types, surface as warning not blocker)
- Add a unit test asserting the code path works without T12 input
- Add a CI guard (source-level) preventing reintroduction of the T12-required pattern

Expected remediation effort:
- 0 primary-required findings → PR3 is just A-1 + A-3
- 1-3 primary-required findings → PR3 includes surgical refactors per case
- 4+ primary-required findings → escalate scope to PR3a/PR3b/etc., file as separate sub-spec

#### A-3. CI guard preventing regression

Create `src/lib/financialSpreads/__tests__/t12OpportunisticGuard.test.ts`:

Source-level guard reading the audit doc and the spread type module:

- Asserts the audit doc exists and references all current T12 occurrences
- Asserts no test in `src/**/__tests__/` contains the assertion `assert(spread.T12 !== null)` or equivalent — T12 must not be required
- Walks the codebase and asserts no new files have been added that reference T12 without classification in the audit doc

The guard is a "list of approved T12 references" pattern, similar to the SPEC-13.5 PR-C legacy-overrides allowlist guard.

### Out of scope (explicit)

- Removing T12 spreads entirely. They're useful for CRE deals; they should remain available, just opportunistic.
- T12 narrative display in the canonical memo (NOI_TTM, TOTAL_INCOME_TTM, OPEX_TTM are valid optional display fields per the canonical fact registry).
- Adding NEW spread types. The audit only covers existing T12 usage.

## V-N verification checklist

- V-1. ☐ All 5 PIV outputs pasted into AAR.
- V-2. ☐ A-1: Audit doc committed with full T12 reference table.
- V-3. ☐ A-2: All `PRIMARY-REQUIRED` classifications remediated (or zero such classifications found, documented as such).
- V-4. ☐ A-3: CI guard tests passing.
- V-5. ☐ tsc clean.
- V-6. ☐ pnpm test:unit shows expected new test count, all green.

## Files affected

Variable based on audit findings. At minimum:

| Path | Change | Risk |
|------|--------|------|
| `specs/foundation-v1/T12-USAGE-AUDIT-2026-05.md` | New | None |
| `src/lib/financialSpreads/__tests__/t12OpportunisticGuard.test.ts` | New | Low |

Plus surgical changes per audit findings.

## Risk register

1. **Audit misclassifies a reference.** Mitigated by reviewing audit doc with founder before remediation. The doc is the durable artifact; remediation only proceeds after sign-off.
2. **CRE-specific deals legitimately need T12.** Confirmed via methodology research — for stabilized CRE, T12 is the primary cash flow input. The opportunistic-when-absent rule applies to operating companies; for CRE, T12 is part of the document checklist. Distinction handled per-deal-type, not codebase-wide.

## Hand-off commit message

```
chore(foundation): T12 opportunistic audit (SPEC-FOUNDATION-V1 PR3)

T12 (trailing 12) statements aren't reliably included in commercial
or SBA banking packages. Audit identifies every T12 reference in the
codebase, classifies each as opportunistic / primary-required /
display-only / type-definition, and remediates any primary-required
findings.

Audit doc at specs/foundation-v1/T12-USAGE-AUDIT-2026-05.md is the
durable artifact. CI guard at t12OpportunisticGuard.test.ts prevents
regression.
```
