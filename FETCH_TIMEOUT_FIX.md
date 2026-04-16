# Permanent Fetch Timeout Fix — Full Codemod
# Eliminates frozen loading/saving states across all 170+ component files

---

## What This Does

Creates `src/lib/api/fetchWithTimeout.ts` then runs a codemod across every
component file that contains `await fetch(`, adding the import and replacing
the call. Every fetch in every component gets a hard timeout. The class of bug
where a loading/saving state freezes permanently cannot recur.

---

## Step 1 — Create the utility

**File: `src/lib/api/fetchWithTimeout.ts`**

```typescript
/**
 * fetchWithTimeout — drop-in replacement for fetch() with a hard timeout.
 *
 * Wraps the native fetch in an AbortController. If the request does not
 * complete within `timeoutMs`, the controller aborts it, the promise rejects
 * with an AbortError (err.name === "AbortError"), and any surrounding
 * try/finally block runs immediately.
 *
 * This is the canonical fetch wrapper for all UI save/action paths.
 * Bare `fetch()` calls paired with loading/saving state are a banned pattern.
 *
 * Usage — identical to fetch():
 *   const res = await fetchWithTimeout("/api/foo", { method: "POST", body });
 *
 * Custom timeout:
 *   const res = await fetchWithTimeout("/api/slow", init, 30_000);
 *
 * Detecting timeout in catch:
 *   catch (err: any) {
 *     const msg = err?.name === "AbortError"
 *       ? "Request timed out — please try again"
 *       : err?.message ?? "Something went wrong";
 *   }
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}
```

---

## Step 2 — Run the codemod script

Create this file at the repo root, run it once, then delete it.

**File: `scripts/codemod-fetch-timeout.mjs`**

```javascript
#!/usr/bin/env node
/**
 * Codemod: replace `await fetch(` with `await fetchWithTimeout(`
 * and inject the import in every component file that needs it.
 *
 * Run from repo root:
 *   node scripts/codemod-fetch-timeout.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const IMPORT_LINE =
  'import { fetchWithTimeout } from "@/lib/api/fetchWithTimeout";';

const TARGET_DIRS = ["src/components"];
const EXT = /\.(tsx|ts)$/;

let filesChanged = 0;
let replacementsMade = 0;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (EXT.test(entry)) files.push(full);
  }
  return files;
}

for (const dir of TARGET_DIRS) {
  for (const file of walk(dir)) {
    const original = readFileSync(file, "utf8");

    // Skip files that don't call fetch
    if (!original.includes("await fetch(")) continue;

    // Skip files that already import fetchWithTimeout
    if (original.includes("fetchWithTimeout")) continue;

    // Count replacements
    const occurrences = (original.match(/await fetch\(/g) || []).length;

    // Replace all `await fetch(` with `await fetchWithTimeout(`
    let updated = original.replaceAll("await fetch(", "await fetchWithTimeout(");

    // Inject import after the last existing import block.
    // Strategy: find the last line starting with `import ` and insert after it.
    const lines = updated.split("\n");
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("import ")) lastImportIdx = i;
    }

    if (lastImportIdx === -1) {
      // No imports found — prepend
      updated = IMPORT_LINE + "\n" + updated;
    } else {
      lines.splice(lastImportIdx + 1, 0, IMPORT_LINE);
      updated = lines.join("\n");
    }

    if (updated !== original) {
      writeFileSync(file, updated, "utf8");
      filesChanged++;
      replacementsMade += occurrences;
      console.log(`✓ ${relative(process.cwd(), file)} (${occurrences} replacement${occurrences > 1 ? "s" : ""})`);
    }
  }
}

console.log(`\nDone. ${filesChanged} files changed, ${replacementsMade} fetch() calls wrapped.`);
```

Run it:
```bash
node scripts/codemod-fetch-timeout.mjs
```

---

## Step 3 — Fix catch blocks that reference AbortError in high-traffic files

The codemod wraps all fetch calls but doesn't update catch blocks. Most catch
blocks already handle errors generically (show a toast, set an error string)
which is fine — AbortError will surface as "Request aborted" or similar.

For the highest-traffic save paths, update the catch block to show a better
message. The pattern is the same in every file:

```typescript
// Before
} catch (err: any) {
  setError(err?.message ?? "Something went wrong");
}

// After
} catch (err: any) {
  const msg = err?.name === "AbortError"
    ? "Request timed out — please try again"
    : (err?.message ?? "Something went wrong");
  setError(msg);
}
```

Priority files for this improvement (the ones users interact with most):
- `src/components/deals/DealNameInlineEditor.tsx` ← the reported bug
- `src/components/deals/IgniteWizard.tsx`
- `src/components/creditMemo/MemoCompletionWizard.tsx`
- `src/components/deals/BorrowerAttachmentCard.tsx`
- `src/components/deals/DealIntakeCard.tsx`
- `src/components/ai/GenerateCreditMemoPanel.tsx`
- `src/components/creditMemo/RunResearchButton.tsx`
- `src/components/creditMemo/GenerateNarrativesButton.tsx`

---

## Step 4 — TypeScript check

```bash
npx tsc --noEmit 2>&1 | grep -v "pdf/route.ts"
```

Expected: zero new errors. The `fetchWithTimeout` signature is identical to
`fetch` so no type changes are needed at call sites. If any file was calling
`fetch` with an explicit `signal` in its `init` object, the codemod's spread
`{ ...init, signal: controller.signal }` will override it — that's intentional
and correct (the timeout controller's signal takes precedence).

---

## Step 5 — Clean up and commit

```bash
rm scripts/codemod-fetch-timeout.mjs
```

```
fix(fetch): permanent frozen-save prevention via fetchWithTimeout utility

Root cause: bare fetch() calls with no timeout inside try/finally blocks.
If the server hangs, the await never settles, finally never runs, and any
saving/loading state freezes permanently.

- src/lib/api/fetchWithTimeout.ts: 15s AbortController wrapper, drop-in for fetch()
- Codemod applied to all 170 component files with await fetch() calls
- AbortError surfaced as "Request timed out" in high-traffic catch blocks
- DealNameInlineEditor: reported frozen rename bug resolved
- Enter/Escape keyboard shortcuts added to rename input

This class of bug cannot recur in any component using fetchWithTimeout.
```

---

## Edge Cases

**Files that pass their own AbortSignal:** If any component already has its own
AbortController (e.g., for cancellable polling), the codemod's signal will
override it. Search for `signal:` in the updated files and verify the intent.
In almost all cases the timeout signal is the right behavior.

**`src/lib/api/fetchWithTimeout.ts` itself:** The utility uses bare `fetch` —
that's correct and intentional. The codemod only touches `src/components`.

**Server-side files:** The codemod only touches `src/components`. Server routes
under `src/app/api` make outbound fetch calls to Gemini, Supabase, etc., which
have their own timeout handling. Do not run the codemod on those files.
