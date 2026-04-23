# Spec CLERK-DEPRECATION — Replace `afterSignInUrl` Prop

**Date:** 2026-04-23
**Owner:** Matt
**Executor:** Claude Code
**Estimated effort:** 20–30 minutes if the culprit is found in first grep; up to 60 if it requires Vercel env inspection
**Risk:** Very low. Cosmetic cleanup. Removes one browser console warning. Zero functional change.

---

## Summary

Since before the OMEGA-REPAIR arc, Clerk has been emitting a browser console warning on every authenticated page load:

```
Clerk: The prop "afterSignInUrl" is deprecated and should be replaced with the new
"fallbackRedirectUrl" or "forceRedirectUrl" props instead.
Learn more: https://clerk.com/docs/guides/custom-redirects#redirect-url-props
```

The page works correctly; the redirect happens; the user experience is unaffected. But the warning is real noise that makes other warnings harder to see, and it will become a hard error in a future Clerk SDK major version.

This spec finds the culprit and fixes it.

## Known clean files (per Claude's pre-spec audit 2026-04-23)

These paths were read and confirmed to NOT pass `afterSignInUrl`:

- `src/app/layout.tsx` — root layout, clean
- `src/app/ClerkGate.tsx` — `<ClerkProvider publishableKey={pk}>` only, no URL props
- `src/app/sign-in/[[...sign-in]]/page.tsx` — `<SignIn />` with no props
- `src/app/sign-up/[[...sign-up]]/page.tsx` — `<SignUp />` with no props
- `src/proxy.ts` — `clerkMiddleware(async (auth, req) => {...})` — callback only, no options object

## Where the prop probably lives

Three candidates, in order of likelihood:

### (a) A Vercel env var being auto-consumed by Clerk

Clerk's Next.js SDK auto-reads several env vars. The deprecated name is:

```
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL
```

The replacement names are:

```
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL
NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL
NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL
```

If `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` or `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` is set in Vercel, the SDK consumes them and emits the deprecation warning on every page load.

### (b) A `<ClerkProvider>` / `<SignIn>` / `<SignUp>` instance passing the prop explicitly

Claude's partial audit covered the obvious routes but not every React component in the tree. There could be a custom auth flow component, a sandbox/demo page, or a stitched-together onboarding screen that passes `afterSignInUrl={...}` directly.

### (c) A UserButton or organization-switcher component

`<UserButton afterSignOutUrl>` and similar org-related components have their own deprecation paths. Less likely given the exact warning string mentions `afterSignInUrl` specifically.

## Implementation

### Step 1 — Codebase grep

```bash
# From repo root
grep -rn "afterSignInUrl\|afterSignUpUrl\|afterSignOutUrl" src/ --include="*.ts" --include="*.tsx"
grep -rn "AFTER_SIGN_IN_URL\|AFTER_SIGN_UP_URL" src/ --include="*.ts" --include="*.tsx" .env.example
```

Record every hit. For each hit:
- If it's a JSX prop → replace per step 3
- If it's an env var reference in code → update the variable name AND update the consumption
- If it's in a doc/comment → update the text

### Step 2 — Vercel env inspection

```bash
npx vercel env ls --yes production | grep -i 'clerk'
```

Look specifically for `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` or `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`.

**If found:** note the value (don't paste it anywhere, just remember the intent — e.g., "/dashboard" vs "/onboarding"). Surface to Matt with:

> "Found `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=<value>` in Vercel. Proposing: remove this var and replace with `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=<same value>` (fallback = only used when no redirect_url search param is present, which matches `afterSignInUrl` semantics). Approve?"

Wait for Matt's approval before modifying Vercel env. Do not guess between `FALLBACK` and `FORCE` — they have different semantics:
- **FALLBACK_REDIRECT_URL** = used only if no `redirect_url` search param is set. Matches `afterSignInUrl` behavior.
- **FORCE_REDIRECT_URL** = always used, overrides any `redirect_url` search param. Different behavior, could break existing flows.

Default to FALLBACK unless Matt specifies otherwise.

### Step 3 — Prop replacement (if grep finds JSX usage)

For each component using the deprecated prop, replace as follows:

**Before:**
```tsx
<SignIn afterSignInUrl="/dashboard" />
```

**After:**
```tsx
<SignIn fallbackRedirectUrl="/dashboard" />
```

**Before:**
```tsx
<ClerkProvider afterSignInUrl="/dashboard" afterSignUpUrl="/onboarding">
```

**After:**
```tsx
<ClerkProvider
  signInFallbackRedirectUrl="/dashboard"
  signUpFallbackRedirectUrl="/onboarding"
>
```

Note the ClerkProvider prop names differ slightly from SignIn/SignUp — they're prefixed with `signIn` / `signUp`.

### Step 4 — Verify

After the fix:

```bash
# Rebuild confirms no TypeScript errors
npm run typecheck  # or tsc --noEmit
```

Then deploy. After deploy:

1. Open `/deals/e505cd1c-86b4-4d73-88e3-bc71ef342d94/cockpit` in a fresh browser tab.
2. DevTools → Console.
3. Filter for `Clerk`.
4. Expected: the `afterSignInUrl is deprecated` warning is gone.

## Non-goals

- Not refactoring the sign-in/sign-up flow beyond the prop rename.
- Not addressing any other Clerk warnings (if present).
- Not migrating to Clerk's newer "Sessions" API or any unrelated Clerk feature.
- Not touching `clerkMiddleware` — already uses the correct pattern.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Renaming the env var changes post-sign-in redirect destination | Low | FALLBACK vs FORCE semantics noted explicitly; default to FALLBACK (matches old behavior) |
| `grep` turns up nothing and warning persists | Low | Step 2 (Vercel env) catches this case; if both steps empty, stop and surface — warning source is elsewhere |
| Dead `.stitch-backup` file contains the prop | Very low | Backup files are ignored by Next.js build; skip unless they're imported anywhere |

## Hand-off

Execute. Single commit. Small diff. If the grep returns no hits in JSX and no hits in Vercel env, stop and surface — the warning source is somewhere I didn't anticipate (possibly in `node_modules` config or a Clerk dashboard setting), and we'd need to look harder.
