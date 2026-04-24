# SECURITY-ROTATION — P0 Credential Incident (Revised: Scan-First)

**Date:** 2026-04-24 (rev 2)
**Severity:** P0
**Key discipline change from rev 1:** Scan the entire repo FIRST. Establish full scope. Then rotate with a precise consumer list. Do NOT start rotation while scan is incomplete — rotating one key while another copy is still valid creates whack-a-mole breakage.

---

## Incident

`scripts/audit-db.ts:5` contains a hardcoded Supabase service-role key (prefix `sb_secret_9ty_`, redacted). Supabase MCP confirmed the hardcoded URL is the CURRENT production project. Key has service-role privileges — bypasses RLS, full tenant-data access.

**Assume compromised** regardless of repo visibility. Key has been in git history since ~2026-03-07.

**Important:** this spec intentionally does NOT paste the full leaked key string. GitHub push protection blocks attempts to write the key into new files (confirmed during spec-write). Claude Code should reference the key from the current `scripts/audit-db.ts` file on HEAD when running local grep/curl verification; it does NOT need to appear in any committed artifact.

---

## Execution order (MANDATORY)

1. **Track B.1** (scan) — Claude Code establishes full scope
2. **Stop point** — surface complete scope to Matt
3. **Matt reviews the scope** — decides rotation order + confirms consumer list
4. **Track A** (rotate) — Matt rotates keys based on confirmed scope
5. **Track B.2–B.6** (scrub + guard) — Claude Code scrubs AFTER rotation confirmed
6. **Track C** (verify) — Matt confirms old keys dead, new keys work, final gitleaks

Do not execute A in parallel with B.1. Do not scrub B.2 before rotation completes. One consequence of scrubbing before rotation: if the scrub commit goes to main before the new key is in Vercel env, any consumer pulling main immediately breaks.

---

## Already-verified clean files (DO NOT re-check; focus scan elsewhere)

Claude pre-checked these files via GitHub MCP during spec-write and confirmed they use env vars (no hardcoded credentials):

- `src/lib/supabase/admin.ts` (main app admin client)
- `services/buddy-core-worker/src/index.ts`
- `services/franchise-sync-worker/src/db.ts`
- `services/franchise-sync-worker/src/**` (all other files in this dir use the above `db.ts`)
- `scripts/intake-worker.ts`
- `scripts/checkOverrideThreshold.ts`
- `scripts/generateGoldenFromOverrides.ts`
- `scripts/phase-84-t02-gemini-probe.ts`
- `scripts/phase-84-t02-reclassify-failed-batch.ts`
- `scripts/t85-probe1-canary.ts`
- `scripts/test-gemini-ocr.ts`
- `.env.example` (placeholders only)
- `.gitignore` (excludes `.env*` except `.env.example`)

---

## Track B.1 — Full scan (DO FIRST, STOP BEFORE B.2)

### Step 1 — Primary pattern (specific leaked key)

```bash
grep -rn "sb_secret_" . \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=.git \
  --exclude-dir=dist \
  --exclude-dir=build \
  --exclude-dir=.vercel \
  --exclude-dir=cache \
  --exclude-dir=.db_audit
```

Expected hit: `scripts/audit-db.ts:5`. Any others = scope expansion.

### Step 2 — Broader credential patterns

```bash
# Legacy JWT-shaped Supabase keys (old format before sb_secret_)
grep -rnE "eyJ[A-Za-z0-9_-]{80,}" . \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=.git \
  --exclude-dir=dist \
  --exclude-dir=build \
  --exclude-dir=.vercel \
  --exclude-dir=cache \
  --exclude-dir=.db_audit 2>/dev/null

# Hardcoded assignments to SUPABASE_SERVICE_ROLE_KEY / similar
grep -rnE "SUPABASE_SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*['\"]" . \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git 2>/dev/null

# Any Supabase project URL hardcoded (the production project id in the leaked file is `sglhiuizgugbnzkymwnk`)
grep -rn "sglhiuizgugbnzkymwnk" . \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git 2>/dev/null

# Common other provider keys that may have been copy-pasted alongside
grep -rnE "sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,}|SG\\.[A-Za-z0-9_-]{20,}|re_[A-Za-z0-9_]{20,}" . \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git 2>/dev/null | head -50
```

