# SECURITY-ROTATION rev 3 — Scope Confirmed, Sequential Rotation

**Date:** 2026-04-24 (rev 3)
**Severity:** P0 (Supabase) + P1 (Clerk test-mode)
**Status:** B.1 scan COMPLETE (rev 2 hand-off); rotation plan confirmed below.

---

## Scope (confirmed by B.1 scan)

### Leak 1 — Supabase service-role key (P0)

- **File:** `scripts/audit-db.ts:5`
- **Project:** `sglhiuizgugbnzkymwnk.supabase.co` (current production Buddy project, confirmed via Supabase MCP `get_project_url`)
- **Introduced:** commit `3a9d3b40` on 2025-12-23 by `29xh24fm6r-ctrl`. Repeated in `ed940010` (2025-12-27).
- **Exposure window:** ~4 months in git history.
- **Blast radius:** Full service-role access. Bypasses RLS. Cross-tenant reads/writes possible.

### Leak 2 — Clerk test-mode secret key (P1)

- **Files:**
  - `docs/build-logs/AUTH_FIX_SUMMARY.md:50`
  - `docs/archive/operational-pre-84/CLERK_VERCEL_CHECKLIST.md:15`
- **Clerk instance:** `whole-rhino-35.clerk.accounts.dev` (test-mode)
- **Introduced:** commit `ca84e740` on 2025-12-26 by `29xh24fm6r-ctrl`. Copied into `08d22427`, `ef3de566`, `e91f238f` on 2025-12-27/28.
- **Exposure window:** ~4 months in git history.
- **Blast radius:** Test-mode only — cannot authenticate users on production Clerk instance. Can however impersonate test users and access any data exposed by the test instance.

### Git history authorship

