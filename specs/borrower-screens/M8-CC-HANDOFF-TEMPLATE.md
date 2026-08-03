# M8.2 — CC Handoff Template

Use this template when handing a borrower-screens finding to a new CC session.

## Template

```
## Finding: [M-number] — [one-line description]

### Context
- Branch: claude/borrower-screens-rebuild-79zayf
- Spec: specs/borrower-screens/SPEC-BORROWER-INTEGRITY-MASTER.md
- Prior commits: [list relevant commits]

### What to verify
[Describe the specific rendering behavior or logic to check]

### Verification query
[SQL or test command that demonstrates the state]

### Provenance
- Raised by: [session ID or agent that found it]
- Verified by: [different session/agent — a finding may NOT be closed
  by the same agent that raised it without an independent check]

### Constraints
- No changes to canSeal/sealingGate.ts
- No IntakeReviewStep changes
- No scoring weights/bands/thresholds
- No progress_pct writes
- No new routes
- tsc is NOT verification — must demonstrate by rendering/mounting
```

## Worked example

```
## Finding: M1 — deriveVerifications inverts gate-string absence

### Context
- Branch: claude/borrower-screens-rebuild-79zayf
- Spec: specs/borrower-screens/SPEC-BORROWER-INTEGRITY-MASTER.md
- Prior commits: 7b9230bc (fix), b3eec8a5 (V-M1b test)

### What to verify
With 0 identity verifications and 0 ownership entities in production,
IntakeReviewStep must render "Not started" for Business verification
and Ownership — not "Entity matched" / "Identity verified".

### Verification query
npx tsx --test src/components/borrower/__tests__/verificationTruth.test.tsx

Production state check:
SELECT count(*) FROM borrower_identity_verifications;
-- Expected: 0

### Provenance
- Raised by: session_01Q4Se7mr4UctQ8Ly9PPo83N (V1/D-0)
- Verified by: session_01Q4Se7mr4UctQ8Ly9PPo83N (V-M1b — independent
  test exercises pure function, not tsc)

### Constraints
[as above]
```

## Provenance rule

A finding may NOT be closed by the same agent that raised it without
an independent check. "Independent" means:

1. A different session/agent verifies, OR
2. The same session writes a test that exercises the rendering logic
   (not just type-checks), and the test passes independently of the
   fix commit (i.e., fails on the pre-fix code, passes on the post-fix code).

Option 2 was used for V-M1b, V-M2, and V-M3 in this branch.
