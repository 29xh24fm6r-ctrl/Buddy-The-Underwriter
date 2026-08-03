# M8.3 — Pre-flight Template

Run this checklist before touching any borrower-screens code.

## Pre-flight checklist

```bash
# 1. Confirm repo and branch
git remote -v
git branch --show-current
# Expected: claude/borrower-screens-rebuild-79zayf

# 2. Fetch latest
git fetch origin claude/borrower-screens-rebuild-79zayf

# 3. Size checks — file sizes must match before editing
wc -c src/components/borrower/intake/ApprovalScoreCard.tsx
wc -c src/app/\(borrower\)/start/StartConciergeClient.tsx
wc -c src/components/borrower/PortalClient.tsx
wc -c src/components/brokerage/BrokerageStageStrip.tsx
# If any size differs from the values recorded at spec time, STOP and
# report before touching anything. Do not construct an explanation.

# 4. Verify existing tests still pass
npx tsx --test src/components/borrower/__tests__/verificationTruth.test.tsx
npx tsx --test src/lib/score/eligibility/__tests__/v-m2-bridge.test.ts
npx tsx --test src/components/borrower/__tests__/pulseBoundaryGuard.test.ts

# 5. Type check
npx tsc --noEmit

# 6. Check PR body enumerates all M-findings being addressed
# Every PR touching this branch must list which M-number findings
# it addresses and reference the spec:
# specs/borrower-screens/SPEC-BORROWER-INTEGRITY-MASTER.md
```

## Size check values (recorded 2026-08-03)

Run `wc -c` and compare. If values differ, someone else edited the file —
re-read it before proceeding.

| File | Bytes (at `88c27a17`) |
|------|-------|
| ApprovalScoreCard.tsx | 5,150 |
| StartConciergeClient.tsx | 9,941 |
| PortalClient.tsx | 72,788 |
| BrokerageStageStrip.tsx | 12,276 |

If sizes differ after a clean fetch of the branch HEAD, another session
edited the file — re-read and investigate before proceeding.

## Post-flight

After making changes:

1. Run the full test suite from step 4 above
2. Run `npx tsc --noEmit`
3. Commit with descriptive message referencing M-numbers
4. Push to the branch
5. Update the tracker in SPEC-BORROWER-INTEGRITY-MASTER.md
