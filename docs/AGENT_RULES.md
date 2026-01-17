# Buddy Agent Rules (Copilot/Codex)

## Allowed
- Create a new branch per task (feat/*, fix/*, chore/*)
- Make code changes
- Run: pnpm -s lint, pnpm -s exec tsc -p tsconfig.json --noEmit --pretty false --incremental false, pnpm -s build
- Open a PR with summary + test plan + rollback

## Forbidden
- Pushing to main
- Merging PRs
- Changing auth/access, RLS, or tenant boundaries unless explicitly requested
- Exposing demo/sandbox publicly (invite-only only)
- Adding analytics that capture PII without approval

## PR Must Include
- What changed + why
- Commands run + results
- Screenshots for UI changes
- Manual test steps