### Step 3 — Gitleaks (full repo + history)

```bash
pnpm dlx gitleaks detect --source . --verbose 2>&1 | tee /tmp/gitleaks-head.txt
pnpm dlx gitleaks detect --source . --log-opts="--all" --verbose 2>&1 | tee /tmp/gitleaks-all.txt
```

Capture both outputs. The first scans working tree; the second scans full git history.

### Step 4 — Git history blame for the known leaked file

```bash
# Who introduced the hardcoded key?
git log --all --format="%h %ai %an %s" -- scripts/audit-db.ts
git blame scripts/audit-db.ts | head -20
```

If the commit author is unexpected (not Matt, not a known collaborator), escalate — could indicate compromised account.

### Step 5 — Summarize scope

Compile a report and STOP. Do not proceed to B.2. Format:

```
SECURITY-ROTATION SCAN REPORT

Supabase service-role key hits:
  [list: file:line]

Other credential-shaped strings found:
  [list: file:line + brief tag "Gemini API key"/"Resend token"/etc]

Git history reveal:
  - scripts/audit-db.ts hardcoded key introduced: [commit + author + date]
  - Any other historical credential commits: [list]

Gitleaks head scan:
  [hits or "clean"]

Gitleaks full-history scan:
  [hits or "clean"]

Recommended rotation scope for Matt:
  - [provider/key]: rotate / scrub / leave
```

Then wait for Matt's go-ahead before Track B.2.

---

## Track A — Matt (after B.1 scope confirmed)

The exact steps depend on what B.1 finds. Assuming ONLY the Supabase service-role key is affected (best case):

### A.1 — Map every consumer of `SUPABASE_SERVICE_ROLE_KEY`

Before rotating, list all known consumers so rotation → env update → redeploy happen in the right order. From what's known:

- Vercel production (`SUPABASE_SERVICE_ROLE_KEY`)
- Vercel preview (`SUPABASE_SERVICE_ROLE_KEY`)
- Cloud Run `buddy-core-worker` — currently uses `BUDDY_DB_URL` (direct pg), may or may not also have the key; check Cloud Run env vars
- Cloud Run `franchise-sync-worker` — same (`BUDDY_DB_URL`-based)
- Developer `.env.local` files (everyone who has cloned the repo)
- GitHub Actions secrets (only if CI uses it — check `.github/workflows/`)
- Supabase CLI local config (if used)

Note: the Cloud Run workers use `BUDDY_DB_URL` for direct Postgres access, not the REST API service-role key. That Postgres connection string includes a separate password that was NOT in the leaked file. Check Cloud Run env vars to confirm — if the workers don't use `SUPABASE_SERVICE_ROLE_KEY`, they don't need updating.

### A.2 — Rotate

1. Supabase dashboard → project `sglhiuizgugbnzkymwnk` → Settings → API
2. Reset service role key. Old key must be invalidated, not hidden.
3. Copy new key to password manager immediately.

### A.3 — Update env vars in ALL consumers from A.1

Update each in sequence. Do NOT trigger redeploys until all consumers have the new key.

### A.4 — Trigger redeploys

- Vercel production (via dashboard "Redeploy" or a no-op commit)
- Vercel preview (if applicable)
- Cloud Run workers (only if they consume the key — per A.1 check)

### A.5 — Verify old key dead and new key works BEFORE Claude Code scrubs

```bash
# Should be 401
OLD_KEY="<paste from scripts/audit-db.ts on HEAD>"
curl "https://sglhiuizgugbnzkymwnk.supabase.co/rest/v1/deals?select=id&limit=1" \
  -H "apikey: $OLD_KEY" -H "Authorization: Bearer $OLD_KEY"
```

If 200: re-rotate. Do NOT proceed to B.2.

Then verify cockpit loads + Vercel logs clean. Only then green-light Claude Code for B.2.

### A.6 — Check Supabase audit logs (if plan supports)

Look at `auth`, `api`, and `postgres` logs from 2026-03-07 onward. Unusual patterns to flag: queries from unexpected IPs, large data exports, privilege escalation attempts, access outside business hours.

---

## Track B.2–B.6 — Claude Code scrub (AFTER A.5 green-light)

