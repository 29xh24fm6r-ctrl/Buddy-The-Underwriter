# Spec CI-RESTORE — Clear Pre-Existing TypeScript Compile Errors

**Date:** 2026-04-24
**Owner:** Matt
**Executor:** Claude Code
**Estimated effort:** 45–75 minutes
**Risk:** Very low. Surface-level TS type fixes. No runtime behavior change.

---

## TL;DR

Main CI has been red since 2026-04-15 due to 5 pre-existing TypeScript compile errors that have accumulated in the repo. None affect runtime behavior (production has been deploying fine), but the red CI means "tests pass locally + tsc clean" is no longer a meaningful signal for Claude Code specs. This hides real regressions.

**Errors flagged by recent AARs:**
- 1× `Buffer<ArrayBufferLike>` in `src/app/api/credit-memo/canonical/pdf/route.ts:696` (from commit `536f7bf5`, 2026-04-15)
- 4× `dotenv` import errors in `scripts/` (from 2026-04-20)

This spec asks Claude Code to diagnose each error precisely, apply minimal fixes, and restore `tsc --noEmit --skipLibCheck` to clean.

---

## Pre-implementation verification (MANDATORY)

### PIV-0 — Confirm errors still exist on current HEAD

```bash
# From repo root
npx tsc --noEmit --skipLibCheck 2>&1 | tee /tmp/tsc-errors.txt
cat /tmp/tsc-errors.txt | grep -E "error TS" | wc -l
cat /tmp/tsc-errors.txt | grep -E "error TS" | head -20
```

**Expected:** 5 errors (1 Buffer + 4 dotenv). If the count differs significantly:
- **More errors:** a new regression has landed since 2026-04-20. Capture the full list and STOP. Surface the expanded scope to Matt before proceeding — the spec may need re-scoping.
- **Fewer errors (e.g., 0):** someone silently fixed them. Confirm by running `git log --oneline --all` near the suspected file paths. If genuinely fixed, STOP and surface — this spec is obsolete.
- **Different errors:** the AAR description drifted from reality. Capture the real errors and surface before fixing.

### PIV-1 — Classify each error by remediation approach

For each error from PIV-0, record:
- Full file path and line number
- The specific TS error code (TS2322, TS2345, TS7016, etc.)
- The error message text
- Whether it's a type annotation issue, a missing type declaration, an import path issue, or a lib compatibility issue

Paste the classification summary into the commit message body when you ship. This gives us an artifact of what was actually broken without re-reading the diff.

### PIV-2 — Confirm the Buffer error is the one at line 696

```bash
grep -n "Buffer" src/app/api/credit-memo/canonical/pdf/route.ts | head -20
```

Line numbers may have shifted since the error was originally reported. Find the actual offending line by matching against the tsc output from PIV-0.

### PIV-3 — Find the 4 dotenv import sites

```bash
grep -rn "from ['\"]dotenv['\"]" scripts/ --include="*.ts"
grep -rn "require.*dotenv" scripts/ --include="*.ts"
```

There should be 4 matches. Each one is a candidate error site. Cross-reference with PIV-0's tsc output to confirm which are failing.

---

## The fix

### Error 1 — Buffer<ArrayBufferLike>

**Likely cause:** Node 22's `@types/node` narrowed `Buffer` to a generic `Buffer<ArrayBufferLike>` type. Code that used to accept a plain `Buffer` now needs either an updated signature, an explicit type annotation, or a `Buffer.from(...)` conversion.

**Diagnostic:** Look at line 696 (or whichever line PIV-2 confirms). The error is almost certainly one of:
- A `Buffer` being passed where a `Uint8Array` or `ArrayBuffer` is expected
- A type signature that was hardcoded to `Buffer` but is now receiving `Buffer<ArrayBufferLike>`
- A `Buffer` being used where the new generic narrowing breaks inference

**Fix approach:** Minimal-diff. Prefer:
1. Widen the consumer's type (e.g., `Uint8Array` instead of `Buffer`) when possible
2. Explicit `new Uint8Array(buf)` conversion when the consumer needs a non-Buffer view
3. Explicit `Buffer.from(buf)` when downstream needs a Buffer
4. LAST RESORT: `as unknown as Buffer` cast with a comment explaining why

**DO NOT:** add `// @ts-ignore` or `// @ts-expect-error`. These hide the error without fixing it.

