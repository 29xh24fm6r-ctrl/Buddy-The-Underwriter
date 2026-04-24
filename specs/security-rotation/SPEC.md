# SECURITY-ROTATION — P0 Credential Incident

**Date:** 2026-04-24
**Severity:** P0

## Incident

`scripts/audit-db.ts:5` contains a hardcoded Supabase service-role key (prefix `sb_secret_9ty_`, redacted in this spec). Supabase MCP `get_project_url` confirmed the hardcoded URL is the CURRENT production project. Leaked key has service-role privileges — bypasses RLS, full tenant-data access.

Note: this spec intentionally does NOT paste the full leaked key string. GitHub push protection blocks attempts to write the key into new files, which is exactly the right behavior. Claude Code should reference the key from the current `scripts/audit-db.ts` file on HEAD when running local grep/curl verification; it does NOT need to appear in any committed artifact.

**Assume compromised** regardless of repo visibility. Key has been in git history since ~2026-03-07.

## Track A — Matt (NOW)

1. Rotate in Supabase dashboard → Settings → API → Reset service role key
2. Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel prod + preview + Cloud Run workers (`buddy-core-worker`, `franchise-sync-worker`) + GitHub Actions secrets + developer `.env.local`
3. Redeploy Vercel and verify cockpit loads + workers still processing
4. Check Supabase audit logs 2026-03-07 onward for suspicious activity (if plan supports)

## Track B — Claude Code

**B.1 Scan the repo.** Use grep and gitleaks:
```bash
grep -rn "sb_secret_" . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude-dir=.vercel
pnpm dlx gitleaks detect --source . --verbose
git log -p --all -S "sb_secret_" -- 'scripts/**' | head -100
```

Confirmed hit: `scripts/audit-db.ts:5` (URL on line 4 also compromised). STOP and surface if:
- More than one leaked key found
- Zero hits (debug first)
- Key introduced by unexpected commits

**B.2 Scrub `scripts/audit-db.ts`.** Replace the hardcoded url/key declarations at the top of the file with env-var reads + fail-fast:

```ts
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE;

if (!url) { console.error('[audit-db] Missing SUPABASE_URL'); process.exit(1); }
if (!key) { console.error('[audit-db] Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
```

Rest of file unchanged. Body of `auditDatabase()` stays identical.

**B.3 Scrub any additional hits** from B.1. Same pattern. For shell scripts use `${VAR:?error}`.

**B.4 Install gitleaks guard.** Check `.github/workflows/` first — don't duplicate. Add one of:
- Husky: `.husky/pre-commit` → `pnpm dlx gitleaks protect --staged --verbose`
- CI: `.github/workflows/secret-scan.yml` using `gitleaks/gitleaks-action@v2`

**B.5 Delete leftover artifacts from spec-write process:**
- `specs/_test_ping.md`
- `specs/_test_ping2.md`

Both were probes Claude created verifying MCP upload capability. Neither should persist.

**B.6 Re-verify `.env.example` and `.gitignore`** are still clean. Verified at spec-write; re-verify after scrub:
- `.env.example` should contain only placeholders
- `.gitignore` should exclude `.env*` except `.env.example`

## Track C — Matt verification (after A and B)

**C.1** Confirm OLD key is dead. Use the current `scripts/audit-db.ts:5` value before B.2 scrubs it (i.e., copy from local working tree before the Claude Code scrub commits):
```bash
OLD_KEY="<paste the old key from current scripts/audit-db.ts>"
curl "https://sglhiuizgugbnzkymwnk.supabase.co/rest/v1/deals?select=id&limit=1" \
  -H "apikey: $OLD_KEY" -H "Authorization: Bearer $OLD_KEY"
```
Expected: 401. If 200, rotation didn't invalidate — re-rotate.

**C.2** Confirm new key works: cockpit loads for test deal `e505cd1c-86b4-4d73-88e3-bc71ef342d94`, no 500s in Vercel runtime logs tied to Supabase.

**C.3** Final: `pnpm dlx gitleaks detect --source . --verbose` → zero findings.

## Commit strategy

One commit from Track B:
```
security: rotate Supabase key + scrub hardcoded credential (SECURITY-ROTATION)
```

Body: list every scrubbed file, B.4 guard choice, both `_test_ping*.md` deletions, gitleaks before/after results.

## AAR requirements

Claude Code AAR must include:
- Full B.1 hit list (every file + line)
- Each scrub confirmed
- `tsc --noEmit --skipLibCheck` clean after scrub
- gitleaks output before AND after scrub (both pasted)
- B.4 guard installed + which option
- Both `_test_ping*.md` confirmed deleted

## Out of scope

- **Rotating other providers** (Clerk, Twilio, Resend, Gemini, etc.) even if B.1 finds them. Each additional leaked key means Matt has another rotation; escalate to a separate SECURITY-INCIDENT spec.
- **Git history rewrite (BFG, filter-branch).** Rewrite is invasive (breaks clones, CI caches, contributor workflow). Rotation is sufficient defense IF key is genuinely invalidated. Only rewrite if legal or compliance requires.
- **Supabase RLS audit.** Hygiene backlog item — run `get_advisors type=security` separately.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Old key exploited during window | Unknown — low-to-medium | Rotate fast, audit logs, monitor queries 24h after |
| Second leaked key exists | Medium | Stop-and-surface before scrubbing |
| Stale key in git history was already rotated | Medium | Still scrub committed string. Verify via curl against the stale key |
| New key leaks again in future | Low | B.4 gitleaks guard is the structural fix |
| Vercel env propagation lag | Low | <30s cold-start; low impact |

## Hand-off

Execute Track B in parallel with Matt's Track A. Ship to main ASAP. No PR review cycle — P0 incident response.

Estimated Track B runtime: 45–90 minutes.
