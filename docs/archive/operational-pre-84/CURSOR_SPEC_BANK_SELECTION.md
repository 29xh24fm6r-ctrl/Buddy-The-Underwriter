# CURSOR SPEC ADD-ONS: Bank Selection System

## Overview

These add-ons complement the main auth fix by providing:
1. **SQL migration** for `user_banks` mapping table
2. **API endpoint** for bank selection
3. **Database queries** for tenant resolution

---

## ADD-ON 1: SQL Migration for `user_banks` Mapping

### Objective

Create a durable mapping between **Clerk users** and **banks/tenants** so tenant selection is:
- Deterministic on server
- Independent of Supabase Auth sessions
- Easy to query and index
- Enforces single default bank per user

### Migration File

**Location:** `migrations/user_banks_table.sql`

### What It Creates

1. **`user_banks` table** with columns:
   - `id` (UUID primary key)
   - `clerk_user_id` (TEXT, not null)
   - `bank_id` (UUID, foreign key to banks)
   - `is_default` (BOOLEAN, default false)
   - `created_at` (TIMESTAMPTZ)

2. **Performance indexes:**
   - `user_banks_clerk_user_id_idx` - Fast lookup by Clerk user
   - `user_banks_bank_id_idx` - Fast lookup by bank

3. **Constraint indexes:**
   - `user_banks_user_bank_unique` - Prevent duplicate mappings
   - `user_banks_one_default_per_user` - Enforce single default (partial unique index)

### How to Run

```bash
# Using psql
psql $DATABASE_URL < migrations/user_banks_table.sql

# Or in Supabase SQL Editor
# Copy/paste the contents of migrations/user_banks_table.sql
```

### Verification

```sql
-- Check table exists
SELECT COUNT(*) FROM user_banks;

-- Check indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'user_banks';
```

---

## ADD-ON 2: Bank Selection API + UI

### Objective

When a signed-in user has no bank set:
- Redirect to `/select-bank`
- Show available banks
- User selects → backend writes mapping
- Redirect to `/deals`

**No Supabase Auth used - everything uses Clerk.**

### Files Created/Modified

#### A) API: Bank Selection Endpoint (NEW)

**File:** `src/app/api/banks/select/route.ts`

**What it does:**
1. Validates Clerk authentication
2. Clears any existing default bank for user
3. Upserts user-bank mapping with `is_default = true`
4. Returns success/error

**Usage:**
```bash
POST /api/banks/select
Content-Type: application/json

{
  "bankId": "uuid-of-bank"
}
```

**Responses:**
- `200 OK` - `{ "ok": true }`
- `401` - Not authenticated
- `400` - Missing bankId
- `500` - Database error

#### B) API: List Banks (ALREADY EXISTS)

**File:** `src/app/api/banks/route.ts`

**Current behavior:**
- Returns banks where user has membership (from `bank_memberships`)
- Uses Clerk auth + Supabase admin client

**Alternative approach** (if you want to show all banks):
```typescript
// Get ALL banks for selection
const { data, error } = await sb
  .from("banks")
  .select("id, code, name")
  .order("name", { ascending: true });
```

#### C) UI Page: Bank Selection (ALREADY EXISTS)

**File:** `src/app/select-bank/page.tsx`

**Current behavior:**
- Fetches banks from `/api/banks`
- Shows dropdown selection
- POSTs to `/api/profile/bank` to save selection
- Redirects to `/deals`

**What to update** (optional - use new endpoint):

Change from:
```typescript
const res = await fetch("/api/profile/bank", {
  method: "POST",
  body: JSON.stringify({ bank_id: bankId }),
});
```

To:
```typescript
const res = await fetch("/api/banks/select", {
  method: "POST",
  body: JSON.stringify({ bankId }),
});
```

---

## Integration with getCurrentBankId()

### Current Implementation

**File:** `src/lib/tenant/getCurrentBankId.ts`

Currently queries `profiles.bank_id` and `bank_memberships`.

### Updated Query Pattern (Option A - using user_banks)

```typescript
// 1) Check user_banks for default bank
const { data, error } = await sb
  .from("user_banks")
  .select("bank_id")
  .eq("clerk_user_id", userId)
  .eq("is_default", true)
  .maybeSingle();

if (data?.bank_id) return data.bank_id;

// 2) If no default, get first membership
const { data: memberships } = await sb
  .from("user_banks")
  .select("bank_id")
  .eq("clerk_user_id", userId)
  .limit(1)
  .maybeSingle();

if (!memberships) throw new Error("no_memberships");
return memberships.bank_id;
```

