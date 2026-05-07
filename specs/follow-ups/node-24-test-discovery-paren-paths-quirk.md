# Follow-up: Node 24 `--test` silently skips files in `[bracket]` paths

**Filed:** 2026-05-07
**Discovered during:** Triage of `fix/main-ci-test-drift-2026-05` (PR #403). Surfaced because the test-drift in `creditMemoRedirectGuard.test.ts` and `pipelineStatus.test.ts` had been hidden — locally `pnpm test:unit` reported all green even though those tests would (and did) fail on CI. Investigating *why* the local runner missed them led to this discovery.
**Severity:** High — affects the trustworthiness of `pnpm test:unit` as a pre-push signal.

## The bug

`node --test` (Node.js 24) interprets `[...]` segments in file path arguments as **glob character classes**, not literal path components. Files whose actual paths contain literal `[` characters are matched against the pattern as if the brackets were a glob expression. Since no single-character directories exist matching the glob, the pattern matches nothing and `node --test` silently runs **0 tests**, exits 0, and reports success.

Parentheses (`(...)`) are NOT affected — they aren't standard glob metacharacters and pass through as literals.

### Repro

```bash
$ node --version
v24.15.0

# Bracket path → silently skipped (the bug)
$ mkdir -p '/tmp/[dealId]/__tests__'
$ cat > '/tmp/[dealId]/__tests__/sample.test.ts' << 'EOF'
import test from "node:test";
import assert from "node:assert/strict";
test("sample test in [dealId] path", () => { assert.equal(1, 1); });
EOF
$ node --test --import tsx '/tmp/[dealId]/__tests__/sample.test.ts'
ℹ tests 0
ℹ pass 0
ℹ fail 0
# exits 0 — silent skip

# Paren path → works fine
$ mkdir -p '/tmp/(app)/__tests__'
$ cp '/tmp/[dealId]/__tests__/sample.test.ts' '/tmp/(app)/__tests__/sample.test.ts'
$ node --test --import tsx '/tmp/(app)/__tests__/sample.test.ts'
ℹ tests 1
ℹ pass 1
# Works.
```

The mechanism was confirmed by another experiment: a file at `/tmp/x/sample.test.ts` is correctly matched by both `/tmp/x/sample.test.ts` *and* `/tmp/[xyz]/sample.test.ts` — proving the brackets are being interpreted as a glob char class.

## Impact on this repo

```bash
$ find src/app -name "*.test.ts" -type f | grep -E "\["
src/app/(app)/deals/[dealId]/credit-memo/__tests__/creditMemoRedirectGuard.test.ts
src/app/api/deals/[dealId]/pipeline-status/__tests__/pipelineStatus.test.ts
src/app/api/deals/[dealId]/memo-inputs/__tests__/postFromWizardTrustedBankId.test.ts
src/app/api/deals/[dealId]/pipeline-recompute/__tests__/pipelineRecompute.test.ts
src/app/api/deals/[dealId]/credit-memo/overrides/__tests__/deprecationShim.test.ts
src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/__tests__/confirmRouteMatchingGuard.test.ts
```

**6 test files** are silently skipped by `pnpm test:unit` on Node 24 locally. These are exactly the test files that guard our most security-sensitive surface: the dynamic-routed API endpoints and the credit-memo redirect contract. `pnpm test:unit` returns "All tests passed!" even when those files contain failing assertions. CI uses a different runner config that handles brackets correctly, so the failures only surface there.

We don't yet know how many additional silent failures may be lurking in the 6 files (a full audit is part of the recommended fix below). What we know for sure: this PR's triage of CI failures (PRs #402 / #403) discovered 5 stale-assertion failures in 2 of those 6 files. That hit rate on a sample of 2 of 6 strongly suggests the others contain drift too.

## Workaround used in this triage

`cd` into the `__tests__` directory and run with a relative file path containing no brackets:

```bash
$ cd src/app/api/deals/\[dealId\]/pipeline-recompute/__tests__
$ node --test --import tsx pipelineRecompute.test.ts
# Tests run normally.
```

This works because the cwd path's brackets aren't part of the argument string Node parses as a glob; only the `argv[]` file-path argument is globbed. The file path `pipelineRecompute.test.ts` is a literal match.

## Recommended fix options

| Option | Effort | Pro | Con |
|--------|--------|-----|-----|
| **(a) Replace `node --test` with `vitest`** | Medium | Mature ecosystem; handles paths correctly; better DX (watch, ui, snapshots, coverage built-in) | Migration effort across 419 test files; new dep; possibly different test API surface |
| **(b) Wrapper script that cd's into each test file's dir** | Small | Keeps `node --test`; minimal infrastructure change | Extra layer to maintain; harder to debug; loses globbing for legitimate cases |
| **(c) Pin invocation to a glob-escaped form** | Small | Targeted fix | Has to be applied in every script that runs tests, easy to miss |
| **(d) Pre-resolve file list, then run via process spawning per file** | Medium | Robust | Slow (spawns many node processes); reporter aggregation gets ugly |

**Recommendation:** **Option (a) — migrate to vitest.** The repo already has 419 test files using `node:test` semantics (`test()`, `assert.match()`, etc.), all of which vitest supports natively or with a tiny shim. Vitest's path handling is correct, watch mode is fast, and switching gives us coverage tooling out of the box. Migration cost is one-time; the bug otherwise compounds every time a new dynamic-route test file is added.

**Short-term mitigation (for before any of the above lands):** Update `package.json`'s `test:unit` script to **require** that the file count run by Node matches the file count returned by `find` — fail loudly when they diverge. Even simpler: a CI-only assert that `pnpm test:unit` runs ≥ N tests, where N is a known floor.

## Recommended investigation (audit step before fix)

Run each of the 6 silently-skipped test files via the cd-relative workaround and capture the result. Any failures discovered are presumed pre-existing CI failures hidden from local runs. Triage them like the test-drift batch was triaged in `fix/main-ci-test-drift-2026-05`:

```bash
for f in $(find src/app -name "*.test.ts" -type f | grep -E "\["); do
  d=$(dirname "$f"); n=$(basename "$f")
  echo "=== $f ==="
  ( cd "$d" && node --test --import tsx "$n" 2>&1 | tail -10 )
done
```

## Status

- Filed: 2026-05-07
- Originating context: PR #403 (`fix/main-ci-test-drift-2026-05`)
- Affected files: 6 (listed above)
- Owner: unassigned
- Estimated effort:
  - Audit step: ~30 min (run the 6 files via workaround, classify failures)
  - Fix step: depends on chosen option (a–d above)
- Blocker for: trustworthy local pre-push signal

## Notes for future-us

The original test-drift was hidden BY this quirk. If we'd been running the bracket-pathed files locally, the drift would have surfaced when the first author ran `pnpm test:unit` and found 5 reds. Instead, those 5 reds accumulated invisibly until the CI run on PR #402 surfaced them (and even then, only because the noise-floor was low enough to notice). This is exactly the "every future PR shows unstable and genuine new failures hide in the noise" failure mode. Worth fixing before the noise compounds further.
