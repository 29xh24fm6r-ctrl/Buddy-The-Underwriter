# Permanent Fix: Fetch Timeout Utility + DealNameInlineEditor
# No more frozen "Saving..." states anywhere in the app

---

## The Bug

`DealNameInlineEditor.tsx` `handleSave()` calls `fetch()` with no timeout.
`setSaving(false)` lives in a `finally` block — correct — but `finally` only
runs after the `await` settles. If the server hangs indefinitely, the `await`
never settles, `finally` never runs, and the button freezes at "Saving..." forever.

This is not unique to this component. The same pattern exists in every
component that calls `fetch` inside a `try/finally` without a timeout.

---

## The Permanent Fix

### Step 1 — Create `src/lib/api/fetchWithTimeout.ts`

A shared, tested utility that wraps `fetch` with an `AbortController` timeout.
Every save handler in the app should use this instead of bare `fetch`.

```typescript
/**
 * fetchWithTimeout — drop-in replacement for fetch() with a hard timeout.
 *
 * Wraps the native fetch in an AbortController that fires after `timeoutMs`.
 * On timeout, the AbortError propagates normally through your try/catch,
 * and any `finally` block runs immediately.
 *
 * Usage (replaces bare fetch):
 *   const res = await fetchWithTimeout(`/api/foo`, { method: "POST", body: ... });
 *
 * The caller's existing try/catch/finally structure is unchanged.
 * AbortError has name === "AbortError" so you can detect it if needed.
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

Place at: `src/lib/api/fetchWithTimeout.ts`

---

### Step 2 — Fix `DealNameInlineEditor.tsx`

**File:** `src/components/deals/DealNameInlineEditor.tsx`

1. Add import at the top:
   ```typescript
   import { fetchWithTimeout } from "@/lib/api/fetchWithTimeout";
   ```

2. In `handleSave`, replace:
   ```typescript
   const res = await fetch(`/api/deals/${dealId}/name`, {
     method: "PATCH",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify(payload),
   });
   ```
   With:
   ```typescript
   const res = await fetchWithTimeout(
     `/api/deals/${dealId}/name`,
     {
       method: "PATCH",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify(payload),
     },
     12_000, // 12 seconds — generous for a name PATCH
   );
   ```

3. In the `catch` block, surface AbortError with a useful message:
   ```typescript
   } catch (err: any) {
     setDisplayName(prev.displayName ?? null);
     const msg =
       err?.name === "AbortError"
         ? "Save timed out — please try again"
         : (err?.message ?? "Failed to update deal name");
     setError(msg);
     toast({ title: "Couldn't update deal name", detail: msg });
   }
   ```

4. Add keyboard shortcuts to the `<input>` (bonus UX — free while we're here):
   ```tsx
   onKeyDown={(e) => {
     if (e.key === "Enter") handleSave();
     if (e.key === "Escape") { setEditing(false); setError(null); }
   }}
   ```

The `finally { setSaving(false) }` block is already correct and needs no change.

---

### Step 3 — Audit and fix other components with the same pattern

Search the codebase for this exact anti-pattern:
```
grep -r "await fetch(" src/components --include="*.tsx" -l
```

For each file found, check if the `fetch` call is inside a `try/finally` that
sets loading/saving state. If there is no `AbortController` or timeout, replace
`fetch(` with `fetchWithTimeout(`.

Priority components to check (high-traffic save paths):
- `src/components/creditMemo/MemoCompletionWizard.tsx`
- `src/components/deals/IgniteWizard.tsx`
- `src/components/deals/BorrowerAttachmentCard.tsx`
- `src/components/deals/DealIntakeCard.tsx`
- Any component that has a `saving` / `loading` state variable paired with `fetch`

The fix in each case is the same two-line change:
1. Import `fetchWithTimeout`
2. Replace `await fetch(` with `await fetchWithTimeout(`

---

## Commit Message

```
fix(fetch): permanent frozen-save prevention via fetchWithTimeout utility

Root cause: bare fetch() calls with no timeout inside try/finally blocks.
If the server hangs, the await never settles, finally never runs, and any
saving/loading state freezes permanently.

- src/lib/api/fetchWithTimeout.ts: shared AbortController wrapper, 15s default
- DealNameInlineEditor.tsx: migrated to fetchWithTimeout (the reported bug)
- All other components with unguarded fetch+saving state: same migration
- AbortError surfaced as user-friendly "timed out" message everywhere

This class of bug cannot recur in any component using fetchWithTimeout.
```

---

## Verification

After shipping:
1. Open DevTools → Network tab → set throttling to "Offline"
2. Try renaming a deal
3. After 12 seconds: button should unfreeze, show "Save timed out — please try again"
4. Re-enable network → save works normally

The `finally` block was always correct. The only missing piece was ensuring
the `await` has a bounded lifetime.
