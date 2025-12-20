# Schema-Agnostic Deal Display ✅

## What Changed

Upgraded from hardcoded column lookups to **runtime schema introspection** via PostgreSQL RPC.

### Problem Solved
**Before:** Hardcoded columns like `deals.name`, `deals.borrower_name` would fail if your schema uses different names.

**After:** Database function auto-discovers correct tables + columns at runtime.

---

## Files Modified

### 1. Database Migration (NEW)
✅ [supabase/migrations/20251220_deal_display_lookup.sql](supabase/migrations/20251220_deal_display_lookup.sql)

**What it does:**
- Creates `public.deal_display_lookup(deal_ids uuid[])` function
- Returns `{deal_id, deal_name, borrower_name}` for any deal IDs
- **Auto-discovers** the correct schema:

**Deal table candidates (first match wins):**
- `public.deals`
- `public.crm_deals`
- `public.loan_deals`

**Deal name column candidates:**
- `name`
- `deal_name`
- `title`

**Borrower name strategies:**
1. **Direct column on deal table:**
   - `borrower_name`
   - `primary_borrower_name`
   - `borrower_display`
   - `borrower`

2. **Join to borrower table (if `borrower_id` exists):**
   - Looks for: `borrowers`, `crm_contacts`, `contacts`, `people` tables
   - Picks name column: `name`, `full_name`, `display_name`, `legal_name`

**Fallback behavior:**
- If no table/column found → returns `NULL` (no crashes)
- Soft-fails gracefully on schema mismatch

---

### 2. Chat Library (UPDATED)
✅ [src/lib/deals/chat.ts](src/lib/deals/chat.ts)

**Changed:**
```typescript
// OLD: Hardcoded SELECT with all possible columns
const { data } = await sb
  .from("deals")
  .select("id,name,deal_name,title,borrower_name,primary_borrower_name,borrower_display,borrower")
  .in("id", dealIds);

// NEW: RPC call that discovers schema dynamically
const { data } = await sb.rpc("deal_display_lookup", { deal_ids: dealIds });
```

**Result:**
- `bankerListMessageThreads()` now gets display names via RPC
- Returns `{dealName, borrowerName}` based on **actual schema**, not guesses

---

### 3. UI Component (NO CHANGE)
✅ [src/components/banker/BankerMessagesInbox.tsx](src/components/banker/BankerMessagesInbox.tsx)

Already displays `dealName` + `borrowerName` with fallbacks:
- Deal: Shows `dealName` or `Deal {id…}`
- Borrower: Shows `borrowerName` or `"Borrower"`

---

## Deployment

### Run Migration

```bash
# Option A: Supabase CLI
supabase db push

# Option B: Direct SQL
psql $DATABASE_URL < supabase/migrations/20251220_deal_display_lookup.sql
```

**Verifies:**
```sql
-- Check function exists
SELECT proname FROM pg_proc WHERE proname = 'deal_display_lookup';
-- Should return: deal_display_lookup

-- Test it (replace with actual deal IDs)
SELECT * FROM public.deal_display_lookup(
  ARRAY['your-deal-id-1'::uuid, 'your-deal-id-2'::uuid]
);
-- Should return rows with deal_id, deal_name, borrower_name
```

---

## How It Works

### Example 1: Standard Schema (`deals` table with `name` column)

**Your schema:**
```sql
CREATE TABLE deals (
  id uuid PRIMARY KEY,
  name text,
  borrower_name text
);
```

**Function discovers:**
- ✅ Table: `deals`
- ✅ Deal name: `name` column
- ✅ Borrower: `borrower_name` column

**Query built:**
```sql
SELECT d.id as deal_id, d.name::text as deal_name, d.borrower_name::text as borrower_name
FROM public.deals d
WHERE d.id = ANY($1)
```

---

### Example 2: CRM Schema (different table/column names)

**Your schema:**
```sql
CREATE TABLE crm_deals (
  id uuid PRIMARY KEY,
  title text,
  borrower_id uuid REFERENCES crm_contacts(id)
);

CREATE TABLE crm_contacts (
  id uuid PRIMARY KEY,
  full_name text
);
```

