# Clerk + Vercel Deployment Checklist

## ✅ Fixed: Sign-in page now uses Clerk component
- **Before**: Static HTML Stitch export with non-functional Google button
- **After**: Actual `<SignIn />` component from `@clerk/nextjs`

## Vercel Environment Variables (REQUIRED)

### 1. Go to Vercel → Your Project → Settings → Environment Variables

### 2. Add these for **Preview** AND **Production**:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_d2hvbGUtcmhpbm8tMzUuY2xlcmsuYWNjb3VudHMuZGV2JA
CLERK_SECRET_KEY=sk_test_T53oyxL8uuCJczOXDKIiYyE2HeNGjmO59lzyYEn2Ki
```

**CRITICAL**: Both Preview and Production environments need these. If you only set Production, your Preview deploys won't work.

### 3. Optional but recommended (if using custom sign-in URLs):

```bash
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/home
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/home
```

## Clerk Dashboard Configuration

### 1. Go to [Clerk Dashboard](https://dashboard.clerk.com)

### 2. Select your application: "whole-rhino-35"

### 3. Enable Google OAuth:
- Navigate to: **Configure → Social Connections**
- Toggle **Google** to ON
- If prompted, configure OAuth credentials (or use Clerk's shared credentials for testing)

### 4. Add Vercel domains to allowed redirect URLs:
- Navigate to: **Configure → Paths**
- Under **Authorized redirect URLs**, add:
  - `https://buddy-the-underwriter-*.vercel.app/*` (wildcard for preview deploys)
  - `https://your-production-domain.com/*` (when you have custom domain)

**Alternative (more precise)**:
- Add the exact preview URL you're testing:
  - `https://buddy-the-underwriter-hj920mmx5-mpalas-projects-a4dbbece.vercel.app/*`

### 5. Verify instance settings:
- Navigate to: **Configure → General**
- Ensure "Application URL" matches your deployment URL
- For multi-environment setup, you may want separate Clerk instances for dev/prod

## Testing After Deploy

1. Trigger new Vercel deploy:
```bash
git add -A
git commit -m "fix(auth): replace Stitch sign-in with Clerk component"
git push
```

2. Wait for deploy to complete

3. Visit deployed URL → `/sign-in`

4. You should now see:
   - ✅ Clerk's styled sign-in UI
   - ✅ "Continue with Google" button that DOES something
   - ✅ Network request to `accounts.clerk.com` when clicking Google
   - ✅ Redirect to Google OAuth consent screen

## If Still Not Working

### Check DevTools Console:
- Look for: `Clerk: Missing publishable key`
- Look for: Any CORS or network errors

### Check DevTools Network:
- Click "Continue with Google"
- Should see request to `clerk.*.clerk.accounts.dev` or similar
- If NO network request → env vars not loaded (redeploy needed)

### Verify env vars loaded:
Add temporary debug page:
```tsx
// src/app/debug-clerk/page.tsx
export default function DebugPage() {
  return (
    <pre>
      {JSON.stringify({
        publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.slice(0, 20) + '...',
        hasSecretKey: !!process.env.CLERK_SECRET_KEY
      }, null, 2)}
    </pre>
  );
}
```

## Production Checklist (Before Custom Domain)

- [ ] Vercel env vars set for Production
- [ ] Clerk instance has production domain in allowed URLs
- [ ] Consider switching to production Clerk instance (not test)
- [ ] Update publishable key from `pk_test_*` to `pk_live_*`

---

**Current Status**: Sign-in page fixed locally, ready for Vercel deployment test.
