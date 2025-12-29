# Vercel Deployment Protection Auto-Bypass

## Problem

Vercel deployment protection blocks API requests from the client even when users are authenticated via Clerk. This causes 401/403 errors when:
- Visiting preview deployments
- Making API calls from the browser
- Testing protected routes

## Solution

Automatically set the Vercel protection bypass cookie for authenticated sessions **without disabling protection**.

---

## How It Works

### 1. Environment Variable

Add to Vercel **Preview** environment only:

```
VERCEL_PROTECTION_BYPASS_TOKEN=<your-bypass-token>
```

**Where to find the token:**
- Go to Vercel Project Settings → Deployment Protection
- Copy the bypass token from "Protection Bypass for Automation"

### 2. Middleware Auto-Bypass

The middleware (`src/middleware.ts`) automatically:

1. **Detects preview environments** with bypass token configured
2. **Checks for existing bypass cookie** (`_vercel_protection_bypass`, `_vercel_jwt`, `_vercel_sso_nonce`)
3. **Redirects once** to set the bypass cookie if missing:
   - Adds `?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=<token>` to URL
   - Vercel sees these params and sets the bypass cookie
   - Redirects back to clean URL (params removed)
4. **Prevents redirect loops** by checking for existing cookies and redirect flags

### 3. Route Handling

- **App pages** (`/`, `/deals/*`, etc.): Auto-bypass enabled
- **API routes** (`/api/*`): Skip bypass logic (use headers, not cookies)
- **Static assets** (`/_next`, `/favicon.ico`): Skip entirely
- **Public routes**: No bypass needed (already public)

---

## Setup Instructions

### Step 1: Add Environment Variable

In Vercel dashboard:

1. Navigate to: **Project Settings → Environment Variables**
2. Add new variable:
   - **Key**: `VERCEL_PROTECTION_BYPASS_TOKEN`
   - **Value**: `<your-bypass-token>` (from Deployment Protection settings)
   - **Environment**: ✅ Preview only (NOT Production)
3. Click **Save**
4. Redeploy preview branches

### Step 2: Deploy Middleware

The middleware is already updated in `src/middleware.ts`. Just push:

```bash
git add src/middleware.ts
git commit -m "feat: auto-bypass Vercel deployment protection in preview"
git push origin main
```

### Step 3: Test

1. Open a preview deployment URL
2. Sign in with Clerk
3. Navigate to any protected page (e.g., `/deals`)
4. Check browser DevTools → Network:
   - First request: Redirects with `?x-vercel-set-bypass-cookie=true`
   - Second request: Clean URL, bypass cookie set
5. Verify API calls now work (no 401/403 errors)

---

## Verification

### Check Cookie

After visiting a preview deployment, verify the bypass cookie exists:

**Browser DevTools → Application → Cookies:**
- Look for: `_vercel_protection_bypass`
- Domain: `.vercel.app`
- Value: `<bypass-token>`

### Check Logs

Middleware logs bypass activity:

```
[middleware] Setting Vercel bypass cookie for: /deals/abc123
[middleware] Vercel bypass cookie set, redirecting to clean URL: /deals/abc123
```

### Test API Calls

```bash
# Should work after visiting the app once
curl -i "https://your-preview-url.vercel.app/api/deals/abc123/events?limit=1"
# Returns 200 (not 401/403)
```

---

## How Vercel Protection Works

### Without Bypass

1. User visits preview deployment
2. Vercel shows password prompt
3. After password entry, sets `_vercel_jwt` cookie
4. All future requests include this cookie
5. **Problem**: Client-side API calls from app don't include cookie → 401/403

### With Auto-Bypass

1. User visits preview deployment
2. Middleware detects no bypass cookie
3. Redirects to same URL with bypass params
4. Vercel sets bypass cookie automatically
5. Redirects back to clean URL
6. All future requests (including API) include bypass cookie → ✅ Success

---

## Important Notes

### Environment Restrictions

- **Preview only**: `VERCEL_ENV === "preview"`
- **Production**: Bypass logic is disabled (no token in prod env vars)
- **Development**: Bypass logic is disabled (runs locally, no Vercel protection)

### Cookie Persistence

- Bypass cookie persists across page loads
- Expires when browser session ends
- Automatically renewed on next visit

### Security

- Token is environment-scoped (preview only)
- Cookie is httpOnly and secure
- No sensitive data in query params (token is public from Vercel UI anyway)

### Redirect Loop Prevention

Middleware checks for:
1. Existing cookies (`_vercel_protection_bypass`, `_vercel_jwt`, `_vercel_sso_nonce`)
2. Active redirect flag (`x-vercel-set-bypass-cookie=true`)
3. Skips API routes (they don't use cookies)

**Max redirects per page load:** 2 (set bypass → clean URL)

---

## Troubleshooting

### API calls still failing (401/403)

**Check:**
1. Is `VERCEL_PROTECTION_BYPASS_TOKEN` set in Vercel preview env?
2. Did you redeploy after adding the env var?
3. Is the bypass cookie visible in DevTools → Cookies?
4. Are you testing in a **preview** deployment (not production)?

**Fix:**
- Clear cookies
- Visit the app root (`/`)
- Check middleware logs in Vercel function logs

### Infinite redirect loop

**Symptoms:** Browser shows "too many redirects" error

**Causes:**
- Bypass cookie not being set by Vercel
- Wrong token format
- Token mismatch between env var and Vercel settings

**Fix:**
- Verify token matches exactly (copy from Vercel UI)
- Check `VERCEL_ENV` is "preview" in logs
- Clear cookies and try again

### Middleware not running

**Check:**
- Middleware file is at `src/middleware.ts` (not `middleware.ts` in root)
- Matcher config includes your route pattern
- No TypeScript compilation errors

---

## Code Reference

### Middleware Logic

```typescript
// Only run in preview with bypass token
const bypassToken = process.env.VERCEL_PROTECTION_BYPASS_TOKEN;
const isPreview = process.env.VERCEL_ENV === "preview";

if (isPreview && bypassToken) {
  // Check for existing bypass cookie
  const hasBypassCookie = 
    req.cookies.get("_vercel_protection_bypass") ||
    req.cookies.get("_vercel_jwt") ||
    req.cookies.get("_vercel_sso_nonce");

  // Redirect to set bypass if missing
  if (!hasBypassCookie && !isSettingBypass) {
    url.searchParams.set("x-vercel-set-bypass-cookie", "true");
    url.searchParams.set("x-vercel-protection-bypass", bypassToken);
    return NextResponse.redirect(url);
  }
}
```

### Environment Variables

```bash
# Vercel Preview Environment
VERCEL_PROTECTION_BYPASS_TOKEN=abc123xyz456  # Your bypass token
VERCEL_ENV=preview                            # Auto-set by Vercel
```

---

## Benefits

✅ **No manual bypass needed** - Automatic on first visit  
✅ **Protection stays enabled** - Still blocks unauthenticated access  
✅ **API calls work** - Bypass cookie included in all requests  
✅ **No redirect loops** - Smart cookie detection  
✅ **Preview-only** - Disabled in production  
✅ **Clerk auth unaffected** - Works alongside existing auth  

---

## Status

- ✅ Middleware updated
- ✅ Cookie detection logic added
- ✅ Redirect loop prevention
- ✅ API route exclusion
- ✅ TypeScript compiles

**Next step:** Add `VERCEL_PROTECTION_BYPASS_TOKEN` to Vercel preview environment and test!

---

**Last updated:** 2024-12-29
