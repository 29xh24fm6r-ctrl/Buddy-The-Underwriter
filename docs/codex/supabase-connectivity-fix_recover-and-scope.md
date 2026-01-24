# Supabase Connectivity Fix — Recovery + Scoped Null-Safety (Codex Agent Spec)

## Context
A bad commit landed on `main` with message:
"Finalize null-safe Next params/navigation hooks"
It shows massive unintended changes:
- ~233 files changed
- ~12,614 deletions
- Many `supabase/migrations/*` replaced with placeholder files
- A `.bak` file was added
This is catastrophic and MUST be reverted.

## Goals
1) Restore repo state before the bad commit (no placeholder migrations, no deleted migrations).
2) Re-apply ONLY the intended TypeScript null-safety fixes:
   - `src/components/admin/AdminBankPicker.tsx` (useSearchParams/usePathname null-safe)
   - `src/components/deals/DealModals.tsx` (nullable search params → URLSearchParams)
   - `src/hooks/useDealCommand.ts` (nullable search params → URLSearchParams)
   - (Optional) any small route ctx.params typing fixes already made under `src/app/api/_buddy/...` if they exist and are correct.
3) Ensure `pnpm -s typecheck` passes.
4) Ensure `git status --porcelain` is clean after commit.
5) Ensure no `.bak` files are tracked, and no `supabase/migrations/*placeholder*` commits are introduced.

## Hard Guardrails (MUST FOLLOW)
- DO NOT modify `supabase/migrations/` except to restore the exact previous state from git history.
- DO NOT introduce placeholder migrations.
- DO NOT commit any `.bak` files.
- DO NOT run `git add -A` in the final commit. Stage only the intended TS files.
- If any rollback is needed, use git history not ad-hoc deletion.

## Required Steps (Agent must execute)
A) Identify the bad commit hash:
- Locate the commit with message: "Finalize null-safe Next params/navigation hooks"
- Confirm its diff includes placeholder migrations and `.bak` file.

B) Revert/Reset Strategy
- Preferred: `git reset --hard HEAD~1` if the bad commit is the latest and not pushed.
- If it was pushed or cannot reset: use `git revert <hash>` and ensure the revert truly restores migrations.

C) Verify repo restored
- `git status --porcelain` must show clean or only the intended TS edits.
- `ls -la supabase/migrations | head` should show real migrations, not placeholders.
- `rg -n "placeholder" supabase/migrations` should NOT show placeholder migration files (unless they were legitimately in history).

D) Re-apply intended fixes (minimal diffs)
1. AdminBankPicker.tsx
- useSearchParams may be null:
  - initialBankId should handle null safely
  - constructing URLSearchParams should handle null safely
- usePathname may be null:
  - router.replace must receive string always (safePathname)

2. DealModals.tsx
- parseDealUiState should always receive URLSearchParams
- building URLSearchParams must tolerate nullable params

3. useDealCommand.ts
- new URLSearchParams(params.toString()) must tolerate nullable params

E) Checks
- Run: `pnpm -s typecheck`
- No TS errors.

F) Final Commit
- Stage ONLY these files:
  - src/components/admin/AdminBankPicker.tsx
  - src/components/deals/DealModals.tsx
  - src/hooks/useDealCommand.ts
  - (and only if needed) the corrected route file under src/app/api/_buddy/runs/[runId]/summary/route.ts
- Commit message: "Null-safe Next navigation params (scoped)"

## Deliverables
- One clean commit containing only the intended fixes.
- Confirmation output:
  - `git log -n 3 --oneline`
  - `git show --stat HEAD`
  - `pnpm -s typecheck` success
