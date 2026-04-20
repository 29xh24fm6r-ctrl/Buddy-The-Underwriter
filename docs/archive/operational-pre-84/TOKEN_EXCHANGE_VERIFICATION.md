# Token Exchange Integration - Verification Guide

## 🎯 What Was Implemented

Complete client-side integration for Clerk → Supabase JWT token exchange, making `auth.uid()` work in RLS.

### New Files Created

1. **[src/lib/auth/getSupabaseJwt.ts](../src/lib/auth/getSupabaseJwt.ts)** - Fetches Buddy-signed JWT from API
2. **[src/lib/supabase/browser.ts](../src/lib/supabase/browser.ts)** - Browser client with auto JWT injection
3. **[src/lib/supabase/server.ts](../src/lib/supabase/server.ts)** - Added `createSupabaseServerClient()` for Route Handlers
4. **[supabase/migrations/20251229000001_create_whoami_function.sql](../supabase/migrations/20251229000001_create_whoami_function.sql)** - SQL function for testing

### Updated Files

1. **[src/app/api/auth/supabase-jwt/route.ts](../src/app/api/auth/supabase-jwt/route.ts)** - Final token exchange implementation
2. **[.env.local](../.env.local)** - Added comment for SUPABASE_JWT_SECRET

---

## ✅ Pre-Flight Checklist

### 1. Database Migration

Apply both migrations:

```bash
# Migration 1: app_users and platform_admins tables
./scripts/apply-auth-migration.sh

# Migration 2: whoami function (manual - run in Supabase SQL Editor)
cat supabase/migrations/20251229000001_create_whoami_function.sql
# Copy and paste into Supabase Dashboard > SQL Editor > Run
```

### 2. Environment Variables

**Local (.env.local):**
```bash
# Already set:
✅ NEXT_PUBLIC_APP_URL=http://localhost:3000
✅ NEXT_PUBLIC_SUPABASE_URL=...
✅ NEXT_PUBLIC_SUPABASE_ANON_KEY=...
✅ SUPABASE_SERVICE_ROLE_KEY=...
✅ CLERK_SECRET_KEY=...
✅ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...

# TO ADD (from Supabase Dashboard > Settings > API > JWT Secret):
⚠️  SUPABASE_JWT_SECRET=your-jwt-secret-here
```

**Production (Vercel):**

Set in Vercel → Project → Settings → Environment Variables:
- All variables from above
- `NEXT_PUBLIC_APP_URL` = `https://your-app.vercel.app`

### 3. Get SUPABASE_JWT_SECRET