All intro commits are `29xh24fm6r-ctrl` (Matt's expected identity). No compromised-account indicator.

### Noise correctly classified (no action required)

Gitleaks flagged 239 total hits. 236 are false positives: enum constants (`COMBINED_REV10_RATE200`, tax form field keys), `sk_test_placeholder` literals in CI workflows, `re_xxx…` doc placeholders, identifier substrings (`prepare_renewal_`, etc.). Documented in B.1 scan report.

### False-positive hits NOT to touch

- `docs/build-logs/STUBS_REPLACED_SUMMARY.md:150` — trailing `...` placeholder
- `.mcp.json:10` — `--project-ref=sglhiuizgugbnzkymwnk` (project identifier, not a credential)
- `scripts/run-migration.mjs:38` — dashboard URL in console.log
- `.github/workflows/ci.yml` + `build-check.yml` — `CLERK_SECRET_KEY: sk_test_placeholder` (literal placeholder)
- `docs/build-logs/BULLETPROOF_COMPLETE.md`, `docs/archive/operational-pre-84/DEPLOYMENT_CHECKLIST_GROWTH.md` — `RESEND_API_KEY=re_xxx…`

---

## Execution order (MANDATORY, SEQUENTIAL)

1. **Matt — Track A1**: rotate Supabase key + update consumers + redeploy + verify (the P0 hotspot, do first)
2. **Matt — Track A2**: rotate Clerk test-mode key + update consumers + verify
3. **Matt — green-light Claude Code**: confirm both rotations verified
4. **Claude Code — Track B**: scrub all 3 file-level hits + install gitleaks guard + delete spec-probe artifacts
5. **Matt — Track C**: final verification (old keys dead, new keys work, gitleaks clean)

Parallel execution is explicitly forbidden. One rotation fails, the next doesn't compound the mess.

---

## Track A1 — Supabase rotation (P0, do first)

### A1.1 — Pre-rotation: verify Cloud Run worker env vars

Before rotating, confirm whether Cloud Run workers (`buddy-core-worker`, `franchise-sync-worker`) have `SUPABASE_SERVICE_ROLE_KEY` set. The source code uses `BUDDY_DB_URL` (direct Postgres) but env vars can be set even if unused.

```bash
gcloud run services describe buddy-core-worker \
  --region us-central1 \
  --format="value(spec.template.spec.containers[0].env)" | grep -i supabase

gcloud run services describe franchise-sync-worker \
  --region us-central1 \
  --format="value(spec.template.spec.containers[0].env)" | grep -i supabase
```

If either returns a `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY` entry, add to the consumer list in A1.3.

### A1.2 — Rotate in Supabase dashboard

1. Supabase dashboard → project `sglhiuizgugbnzkymwnk` → Settings → API
2. Reset service role key. **Old key must be invalidated, not hidden.**
3. Copy new key to password manager immediately.

### A1.3 — Update consumers

Known consumers (update all BEFORE triggering any redeploys):

- **Vercel production** `SUPABASE_SERVICE_ROLE_KEY`
- **Vercel preview** `SUPABASE_SERVICE_ROLE_KEY` (if separate)
- **Cloud Run workers** — only if A1.1 found them using the key
- **Developer `.env.local` files** (Matt's local + any other devs with access)
- **GitHub Actions secrets** — only if `.github/workflows/*` references `SUPABASE_SERVICE_ROLE_KEY` (confirm not `sk_test_placeholder` pattern)

### A1.4 — Trigger redeploys

- Vercel production (dashboard "Redeploy" or no-op commit)
- Vercel preview (if applicable)
- Cloud Run workers (only if A1.1 identified them)

### A1.5 — Verify

```bash
# Should return 401 or similar non-200
OLD_KEY="<copy from scripts/audit-db.ts:5 on current HEAD>"
curl "https://sglhiuizgugbnzkymwnk.supabase.co/rest/v1/deals?select=id&limit=1" \
  -H "apikey: $OLD_KEY" -H "Authorization: Bearer $OLD_KEY"
```

If 200: old key is still valid. STOP. Re-rotate before proceeding.

Then:
- Cockpit loads for test deal `e505cd1c-86b4-4d73-88e3-bc71ef342d94`
- Vercel runtime logs show no 500s tied to Supabase auth
- Cloud Run workers still processing (if applicable)

### A1.6 — Check Supabase audit logs (if plan supports)

Look at `auth`, `api`, `postgres` logs from 2025-12-23 onward. Flag: unusual IP patterns, large data exports, cross-tenant access, off-hours activity.

---

## Track A2 — Clerk test-mode rotation (P1, after A1 verified)

### A2.1 — Rotate in Clerk dashboard

1. Clerk dashboard → application `whole-rhino-35` → API keys
2. Rotate the secret key (the one with `sk_test_` prefix matching the one in the docs files)
3. Copy new key to password manager

### A2.2 — Update consumers

- Vercel preview env `CLERK_SECRET_KEY` (most likely location for test-mode)
- Vercel production env `CLERK_SECRET_KEY` (only if test instance used in prod — probably not)
- Developer `.env.local` files — **coordinate with any other devs using this Clerk instance**
- GitHub Actions secrets — check `.github/workflows/` for `CLERK_SECRET_KEY`; skip if only `sk_test_placeholder` literal

### A2.3 — Verify

- Sign-in flow works in preview/dev environments
- No 401/403 cascades in preview deploys after redeploy
- Old test-mode key invalid in Clerk dashboard

---

## Track B — Claude Code scrub (after BOTH A1 and A2 verified)

### B.1 — Scrub `scripts/audit-db.ts`

Replace lines 4-5 (hardcoded url/key) with env-var reads + fail-fast:

```ts
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE;

if (!url) { console.error('[audit-db] Missing SUPABASE_URL'); process.exit(1); }
if (!key) { console.error('[audit-db] Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
```

Rest of file unchanged. Body of `auditDatabase()` and the `writeFileSync` calls stay identical.

### B.2 — Scrub Clerk key from doc files

**`docs/build-logs/AUTH_FIX_SUMMARY.md:50`** — Replace the hardcoded key with a redacted placeholder. Keep the surrounding context readable:

```
CLERK_SECRET_KEY=sk_test_<redacted — see Clerk dashboard>
```

Or the equivalent pattern used elsewhere in the docs directory (e.g., `sk_test_YOUR_KEY_HERE`).

**`docs/archive/operational-pre-84/CLERK_VERCEL_CHECKLIST.md:15`** — same pattern.

These are archived setup docs, not runtime code — a literal placeholder is fine. DO NOT delete the surrounding context (the docs have historical value).

### B.3 — Install gitleaks guard

**Important correction from B.1 scan:** `pnpm dlx gitleaks` fails because the npm package of that name is unrelated to the real tool. Use one of these instead:

**Option 1 — Pre-commit hook (husky):** `.husky/pre-commit`:
```bash
#!/usr/bin/env sh
# Download gitleaks if not present (cache in $HOME/.cache)
GITLEAKS_BIN="$HOME/.cache/gitleaks/gitleaks"
if [ ! -x "$GITLEAKS_BIN" ]; then
  mkdir -p "$(dirname "$GITLEAKS_BIN")"
  # Pin version to match the one used in B.1 scan
  curl -sSL "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m).tar.gz" \
    | tar -xz -C "$(dirname "$GITLEAKS_BIN")"
fi
"$GITLEAKS_BIN" protect --staged --verbose
```

**Option 2 (preferred) — GitHub Action:** `.github/workflows/secret-scan.yml`:
```yaml
name: Secret Scan
on: [push, pull_request]
jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Check `.github/workflows/` first. If a secret-scan workflow already exists and is disabled/broken, fix it rather than adding a parallel one.

Recommendation: **Option 2 is lower friction** (no per-dev setup). Use Option 1 only if Option 2 has reasons it can't be used.

### B.4 — Delete spec-probe artifacts

- `specs/_test_ping.md`
- `specs/_test_ping2.md`

Both created during spec-write when testing MCP write capability. Neither should persist.

### B.5 — Re-verify `.env.example` and `.gitignore`

Confirmed clean at B.1 scan:
- `.env.example` contains only placeholders
- `.gitignore` excludes `.env*` except `.env.example`

Re-verify after scrub — should still be clean.

### B.6 — Run gitleaks after scrub

```bash
# Use the Go binary path B.1 scan established
/tmp/gitleaks detect --source . --verbose 2>&1 | tee /tmp/gitleaks-post-scrub.txt
```

Expected on HEAD: real hits count drops from 3 → 0. False-positive count unchanged (still ~236 noise). Commit message should note "real hits: 3 → 0".

### Commit message

```
security: scrub hardcoded credentials (SECURITY-ROTATION)

Rotated upstream (by Matt, before this commit):
- Supabase service-role key on project sglhiuizgugbnzkymwnk (P0)
- Clerk test-mode secret on whole-rhino-35.clerk.accounts.dev (P1)

Scrubbed in this commit:
- scripts/audit-db.ts: hardcoded URL + service-role key → env-var reads with fail-fast
- docs/build-logs/AUTH_FIX_SUMMARY.md:50: redact sk_test_ literal
- docs/archive/operational-pre-84/CLERK_VERCEL_CHECKLIST.md:15: redact sk_test_ literal

Secret-scan guard installed:
- [Option 1 or 2 description]

Cleanup:
- specs/_test_ping.md (spec-write artifact)
- specs/_test_ping2.md (spec-write artifact)

Gitleaks real-hits before → after: 3 → 0
False-positive count unchanged (~236 enum/placeholder hits).

Refs: specs/security-rotation/SPEC.md rev 3
```

---

## Track C — Matt final verification (after Track B commit lands)

### C.1 — Both old keys dead

```bash
# Supabase old key (already verified in A1.5, re-verify)
OLD_SUPABASE="<from rev 2 scan>"
curl "https://sglhiuizgugbnzkymwnk.supabase.co/rest/v1/deals?select=id&limit=1" \
  -H "apikey: $OLD_SUPABASE" -H "Authorization: Bearer $OLD_SUPABASE"
# Expect 401

# Clerk old key — any public-instance test that used to succeed now fails
# (exact test depends on the app's Clerk integration; Matt to choose a probe)
```

### C.2 — Production works

- Cockpit loads for `e505cd1c-86b4-4d73-88e3-bc71ef342d94`
- No 500s in Vercel logs
- Sign-in flow works in prod (covers Clerk prod key integrity, separate from rotation)

### C.3 — Final gitleaks

Using the Go binary from B.1 scan:
```bash
/tmp/gitleaks detect --source . --verbose
```

Expected: the 3 real hits are gone. False-positives unchanged.

---

## AAR requirements

Claude Code AAR for Track B must include:
- Every file scrubbed (file:line before + after)
- `tsc --noEmit --skipLibCheck` clean
- Gitleaks output before scrub (from B.1 scan report) and after scrub (new)
- B.3 guard: which option chosen (1 or 2)
- `specs/_test_ping.md` + `specs/_test_ping2.md` deletion confirmed

---

## Out of scope

- **Clerk PUBLISHABLE key (`pk_test_`):** public by design, not a secret. Leave as-is.
- **Other providers not surfaced by B.1** (Gemini, Resend, Twilio, OpenAI): if B.1 found no real hits, don't hunt for more. Trust the scan.
- **Git history rewrite:** rotation is sufficient defense. Only rewrite if legal/compliance requires.
- **Supabase RLS audit:** hygiene backlog — run `get_advisors type=security` separately.
- **Moving `audit-db.ts`'s caller to env var:** the caller (if any) was already env-var-driven; only the hardcoded fallback inside the script changes.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| A1 rotation breaks Cloud Run workers due to missed env var | Low | A1.1 pre-rotation check; if env exists, A1.3 updates it before A1.4 redeploy |
| Scrub commit lands before new keys propagate | Medium | Track B is explicitly gated on A1 AND A2 both verified; Matt green-lights |
| Clerk test-mode rotation breaks dev workflow for other contributors | Low | A2.2 coordination note; if solo dev, N/A |
| Old Supabase key exploited 2025-12-23 → rotation | Unknown | A1.6 audit logs — look for anomalous patterns |
| Future commits leak again | Low | B.3 gitleaks guard (structural fix) |

---

## Hand-off

**Matt starts Track A1 first.** Work through A1.1 → A1.6, then A2.1 → A2.3. Green-light Claude Code when both are verified.

**Claude Code waits for explicit green-light.** Then executes Track B as one commit.

**Matt verifies Track C** after Track B commit lands.

Total human time: ~30–45 min for Matt (rotation + verification), ~30–45 min for Claude Code (scrub).
