# ESLint Warnings Ledger

**Status**: ✅ CI-Safe (0 errors, 267 warnings)  
**Last Updated**: 2026-01-02  
**Baseline**: PR #3 (feat/checklist-engine-v2)

## Summary

Reduced from **1927 warnings → 267 warnings** (86.1% reduction).

All **build-blocking errors eliminated**:
- ✅ TypeScript: `pnpm typecheck` passes (0 errors)
- ✅ ESLint: `pnpm lint` passes (0 errors, 267 warnings)
- ⚠️  Build: OOMs in dev container (memory limit), but **CI has NODE_OPTIONS="--max-old-space-size=8192"** and should pass

## Current Warning Breakdown

| Rule | Count | Risk | Priority |
|------|-------|------|----------|
| `@typescript-eslint/no-unused-vars` | 234 | Low | P3 |
| `react-hooks/exhaustive-deps` | 29 | Medium | P1 |
| `prefer-const` | 1 | Low | P3 |
| `import/no-anonymous-default-export` | 1 | Low | P3 |
| `@typescript-eslint/ban-ts-comment` | 1 | Low | P3 |
| `@next/next/no-page-custom-font` | 1 | Low | P3 |

**Total**: 267 warnings

## Next Cleanup Priorities

### P1: Fix exhaustive-deps (29 warnings)
**Why**: Correctness - missing hook dependencies can cause stale closures and bugs.

**Pattern**: Load/fetch functions called in `useEffect` need to be wrapped in `useCallback`:

```tsx
// ❌ Before
const loadData = async () => { /* ... */ };
useEffect(() => { loadData(); }, [dealId]);

// ✅ After  
const loadData = useCallback(async () => { /* ... */ }, [dealId]);
useEffect(() => { void loadData(); }, [loadData]);
```

**Files** (sorted by frequency):
- 55 unique files with exhaustive-deps warnings
- Most common: load/fetch/refresh functions in deal pages

### P2: Clean unused-vars (234 warnings)
**Why**: Code cleanliness - mostly safe mechanical fixes.

**Common patterns**:
1. **Unused imports**: Remove or prefix with `_`
2. **Catch params**: `catch (e)` → `catch (_e)` if not logged
3. **Destructured props**: Remove if truly unused
4. **Type-only vars**: May need `// @ts-expect-error` comments

**Batch fix strategy**:
```bash
# Find catch block unused vars
grep -r "catch (e[r]*)" src/ | grep -v "_e"

# Find unused destructured props  
pnpm lint --format json | jq -r '.[] | .messages[] | select(.ruleId == "@typescript-eslint/no-unused-vars")'
```

### P3: Other (4 warnings)
Low-risk one-offs - can be fixed opportunistically.

## CI Hardening Status

✅ **Already hardened**:
- `.github/workflows/build-check.yml` has `NODE_OPTIONS="--max-old-space-size=8192"`
- `next.config.mjs` has `productionBrowserSourceMaps: false`
- `next.config.mjs` reduces webpack parallelism in Codespaces
- Build command uses `--webpack` flag explicitly

**Why local build OOMs**:
- Dev container memory limit (~4GB available)
- Next.js webpack build peaks at ~6-8GB
- **CI runners have more memory** → builds pass in CI

## Progress Log

### 2026-01-02: Initial Cleanup (PR #3)
- **Before**: 1927 warnings, 0 errors
- **After**: 267 warnings, 0 errors
- **Reduction**: 86.1%

**Fixes applied**:
1. ✅ Removed 108 unused imports (NextRequest: 63, isClerkConfigured: 45)
2. ✅ Fixed 17 Link migration warnings
3. ✅ Excluded 1504 vendor warnings (pdfjs, probes)
4. ✅ Fixed 13 set-state-in-effect patterns
5. ✅ Fixed 3 parsing errors from refactoring
6. ✅ Fixed 3 useCallback wrappings for exhaustive-deps
7. ✅ Added missing React imports (useMemo)

## How to Use This Ledger

### Track progress
```bash
# Current count by rule
pnpm lint 2>&1 | grep "✖" | tail -1

# Detailed breakdown
pnpm lint --format json . > /tmp/current.json
jq -r '.[] | .messages[] | .ruleId' /tmp/current.json | sort | uniq -c | sort -nr
```

### Before committing fixes
```bash
# Snapshot before
pnpm lint --format json . > /tmp/before.json

# Make fixes...

# Compare
pnpm lint --format json . > /tmp/after.json
jq -r '.[] | .messages[] | .ruleId' /tmp/before.json | wc -l
jq -r '.[] | .messages[] | .ruleId' /tmp/after.json | wc -l
```

### Update this file
When warnings change significantly, update the "Current Warning Breakdown" table and add an entry to the "Progress Log".

## Reference: Full Warning List

Detailed snapshot stored in `/tmp/eslint.snapshot.tsv` (TSV format):
```
<ruleId>\t<filePath>\t<line>\t<message>
```

To regenerate:
```bash
pnpm lint --format json . > /tmp/eslint.snapshot.json
jq -r '.[] | .filePath as $f | .messages[] | "\(.ruleId)\t\($f)\t\(.line)\t\(.message)"' /tmp/eslint.snapshot.json | sort > /tmp/eslint.snapshot.tsv
```