### Updated Query Pattern (Option B - keep existing profiles)

**Keep current implementation** - it works with `profiles.bank_id` and `bank_memberships`.

The `user_banks` table is an **optional enhancement** for cleaner semantics around "default bank."

---

## Testing Checklist

### 1. Database Migration
- [ ] Run `migrations/user_banks_table.sql`
- [ ] Verify table exists: `SELECT COUNT(*) FROM user_banks;`
- [ ] Verify indexes created
- [ ] Test constraint: Try inserting duplicate `(clerk_user_id, bank_id)` → should fail

### 2. API Endpoint Testing

**Test bank listing:**
```bash
# Should return banks (with Clerk auth cookie)
curl -b cookies.txt http://localhost:3000/api/banks
```

**Test bank selection:**
```bash
# Should save bank selection
curl -X POST http://localhost:3000/api/banks/select \
  -H "Content-Type: application/json" \
  -H "Cookie: ..." \
  -d '{"bankId":"uuid-of-bank"}'
```

### 3. UI Flow Testing
- [ ] Sign in as user with no bank
- [ ] Visit `/deals` → should redirect to `/select-bank`
- [ ] See list of banks
- [ ] Select a bank → should save and redirect to `/deals`
- [ ] Hard refresh `/deals` → should stay on `/deals` (no loop)
- [ ] Check database: `SELECT * FROM user_banks WHERE clerk_user_id = 'user_...';`

### 4. Edge Cases
- [ ] User with no memberships → `/select-bank` shows "no banks available"
- [ ] User switches bank → previous default is cleared, new one is set
- [ ] User with multiple memberships → can select any

---

## Architecture Decisions

### Why separate `user_banks` table?

**Option A:** Store bank in `profiles.bank_id`
- ✅ Simple single query
- ❌ Can't track "all memberships" separately
- ❌ Harder to audit history

**Option B:** Use `user_banks` mapping table
- ✅ Clean separation of "user profile" vs "bank memberships"
- ✅ Can track multiple memberships
- ✅ Clear default semantics with partial unique index
- ✅ Easy to add metadata (role, permissions, etc.)
- ❌ Slightly more complex queries

**Recommendation:** Use `user_banks` if you plan to support:
- Users belonging to multiple banks
- Role-based access per bank
- Membership audit trails

Use `profiles.bank_id` if you have **strictly one bank per user forever**.

### Why `/api/banks/select` instead of `/api/profile/bank`?

**New endpoint benefits:**
- Clear intent: "selecting a bank" vs "updating profile"
- Can add bank-specific logic (validation, permissions)
- Separates concerns (user profile vs bank membership)

**Existing endpoint works too:**
- If your `profiles` table approach works, keep it
- Just ensure it uses Clerk auth + admin client (already done)

---

## File Summary

### Created
- ✅ `src/app/api/banks/select/route.ts` - Bank selection endpoint
- ✅ `migrations/user_banks_table.sql` - Database migration

### Already Exists (from main auth fix)
- ✅ `src/app/api/banks/route.ts` - List banks (modified to use Clerk)
- ✅ `src/app/api/profile/bank/route.ts` - Update profile bank (modified to use Clerk)
- ✅ `src/app/select-bank/page.tsx` - Bank selection UI
- ✅ `src/lib/tenant/getCurrentBankId.ts` - Tenant resolution (modified to use Clerk)

---

## Environment Variables

**No new env vars required** - everything uses:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## Success Criteria

✅ Database migration runs without errors
✅ User can select bank from `/select-bank` page
✅ Selection is persisted in database
✅ `/deals` loads successfully after selection
✅ Hard refresh doesn't cause redirect loops
✅ No Supabase Auth dependencies in any code path

---

## Optional Enhancement: StitchFrame `/select-bank`

If you want the bank selection page to match your Buddy Enterprise aesthetic using StitchFrame, we can create a Stitch-style version with:
- Material Icons helm controls
- Starship Enterprise command center vibe
- Animated background gradients
- Same functionality, better aesthetics

Say the word and I'll output the StitchFrame version! 🚀

---

**Status:** ✅ READY TO IMPLEMENT

**Next Steps:**
1. Run database migration
2. Test `/api/banks/select` endpoint
3. Verify bank selection flow
4. Deploy!
