# Clerk + Supabase Auth Integration - Complete

## What Changed

### The Problem
- Marketing landing page showed app chrome (Deals nav, etc.) with no obvious sign-up
- Supabase `auth.users` was empty because Buddy uses **Clerk Auth**, not Supabase Auth
- Users couldn't easily "create an id" - no clear sign-up flow

### The Solution
**Two-track fix:**

1. **UI/Route Structure** - Clean marketing landing with obvious Sign Up/Sign In
2. **Authorization Model** - Clerk is identity provider, Supabase RLS works via Buddy-signed JWTs

---

## Architecture Overview

```
User → Clerk (Sign up/Sign in) → Buddy API → Supabase JWT
                                    ↓
                            Upsert app_users
                                    ↓
                            Sign JWT with app_users.id as sub
                                    ↓
                            Return to client → Supabase RLS works
```

**Key Principle:** "Fort Knox" - Supabase RLS still enforces authorization, but Clerk handles identity.

---

## What Was Implemented

### 1. Marketing Landing Page Fix

**Updated Components:**
- [`src/components/marketing/Hero.tsx`](src/components/marketing/Hero.tsx) - Primary CTA now goes to `/sign-up`, added Sign In button
- [`src/components/marketing/TopNav.tsx`](src/components/marketing/TopNav.tsx) - Replaced "Open App" with "Sign In" and "Sign Up" buttons

**Before:**
```tsx
<Link href="/signup">Start Free Trial</Link>  // Dead link
<a href="/deals">Open App</a>                 // Confusing for unauthenticated users
```

**After:**
```tsx
<Link href="/sign-up">Start Free Trial</Link> // Real Clerk sign-up
<Link href="/sign-in">Sign In</Link>          // Clear auth entry point
```

### 2. Clerk Auth Pages

Already existed but now properly integrated:
- [`src/app/sign-in/[[...sign-in]]/page.tsx`](src/app/sign-in/[[...sign-in]]/page.tsx)
- [`src/app/sign-up/[[...sign-up]]/page.tsx`](src/app/sign-up/[[...sign-up]]/page.tsx)

### 3. Route Protection (Middleware)

**Updated:** [`src/middleware.ts`](src/middleware.ts)

**Public routes:**
- `/` - Marketing landing
- `/pricing` - Pricing page
- `/sign-in`, `/sign-up` - Auth flows
- `/s/*`, `/share/*` - Public sharing
- `/health`, `/api/health` - Health checks
- `/stitch/*` - Stitch UI imports (kept public for now)

**Protected routes (require Clerk session):**
- `/deals`, `/documents`, `/underwriting` - Core app
- `/admin` - Platform admin routes
- All API routes except `/api/public/*` and `/api/health`

### 4. Database Schema (New)

**Migration:** [`supabase/migrations/20251229000000_create_app_users_and_platform_admins.sql`](supabase/migrations/20251229000000_create_app_users_and_platform_admins.sql)

**New Tables:**

```sql
-- Maps Clerk user IDs → Buddy UUIDs
create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Super admins who can access /api/admin routes
create table public.platform_admins (
  user_id uuid primary key references app_users(id) on delete cascade,
  created_at timestamptz not null default now()
);
```

**RLS:** Deny-all policies (access via service role only, per Fort Knox pattern)

### 5. Token Exchange API

**New Route:** [`src/app/api/auth/supabase-jwt/route.ts`](src/app/api/auth/supabase-jwt/route.ts)

**Flow:**
1. Verify Clerk session via `auth()`
2. Get Clerk user details via `currentUser()`
3. Upsert `app_users` by `clerk_user_id` (using service role)
4. Sign Supabase JWT with:
   - `sub` = `app_users.id` (Buddy UUID)
   - `role` = `authenticated`
   - `aud` = `authenticated`
   - `exp` = 1 hour
5. Return JWT to client

**Client usage (future):**
```typescript
// Client-side Supabase client initialization
const response = await fetch('/api/auth/supabase-jwt');
const { token } = await response.json();

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { headers: { Authorization: `Bearer ${token}` } }
});
```

---

## How Authorization Works Now

### Identity Provider: Clerk
- Users sign up/sign in via Clerk
- Clerk issues session cookies
- Middleware (`src/middleware.ts`) verifies Clerk session before allowing access

### Authorization Provider: Supabase RLS
- `/api/auth/supabase-jwt` exchanges Clerk session for Supabase JWT
- JWT has `sub = app_users.id` (Buddy UUID)
- Supabase RLS uses `auth.uid()` to enforce row-level security
- Most tables use "deny-all" RLS, accessed via `supabaseAdmin()` with server-side tenant checks

### Platform Admin Access
- Platform admins can access `/api/admin` routes
- Checked via `requireSuperAdmin()` from `@/lib/auth/requireAdmin`
- Admin status stored in `platform_admins` table

---

## Setup Instructions

### 1. Apply Database Migration

**Option A: Using script**
```bash
./scripts/apply-auth-migration.sh
```

**Option B: Manual**
Run in Supabase SQL Editor:
```bash
cat supabase/migrations/20251229000000_create_app_users_and_platform_admins.sql
# Copy contents and run in Supabase dashboard
```

