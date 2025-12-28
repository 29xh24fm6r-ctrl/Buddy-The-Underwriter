# Deal Naming Schema Fix

## Problem
```
Could not find the `borrower_name` column of `deals` in the schema cache
```

The code was trying to insert into `deals.name`, `deals.borrower_name`, `deals.stage`, etc., but these columns didn't exist in the Supabase schema.

## Solution

### 1. Run the Migration in Supabase

Go to **Supabase Dashboard → SQL Editor** and run:

```sql
/workspaces/Buddy-The-Underwriter/supabase/migrations/20251228_add_deal_naming_fields.sql
```

Or copy/paste the contents of that file.

### 2. Refresh Supabase Schema Cache

**Critical**: After running the migration, refresh the schema cache:

- Supabase Dashboard → **Database** → **API** → Click **Reload schema** button

Without this, PostgREST won't know about the new columns and you'll still see cache errors.

### 3. Deploy (Automatic)

The code changes are backward-compatible and will work once the schema is updated.

## What the Migration Does

- Adds `name` (text) - primary deal identifier
- Adds `borrower_name` (text) - borrower/entity name
- Adds `stage` (text) - deal pipeline stage
- Adds `entity_type` (text) - business entity type
- Adds `risk_score` (int) - risk assessment score
- Adds `created_at`, `updated_at` timestamps
- Ensures `deals.id` has UUID default
- Backfills existing rows with sensible defaults
- Adds indexes for performance

## Code Changes

Updated `/api/deals` POST route to:
- Build insert payload dynamically
- Handle schemas that may not have all columns yet
- Use `name` as fallback for `borrower_name`

## Testing After Migration

1. Run migration + refresh schema cache
2. Go to `/deals/new`
3. Enter deal name
4. Upload files
5. Should succeed without schema cache errors
6. Deal should appear in `/deals` list with the name

## Files Changed

- `supabase/migrations/20251228_add_deal_naming_fields.sql` (new)
- `src/app/api/deals/route.ts` (updated to be defensive)
- `DEAL_NAMING_SCHEMA_FIX.md` (this file)