### B.2 Scrub `scripts/audit-db.ts`

Replace hardcoded url/key with env-var reads + fail-fast:

```ts
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE;

if (!url) { console.error('[audit-db] Missing SUPABASE_URL'); process.exit(1); }
if (!key) { console.error('[audit-db] Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
```

Rest of file unchanged.

### B.3 Scrub any additional hits from B.1

Same pattern for TS/JS. For shell: `${VAR:?error message}` syntax.

### B.4 Install gitleaks guard

Check `.github/workflows/` first — don't duplicate. Add one of:
- Husky: `.husky/pre-commit` → `pnpm dlx gitleaks protect --staged --verbose`
- CI: `.github/workflows/secret-scan.yml` using `gitleaks/gitleaks-action@v2`

### B.5 Delete spec-write artifacts

- `specs/_test_ping.md`
- `specs/_test_ping2.md`

### B.6 Re-verify `.env.example` and `.gitignore` still clean

Verified at spec-write. Re-verify after scrub.

---

## Track C — Matt verification (after B scrub committed)

### C.1 — Confirm old key still dead (should already be from A.5)

Re-run the curl from A.5 — still 401.

### C.2 — Confirm new key works

Cockpit loads for test deal `e505cd1c-86b4-4d73-88e3-bc71ef342d94`. No 500s in Vercel runtime logs tied to Supabase.

### C.3 — Final gitleaks

```bash
pnpm dlx gitleaks detect --source . --verbose
```

Expected: zero findings on HEAD. Historical findings may persist if no rewrite was performed — that's expected per "out of scope" below.

---

## Commit strategy

One commit from Track B:

```
security: scrub hardcoded Supabase credential (SECURITY-ROTATION)
```

Body: list every scrubbed file, B.4 guard choice, both `_test_ping*.md` deletions, gitleaks before/after results. Include note that rotation was completed in Supabase dashboard by Matt BEFORE this commit.

---

## AAR requirements

Claude Code AAR for Track B.1 (scope report) must include:
- All grep hits (or "zero hits outside known file")
- Git history commit that introduced the leaked key
- Gitleaks HEAD and full-history output (paste both)

Claude Code AAR for Track B.2–B.6 (scrub) must include:
- Every file scrubbed (file:line before + after)
- `tsc --noEmit --skipLibCheck` clean
- Gitleaks after-scrub output
- B.4 guard installed + which option
- Both `_test_ping*.md` deleted

---

## Out of scope (unless B.1 surfaces them)

- **Rotating other providers** (Clerk, Twilio, Resend, Gemini, OpenAI, etc.). If B.1 surfaces their keys, escalate to separate SECURITY-INCIDENT sub-specs.
- **Git history rewrite** (BFG, filter-branch). Rewrite breaks clones, CI caches, contributor workflow. Rotation is sufficient defense IF key is genuinely invalidated. Only rewrite if legal/compliance requires.
- **Supabase RLS audit.** Hygiene backlog — run `get_advisors type=security`.
- **Changing how `audit-db.ts` is invoked.** Its callers (if any) will already be using env vars; only the hardcoded fallback changes.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Old key exploited between 2026-03-07 and rotation | Unknown | Rotate fast after scope confirmed, check audit logs 2026-03-07 onward |
| B.1 surfaces MULTIPLE keys (other providers) | Medium | STOP at B.1 end; surface scope; Matt decides multi-provider rotation plan |
| Scrub commit lands before new key propagates to all consumers | Medium | A.5 green-light is gating — explicit human confirmation before B.2 |
| New key leaks again in future | Low | B.4 gitleaks guard is the structural fix |
| Cloud Run workers have DB password hardcoded somewhere not yet found | Low | B.1's broader credential scan (Step 2) should catch this |

---

## Hand-off

**Claude Code does B.1 only.** Deliver scope report. Stop.

**Matt reviews scope. Decides rotation plan.** Could be: rotate now / expand spec / both.

**If rotation: Matt executes Track A. Green-lights B.2.**

**Claude Code executes B.2–B.6 after green-light.**

**Matt verifies Track C.**

Estimated end-to-end: 60–90 min given a clean scope report; longer if B.1 surfaces multiple keys.