**Where to find it:**
1. Open [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Settings → API
4. Scroll to "JWT Settings"
5. Copy the **JWT Secret** value (long alphanumeric string)

**Add to .env.local:**
```bash
echo 'SUPABASE_JWT_SECRET=your-actual-secret-here' >> .env.local
```

---

## 🧪 Testing the Integration

### Test 1: Token Exchange Endpoint

**Start dev server:**
```bash
npm run dev
```

**Test token exchange (must be signed in via Clerk):**
```bash
# In browser console or curl (with valid Clerk session cookie):
curl http://localhost:3000/api/auth/supabase-jwt -H "Cookie: __session=..."
```

**Expected response:**
```json
{
  "token": "eyJ...long-jwt...",
  "buddyUserId": "123e4567-e89b-12d3-a456-426614174000"
}
```

**Troubleshooting:**
- `{"error": "unauthorized"}` → Not signed in via Clerk
- `{"error": "Missing env var: SUPABASE_JWT_SECRET"}` → Add JWT secret to .env.local
- `{"error": "failed_to_upsert_app_user"}` → Migration not applied

### Test 2: Verify auth.uid() Works

**In browser console (while signed in):**

```javascript
// Import the browser client
import { supabase } from '@/lib/supabase/browser';

// Call whoami() - should return your Buddy user ID
const { data, error } = await supabase.rpc('whoami');
console.log('whoami result:', data);
```

**Expected output:**
```json
{
  "uid": "123e4567-e89b-12d3-a456-426614174000",
  "role": "authenticated",
  "jwt_claims": {
    "sub": "123e4567-e89b-12d3-a456-426614174000",
    "role": "authenticated",
    "app_user_id": "123e4567-e89b-12d3-a456-426614174000",
    "clerk_user_id": "user_2abc123xyz",
    "email": "you@example.com"
  }
}
```

**What this proves:**
✅ Clerk session verified  
✅ `app_users` row created  
✅ JWT signed correctly  
✅ `auth.uid()` returns Buddy user UUID  
✅ RLS will work for this user  

### Test 3: RLS Query Test

**Create test query in Supabase SQL Editor:**

```sql
-- This should return rows only if auth.uid() is set
select 
  auth.uid() as my_user_id,
  count(*) as my_deal_count
from deals
where bank_id in (
  select bank_id 
  from bank_user_memberships 
  where user_id = auth.uid()
)
group by auth.uid();
```

Run this with the Buddy JWT (via browser client), should return results.

---

## 🔧 Make Yourself Platform Admin

**After signing up via /sign-up:**

1. **Find your app_user ID:**
   ```sql
   select id, clerk_user_id, email 
   from public.app_users 
   order by created_at desc 
   limit 5;
   ```

2. **Make yourself admin:**
   ```sql
   insert into public.platform_admins (user_id)
   values ('YOUR_APP_USERS_ID_FROM_ABOVE')
   on conflict (user_id) do nothing;
   ```

3. **Verify:**
   ```sql
   select 
     u.email,
     u.clerk_user_id,
     a.created_at as admin_since
   from public.app_users u
   join public.platform_admins a on a.user_id = u.id;
   ```

---

## 🎨 Usage Patterns

### Client Components

```typescript
// Import the browser client
import { supabase } from '@/lib/supabase/browser';

export function MyComponent() {
  const [deals, setDeals] = useState([]);
  
  useEffect(() => {
    async function loadDeals() {
      // Automatically includes Buddy JWT in Authorization header
      const { data } = await supabase.from('deals').select('*');
      setDeals(data ?? []);
    }
    loadDeals();
  }, []);
  
  return <div>...</div>;
}
```

### Server Components (App Router)

```typescript
// For most queries: use service role (bypasses RLS)
import { supabaseAdmin } from '@/lib/supabase/admin';

export default async function Page() {
  const sb = supabaseAdmin();
  const bankId = await getCurrentBankId();
  
  const { data } = await sb
    .from('deals')
    .select('*')
    .eq('bank_id', bankId);
  
  return <div>...</div>;
}
```

### Route Handlers (when you need RLS)

```typescript
// For queries where RLS should apply
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  
  // auth.uid() will be set to the requesting user's Buddy UUID
  const { data } = await supabase.from('deals').select('*');
  
  return Response.json(data);
}
```

---

## 🐛 Troubleshooting

### Issue: "Missing env var: SUPABASE_JWT_SECRET"

**Fix:**
```bash
# Get JWT secret from Supabase Dashboard > Settings > API
echo 'SUPABASE_JWT_SECRET=your-secret' >> .env.local
# Restart dev server
```

### Issue: auth.uid() returns null

**Debug steps:**

1. **Check token exchange works:**
   ```bash
   curl http://localhost:3000/api/auth/supabase-jwt
   # Should return {token, buddyUserId}
   ```

2. **Verify JWT is in request:**
   ```javascript
   // In browser console
   const token = await fetch('/api/auth/supabase-jwt').then(r => r.json());
   console.log('Token:', token);
   ```

3. **Test whoami():**
   ```javascript
   import { supabase } from '@/lib/supabase/browser';
   const result = await supabase.rpc('whoami');
   console.log('auth.uid():', result.data?.uid);
   ```

### Issue: app_users not being created

**Check migration applied:**
```sql
select * from public.app_users limit 1;
```

If table doesn't exist:
```bash
./scripts/apply-auth-migration.sh
```

### Issue: Token works but RLS still blocks

**Likely cause:** Row-level policy doesn't exist or references wrong user table.

**Check which tables have RLS enabled:**
```sql
select tablename, rowsecurity 
from pg_tables 
where schemaname = 'public' 
and rowsecurity = true;
```

**Remember:** Most Buddy tables use "deny-all" RLS and are accessed via `supabaseAdmin()`. Only specific tables need user-level RLS policies.

---

## 📊 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         User Flow                           │
└─────────────────────────────────────────────────────────────┘

1. User signs up/in via Clerk (/sign-up, /sign-in)
   ↓
2. Clerk issues session cookie
   ↓
3. Browser Supabase client calls /api/auth/supabase-jwt
   ↓
4. Token exchange route:
   - Verifies Clerk session
   - Upserts app_users by clerk_user_id
   - Signs JWT with sub = app_users.id
   - Returns JWT
   ↓
5. Browser client injects JWT in all Supabase requests
   ↓
6. Supabase RLS sees auth.uid() = app_users.id
   ↓
7. Queries work! 🎉
```

---

## 🚀 Next Steps

### Optional: Migrate bank_user_memberships

Currently `bank_user_memberships` might reference `auth.users(id)`.

To canonicalize:
```sql
-- Update FK to reference app_users instead
alter table bank_user_memberships 
  drop constraint if exists bank_user_memberships_user_id_fkey;

alter table bank_user_memberships
  add constraint bank_user_memberships_user_id_fkey
  foreign key (user_id) references public.app_users(id) on delete cascade;
```

Say **`CANONICALIZE MEMBERSHIPS`** to get the full migration.

### Optional: Client-side token refresh

Current implementation fetches JWT on every request. For better performance:

1. Cache JWT in memory with expiry check
2. Refresh proactively before expiry
3. Store in zustand for shared state

Example:
```typescript
// src/lib/auth/tokenStore.ts
let cachedToken: { token: string; expires: number } | null = null;

export async function getSupabaseJwt(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expires) {
    return cachedToken.token;
  }
  
  const res = await fetch('/api/auth/supabase-jwt');
  const { token } = await res.json();
  
  // JWT expires in 1 hour, refresh at 50 minutes
  cachedToken = { token, expires: Date.now() + 50 * 60 * 1000 };
  return token;
}
```

---

## ✅ Success Criteria

You know it's working when:

- ✅ `/sign-up` creates Clerk user
- ✅ `/api/auth/supabase-jwt` returns valid JWT
- ✅ `app_users` table has row for your Clerk user
- ✅ `whoami()` returns your Buddy UUID
- ✅ Browser Supabase queries work without errors
- ✅ `auth.uid()` is non-null in SQL queries

---

**Documentation:**
- [CLERK_AUTH_SETUP_COMPLETE.md](../CLERK_AUTH_SETUP_COMPLETE.md) - Initial setup
- [AUTH_QUICKSTART.md](../AUTH_QUICKSTART.md) - Quick reference

**Need help?** Run the verification script:
```bash
./scripts/verify-auth-setup.sh
```
