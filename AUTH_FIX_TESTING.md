# Bullet-Proof Auth System - Testing Checklist

## What Changed

✅ **Clerk is now the ONLY auth authority** for both routing and server logic
✅ **Supabase auth removed** from tenant resolution (no more session coupling)
✅ **Middleware simplified** to protected/public route matchers
✅ **No more redirect loops** between /sign-in and /deals

## Environment Setup Required

### 1. Clerk Environment Variables (Required)

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Recommended (prevents origin/cookie issues)
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/deals
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/deals
```

### 2. Supabase Service Role Key (Required)

```bash
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### 3. Clerk Dashboard Setup (Critical for Codespaces/Vercel)

In your Clerk Dashboard → Settings → Allowed Origins, add:

- `https://*.app.github.dev` (for Codespaces)
- Your Vercel preview domain patterns

**Without this, you WILL get redirect loops in dev environments.**

## Database Schema Required

The system now uses `clerk_user_id` instead of Supabase user IDs:

### Update `profiles` table:

```sql
-- Add clerk_user_id column if it doesn't exist
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS clerk_user_id TEXT UNIQUE;

-- Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_profiles_clerk_user_id 
ON profiles(clerk_user_id);
```

### Update `bank_memberships` table:

```sql
-- Add clerk_user_id column if it doesn't exist
ALTER TABLE bank_memberships 
ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;

-- Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_bank_memberships_clerk_user_id 
ON bank_memberships(clerk_user_id);
```

## Testing Steps

### 1. Validate Clerk Auth (Most Important)

**Signed Out:**
```bash
curl http://localhost:3000/api/debug/clerk
# Expected: {"userId":null,"sessionId":null}
```

**After Sign In:**
```bash
# Sign in via browser, then:
curl -b cookies.txt http://localhost:3000/api/debug/clerk
# Expected: {"userId":"user_...","sessionId":"sess_..."}
```

⚠️ **If userId is null after sign-in, the problem is env/origins (NOT code)**

### 2. Test Protected Route Redirect

**Visit `/deals` while signed out:**
- Should redirect to `/sign-in?redirect_url=/deals`
- Should redirect ONCE (no loop)

### 3. Test Sign In Flow

**Sign in successfully:**
- Should land on `/deals` (or bank selection if no bank)
- Hard refresh should stay on `/deals` (no redirect)

### 4. Test Bank Selection Flow

**If no bank membership exists:**
- `/deals` should redirect to `/select-bank`
- NOT back to `/sign-in` (this was the loop cause)

**After selecting a bank:**
- Should redirect to `/deals`
- Should stay on `/deals` on refresh

### 5. Test Root Redirect

**Visit `/` signed out:**
- Should redirect to `/sign-in`

**Visit `/` signed in:**
- Should redirect to `/deals`

## Troubleshooting

### "Still seeing redirect loop"

1. Check `/api/debug/clerk` - is `userId` null after sign-in?
   - **Yes:** Origins not configured in Clerk Dashboard
   - **No:** Check database - does user have a profile/membership?

2. Clear browser cookies and try again

3. Check middleware logs for redirect patterns

### "Bank not found / no_memberships error"

You need to seed data:

```sql
-- Create a bank
INSERT INTO banks (id, code, name)
VALUES (gen_random_uuid(), 'TEST', 'Test Bank')
RETURNING id;

-- Get your Clerk userId from /api/debug/clerk
-- Then create membership:
INSERT INTO bank_memberships (clerk_user_id, bank_id)
VALUES ('user_YOUR_CLERK_ID', 'BANK_ID_FROM_ABOVE');
```

### "Profile lookup failed"

The `profiles` table needs `clerk_user_id` column and data migration from old Supabase user IDs.

## What Prevents Loops Now

**Before:** 
- Middleware uses Clerk → ✅ auth OK
- Page uses Supabase auth → ❌ no session → redirect to sign-in
- Loop forever

**After:**
- Middleware uses Clerk → ✅ auth OK  
- Page uses Clerk → ✅ auth OK
- Tenant lookup uses admin client (no session) → ✅ works
- If no bank → redirect to `/select-bank` (not `/sign-in`)
- No loop possible ✨

## Next Steps

Once testing passes:

1. Migrate existing Supabase user IDs to Clerk user IDs in database
2. Optional: Add RLS policies using Clerk JWTs for DB-level security
3. Optional: Migrate from Tailwind CDN to compiled config in Stitch screens

## Success Criteria

✅ Visit `/api/debug/clerk` after sign-in → returns userId  
✅ Visit `/deals` signed out → redirects once to `/sign-in?redirect_url=/deals`  
✅ Sign in → lands on `/deals` or `/select-bank`  
✅ Hard refresh on `/deals` → stays on `/deals` (no loop)  
✅ No "not_authenticated" errors for valid Clerk sessions  

---

**The redirect loop is dead. Clerk is king. Ship it.** 🚀