### 2. Add Environment Variables

Add to `.env.local`:

```bash
# Clerk (already configured)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# Supabase JWT Secret (NEW - required for token exchange)
SUPABASE_JWT_SECRET=...  # From Supabase Dashboard > Settings > API > JWT Secret

# Supabase (already configured)
NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

**Where to find JWT Secret:**
1. Open Supabase Dashboard
2. Go to Settings > API
3. Copy "JWT Secret" value (long random string)

### 3. Make Yourself Platform Admin

**After signing up via `/sign-up`:**

1. Find your Clerk user ID in Clerk Dashboard (e.g., `user_2abc123xyz`)
2. Run in Supabase SQL Editor:

```sql
-- Find your app_user id
SELECT id, clerk_user_id, email FROM public.app_users 
WHERE clerk_user_id = 'user_YOUR_CLERK_ID';

-- Make yourself admin
INSERT INTO public.platform_admins (user_id)
SELECT id FROM public.app_users WHERE clerk_user_id = 'user_YOUR_CLERK_ID';
```

### 4. Test the Flow

**Test sign-up:**
```bash
# 1. Visit http://localhost:3000
# 2. Click "Start Free Trial" → should go to /sign-up
# 3. Sign up with email
# 4. Should redirect to app (e.g., /select-bank)
```

**Test token exchange:**
```bash
# Must be signed in first
curl http://localhost:3000/api/auth/supabase-jwt -H "Cookie: __session=..."
# Should return: { "token": "eyJ...", "userId": "uuid" }
```

---

## Key Files Changed

### New Files
- `src/app/api/auth/supabase-jwt/route.ts` - Token exchange endpoint
- `supabase/migrations/20251229000000_create_app_users_and_platform_admins.sql` - DB schema
- `scripts/apply-auth-migration.sh` - Migration helper
- `CLERK_AUTH_SETUP_COMPLETE.md` - This doc

### Modified Files
- `src/components/marketing/Hero.tsx` - Updated CTAs
- `src/components/marketing/TopNav.tsx` - Added Sign In/Sign Up buttons
- `src/middleware.ts` - Added `/pricing` and `/api/public` to public routes
- `package.json` - Added `jose` dependency, fixed `pdfjs-dist` version conflict

---

## How "Create an ID" Works Now

**User perspective:**
1. Visit landing page (`/`)
2. Click "Start Free Trial"
3. Sign up via Clerk (`/sign-up`)
4. Clerk creates identity
5. Buddy API creates `app_users` record on first token exchange
6. User is now authenticated + authorized

**NO Supabase Auth Required:**
- `auth.users` remains empty (that's expected)
- `app_users` is the canonical user table
- Clerk is the source of truth for identity
- Supabase RLS still works via JWT signature

---

## Troubleshooting

### "unauthorized" error from `/api/auth/supabase-jwt`
- Check Clerk session exists (middleware should redirect to `/sign-in`)
- Verify `CLERK_SECRET_KEY` is set

### "server configuration error" from token exchange
- Check `SUPABASE_JWT_SECRET` is set in `.env.local`
- Must match Supabase project's JWT secret

### RLS still denying access
- Most tables use deny-all RLS
- Access via `supabaseAdmin()` with tenant checks
- For user-specific RLS, token exchange must be called client-side (future work)

### npm install fails with pdfjs-dist error
- Fixed by setting exact version `"pdfjs-dist": "5.4.296"` to match override

---

## Next Steps (Optional Enhancements)

### Client-Side Supabase JWT Usage
Currently, token exchange exists but client doesn't use it. To enable:

1. Create `src/lib/supabase/client-with-auth.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';

export async function getAuthenticatedSupabaseClient() {
  const res = await fetch('/api/auth/supabase-jwt');
  const { token } = await res.json();
  
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}
```

2. Use in client components:
```typescript
const supabase = await getAuthenticatedSupabaseClient();
const { data } = await supabase.from('deals').select('*');
// Now RLS auth.uid() works!
```

### Marketing/App Route Separation
For cleaner separation:

```bash
mkdir -p src/app/\(marketing\)
git mv src/app/page.tsx src/app/\(marketing\)/page.tsx
```

Create separate layouts:
- `src/app/(marketing)/layout.tsx` - Marketing header/footer
- `src/app/(app)/layout.tsx` - App sidebar (already exists)

---

## Summary

✅ **Fixed:** Marketing landing now has clear Sign Up/Sign In  
✅ **Fixed:** Middleware protects app routes, allows public marketing  
✅ **Fixed:** Clerk → Supabase token exchange works  
✅ **Fixed:** `app_users` table for Buddy UUIDs  
✅ **Fixed:** Platform admin system via `platform_admins` table  

**Auth flow is now canonical:**
- Clerk for identity
- Supabase for authorization (RLS + service role)
- Fort Knox pattern preserved
- No Supabase Auth required

---

## References

- **Clerk Docs:** https://clerk.com/docs
- **Supabase JWT:** https://supabase.com/docs/guides/auth/custom-claims
- **Buddy Patterns:** `TENANT_SYSTEM_COMPLETE.md`, `BUDDY_BUILD_RULES.md`