**DO NOT:** upgrade or downgrade `@types/node`. The version is pinned for a reason; changing it may cascade into 50 other type breakages.

### Errors 2–5 — dotenv imports in scripts/

**Likely cause:** One of:
- `dotenv` is not in `package.json` dependencies or devDependencies
- `dotenv` is there but `@types/dotenv` is missing
- The import style is wrong (default vs namespace, ESM vs CJS)

**Diagnostic:** Check `package.json` first:

```bash
cat package.json | jq '.dependencies + .devDependencies | keys | .[] | select(contains("dotenv"))'
```

**Fix approach:**
- If `dotenv` is missing, `npm install --save-dev dotenv` (scripts are dev-only)
- If `@types/dotenv` is missing (not always needed — modern dotenv ships its own types), add it
- If the import style is wrong, align it with the tsconfig's `module` setting. For `module: "esnext"` or `nodenext`, use `import "dotenv/config"` or `import dotenv from "dotenv"`. For `module: "commonjs"`, `require("dotenv").config()`.

**One-shot option if all 4 errors are identical:** a single `npm install` may clear all 4 at once. Don't over-engineer.

### Verification

After fix:

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "error TS"
# Expected: no output (zero errors)
```

Then run any pre-existing test suite that touches these files:

```bash
npx jest src/app/api/credit-memo/canonical/pdf
```

(The route.ts has tests nearby. Running them catches regressions introduced by the Buffer fix.)

## Tests

No new tests required — this spec fixes existing broken code, it doesn't add behavior. But:

- If the Buffer fix requires a non-trivial code change (not just a type annotation), add 1 smoke test that exercises the PDF-generation path
- If the dotenv fix changes import style in any script that's actually invoked by CI (not just manually), run that script once and confirm it works

Otherwise, ship clean with no test additions.

---

## Commit strategy

**One commit** is fine if all 5 errors have aligned fixes (e.g., dotenv is one `npm install` change, Buffer is one line). 

**Two commits** if the Buffer fix is materially different from the dotenv fix, to keep the diff reviewable:
1. `fix(ci): widen Buffer type in credit-memo/canonical/pdf route (CI-RESTORE)`
2. `fix(ci): add dotenv dependency to restore scripts/*.ts compilation (CI-RESTORE)`

Either way, commit message body should list:
- Exact file:line for each error fixed
- The TS error code each one matched
- Confirmation that `tsc --noEmit --skipLibCheck` is now clean

---

## Out of scope

- **Hardcoded secrets in `scripts/audit-db.ts`.** I noticed a Supabase URL + key hardcoded on lines 4-5. That's a separate security finding — mention it in AAR but don't fix in this commit.
- **Broader TS strict-mode improvements.** If tsc reveals other non-error warnings, leave them. This spec closes out the errors, not lints.
- **Vercel CI config changes.** Don't touch `vercel.json`, `vercel.ts`, `package.json` scripts beyond adding missing deps. The build pipeline itself is fine; only the source needs to compile clean.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| PIV-0 reveals more than 5 errors | Medium | Stop-and-surface. Over-scoping this spec is how we accidentally re-introduce bugs while trying to fix CI |
| Buffer fix breaks the PDF route at runtime | Low | The surrounding code has obvious usage patterns. Run the route once manually if in doubt |
| `npm install dotenv` conflicts with an existing version | Very low | package.json is version-pinned; if there's a conflict it'll surface immediately |
| Someone else is already fixing this in a draft PR | Low | Check `gh pr list` before writing code |

## Outcomes table

| Outcome | What it looks like | Action |
|---|---|---|
| **A. Full success** | `tsc --noEmit --skipLibCheck` clean, commit lands on main | Done. Claude to verify via GitHub API. Update queue |
| **B. More than 5 errors found** | PIV-0 returns 6+ | STOP. Paste full list to Matt. Re-scope spec |
| **C. Buffer error is more entangled** | Fix requires changing 3+ call sites | Keep the diff bounded to the direct error; add TODO for the call-site cleanup |
| **D. dotenv fix breaks a running script** | Adding dep changes an `import` behavior somewhere | Revert, use narrower scoped fix per file |

## Hand-off

Execute PIV-0 → PIV-3 first. Only after all PIVs are documented, make code changes. Single commit (or two if the nature of the fixes warrants it). Verify with `tsc --noEmit --skipLibCheck` clean.

Lands on current main HEAD (`cfdda81b` per latest AAR).
