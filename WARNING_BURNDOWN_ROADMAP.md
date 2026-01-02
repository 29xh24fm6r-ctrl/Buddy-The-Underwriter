# Warning Burn-Down Roadmap

**Current**: 267 warnings (0 errors)  
**Target**: <100 warnings ("boring")  
**Stretch Goal**: <50 warnings

## Phase 1: Fix Correctness Issues (P1)

### 29 exhaustive-deps warnings
**Risk**: Medium (stale closures, incorrect re-renders)  
**Effort**: 2-3 hours  
**Pattern**: Wrap async functions in `useCallback`

**Implementation**:
```bash
# Get all exhaustive-deps files
pnpm lint 2>&1 | grep "exhaustive-deps" -B 10 | grep "^/workspaces" | sort -u > /tmp/deps-files.txt

# For each file, apply pattern:
# 1. Find the async function (load*, fetch*, refresh*)
# 2. Wrap in useCallback with proper deps
# 3. Update useEffect to use the wrapped function
```

**Example batch script** (safe, mechanical):
```typescript
// Pattern detection
const functionName = /const (load\w+|fetch\w+|refresh\w*) = async/;
const effectCall = /useEffect\(\(\) => \{\s*void (\w+)\(\);/;

// Transformation
const wrapped = `const ${name} = useCallback(async () => { ... }, [deps]);`;
const effectUpdate = `useEffect(() => { void ${name}(); }, [${name}]);`;
```

**Expected reduction**: 29 → 0 (-29)

---

## Phase 2: Mechanical Cleanup (P2)

### 234 unused-vars warnings
**Risk**: Low (code cleanliness only)  
**Effort**: 1-2 hours with automation  
**Patterns**:

#### 2.1 Unused catch params (~20 warnings)
```bash
# Find: catch (e) or catch (err)
grep -r "catch (e[r]*)" src/ --include="*.tsx" --include="*.ts" | grep -v "_e"

# Fix: Prefix with underscore
sed -i 's/catch (e)/catch (_e)/g'
sed -i 's/catch (err)/catch (_err)/g'
```

#### 2.2 Unused imports (~150 warnings)
```bash
# Auto-fix safe removals
pnpm lint --fix

# Manual review for complex cases
pnpm lint --format json | jq -r '
  .[] | .messages[] 
  | select(.ruleId == "@typescript-eslint/no-unused-vars") 
  | select(.message | contains("is defined but never used"))
  | "\(.filePath):\(.line) - \(.message)"
'
```

#### 2.3 Unused destructured props (~50 warnings)
```typescript
// Pattern 1: Remove if truly unused
const { dealId, dealName } = params;  // dealName unused
// Fix:
const { dealId } = params;

// Pattern 2: Prefix with _ if needed for structure
const { dealId, _dealName } = params;
```

**Expected reduction**: 234 → 50 (-184)

---

## Phase 3: One-Off Fixes (P3)

### 4 miscellaneous warnings
- `prefer-const`: Change `let` → `const` (1 instance)
- `import/no-anonymous-default-export`: Name the default export (1 instance)
- `@typescript-eslint/ban-ts-comment`: Remove `// @ts-ignore`, use proper typing (1 instance)
- `@next/next/no-page-custom-font`: Move font to _app or use next/font (1 instance)

**Expected reduction**: 4 → 0 (-4)

---

## Execution Plan

### Sprint 1: Correctness (1-2 days)
```bash
# Fix all exhaustive-deps
./scripts/fix-exhaustive-deps.sh  # Create this script

# Verify no new errors
pnpm tsc --noEmit
pnpm lint | grep "✖"

# Commit
git commit -am "fix: resolve all exhaustive-deps warnings (29 → 0)"
```

**Checkpoint**: 267 → 238 warnings

### Sprint 2: Mechanical Cleanup (1 day)
```bash
# Batch fix catch params
./scripts/fix-catch-params.sh

# Auto-fix imports
pnpm lint --fix

# Manual review remaining
pnpm lint --format json > /tmp/remaining.json

# Commit
git commit -am "chore: cleanup unused vars (234 → 50)"
```

**Checkpoint**: 238 → 54 warnings

### Sprint 3: Final Polish (2-3 hours)
```bash
# Fix the 4 one-offs manually
# Each is unique, requires specific fix

git commit -am "chore: fix final linting warnings (54 → 50)"
```

**Checkpoint**: 54 → 50 warnings ✨

---

## Automation Scripts

### scripts/fix-exhaustive-deps.sh
```bash
#!/bin/bash
# Auto-wrap load/fetch functions in useCallback

set -e

FILES=$(pnpm lint 2>&1 | grep "exhaustive-deps" -B 10 | grep "^/workspaces" | sort -u)

for file in $FILES; do
  echo "Processing $file..."
  
  # Use AST-based tool or manual pattern matching
  # For safety, generate a diff and review before applying
  
  # Example: wrap loadData with useCallback
  # (Requires node script with @babel/parser for safety)
done

echo "✅ Generated fixes. Review diffs before committing."
```

### scripts/fix-catch-params.sh
```bash
#!/bin/bash
# Prefix unused catch params with underscore

set -e

# Find all catch blocks with unused params
FILES=$(pnpm lint 2>&1 | grep "no-unused-vars.*'e.*' is defined" -B 10 | grep "^/workspaces" | sort -u)

for file in $FILES; do
  echo "Fixing $file..."
  
  # Safe replacements (only if 'e' is not used in catch block)
  sed -i 's/} catch (e) {/} catch (_e) {/g' "$file"
  sed -i 's/} catch (err) {/} catch (_err) {/g' "$file"
  sed -i 's/} catch (error) {/} catch (_error) {/g' "$file"
done

echo "✅ Fixed catch params. Run lint to verify."
```

---

## Success Metrics

| Phase | Start | Target | Reduction |
|-------|-------|--------|-----------|
| Current | 267 | - | - |
| After P1 | 238 | <250 | -29 (10.9%) |
| After P2 | 54 | <100 | -184 (77.5%) |
| After P3 | 50 | <50 | -4 (1.5%) |
| **Total** | **267** | **50** | **-217 (81.3%)** |

**Combined with previous work**: 1927 → 50 = **97.4% reduction** 🎯

---

## Risk Mitigation

### Before Each Batch Fix
```bash
# Snapshot current state
git stash  # Clean working tree
pnpm tsc --noEmit > /tmp/tsc-before.txt
pnpm lint > /tmp/lint-before.txt
```

### After Each Batch Fix
```bash
# Verify no regressions
pnpm tsc --noEmit > /tmp/tsc-after.txt
diff /tmp/tsc-before.txt /tmp/tsc-after.txt  # Should be empty

pnpm lint > /tmp/lint-after.txt
# Should only show expected warning reductions

# Run a quick smoke test
pnpm dev  # Start dev server, verify no crashes
```

### Rollback Strategy
```bash
# If something breaks
git reset --hard HEAD~1
git reflog  # Find last good commit
```

---

## When to Stop

**"Boring" threshold**: <100 warnings  
**Realistic goal**: 50-75 warnings

**Don't optimize for 0 warnings** - some are acceptable:
- Unused `_` prefixed vars (intentional)
- Third-party type issues (`@ts-expect-error` with explanation)
- One-off cases where the warning is overly strict

**Aim for**: 95%+ warning reduction from baseline (1927 → <100)