**Function discovers:**
- ✅ Table: `crm_deals` (deals didn't exist)
- ✅ Deal name: `title` column (name/deal_name didn't exist)
- ✅ Borrower: JOIN to `crm_contacts.full_name` via `borrower_id`

**Query built:**
```sql
SELECT d.id as deal_id, d.title::text as deal_name, b.full_name::text as borrower_name
FROM public.crm_deals d
LEFT JOIN public.crm_contacts b ON b.id = d.borrower_id
WHERE d.id = ANY($1)
```

---

### Example 3: Minimal Schema (no fancy names)

**Your schema:**
```sql
CREATE TABLE loan_deals (
  id uuid PRIMARY KEY,
  deal_name text
);
-- No borrower name anywhere
```

**Function discovers:**
- ✅ Table: `loan_deals`
- ✅ Deal name: `deal_name` column
- ❌ Borrower: nothing found

**Query built:**
```sql
SELECT d.id as deal_id, d.deal_name::text as deal_name, NULL::text as borrower_name
FROM public.loan_deals d
WHERE d.id = ANY($1)
```

**UI shows:**
- Deal name: "Acme Corp Loan" (from `deal_name`)
- Borrower: "Borrower" (fallback, since NULL)

---

## Testing

### Test Function Directly

```sql
-- Insert test data
INSERT INTO deals (id, name, borrower_name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Test Deal', 'John Doe');

-- Call function
SELECT * FROM public.deal_display_lookup(
  ARRAY['00000000-0000-0000-0000-000000000001'::uuid]
);

-- Expected output:
-- deal_id                               | deal_name  | borrower_name
-- 00000000-0000-0000-0000-000000000001  | Test Deal  | John Doe
```

### Test via Banker Inbox

1. **Open banker Messages Inbox** (component should already be wired)
2. **Send test message** as borrower to create thread
3. **Banker views inbox** → should see:
   - Title: Deal name (or `Deal {id…}` if name column missing)
   - Subtitle: Borrower name (or "Borrower" if not found)
4. **Verify no errors** in console (function soft-fails on schema mismatch)

---

## Benefits

### ✅ No More Schema Guessing
Function tries **common patterns** across multiple naming conventions:
- `deals` vs `crm_deals` vs `loan_deals`
- `name` vs `deal_name` vs `title`
- `borrower_name` direct vs `borrower_id` join

### ✅ Graceful Degradation
- Missing table? Returns nothing (no crash)
- Missing column? Returns NULL (UI shows fallback)
- Schema changes? Automatically picks up new columns

### ✅ Future-Proof
Add new patterns by editing the SQL function once:
```sql
-- Add new deal table candidate
IF deal_table IS NULL THEN
  deal_table := to_regclass('public.opportunities'); -- NEW
END IF;

-- Add new name column candidate
ELSIF EXISTS (...column_name = 'display_title') THEN -- NEW
  deal_name_col := 'display_title';
```

---

## What You Get

### Before (Hardcoded)
```
Thread List:
❌ Deal: 12ab34cd… (just ID, confusing)
❌ Borrower: (not shown)
```

### After (Schema-Agnostic RPC)
```
Thread List:
✅ Acme Corp - $500K Term Loan (meaningful deal name)
✅ John Smith (borrower name)
✅ Deal: 12ab34cd… (fallback if columns missing)
```

---

## Advanced: Add Formatted Display Label

Want a single "display label" like `"John Smith — Acme Corp"`?

**Add to SQL function:**
```sql
RETURNS TABLE (
  deal_id uuid,
  deal_name text,
  borrower_name text,
  display_label text  -- NEW
)

-- In query building section:
sql := sql || 'CASE ';
sql := sql || 'WHEN borrower_name IS NOT NULL AND deal_name IS NOT NULL ';
sql := sql || 'THEN borrower_name || '' — '' || deal_name ';
sql := sql || 'WHEN borrower_name IS NOT NULL THEN borrower_name ';
sql := sql || 'WHEN deal_name IS NOT NULL THEN deal_name ';
sql := sql || 'ELSE ''Deal '' || LEFT(d.id::text, 8) || ''…'' ';
sql := sql || 'END as display_label ';
```

**Use in UI:**
```tsx
<div className="text-sm font-semibold">
  {t.displayLabel}  {/* Instead of manually combining dealName + borrowerName */}
</div>
```

---

## Troubleshooting

### Q: Inbox still shows `Deal {id…}`?

**Check:**
1. Migration deployed? `SELECT proname FROM pg_proc WHERE proname = 'deal_display_lookup';`
2. Function returns data? `SELECT * FROM deal_display_lookup(ARRAY[...]);`
3. Does your schema match any pattern? Check `deals`, `crm_deals`, `loan_deals` tables

**Fix:**
- Add your table/column names to function's discovery logic

---

### Q: RPC call fails?

**Check Supabase logs:**
```bash
supabase functions inspect deal_display_lookup
```

**Common errors:**
- `function does not exist` → migration not deployed
- `permission denied` → add RLS policy or use `supabaseAdmin()`

**Fix:**
```sql
-- Grant execute to service role (if using supabaseAdmin)
GRANT EXECUTE ON FUNCTION public.deal_display_lookup TO service_role;
```

---

### Q: Want to see what query is built?

**Debug mode:**
```sql
-- Add RAISE NOTICE before RETURN QUERY
RAISE NOTICE 'Built query: %', sql;
RETURN QUERY EXECUTE sql USING deal_ids;
```

**Check logs:**
```bash
tail -f /var/log/postgresql/postgresql-*.log
# Or Supabase dashboard → Database → Logs
```

---

## Status

✅ Migration created: [20251220_deal_display_lookup.sql](supabase/migrations/20251220_deal_display_lookup.sql)  
✅ Chat library updated: Uses RPC instead of hardcoded SELECT  
✅ UI component ready: Already displays dealName + borrowerName  
✅ Zero errors: All TypeScript compiles  

**Ready to deploy:** `supabase db push`
