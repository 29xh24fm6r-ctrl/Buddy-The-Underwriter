# 🧪 Borrower Portal Testing Quick Reference

## Pre-requisites

1. **Get Supabase Connection String:**
   - Supabase Dashboard → Settings → Database
   - Connection string → URI format
   - Copy the `postgresql://postgres.[ref]:[password]@...` string

2. **Set Environment Variable:**
   ```bash
   export DATABASE_URL="postgresql://postgres.abc123:yourpassword@..."
   ```

## Step-by-Step Testing

### 1️⃣ Apply RPC Migration

```bash
./run-migration-now.sh
```

**What it does:**
- Applies `supabase/migrations/20251228_rpc_security_twilio.sql`
- Creates 4 RPC functions (portal_get_context, portal_list_uploads, etc.)
- Creates tables: borrower_portal_links, outbound_messages
- Sets up triggers for underwriting readiness
- Grants execute to anon role

**Expected output:**
```
✓ Applying migration: supabase/migrations/20251228_rpc_security_twilio.sql
✓ Migration complete!

        routine_name
-----------------------------------
 portal_confirm_and_submit_document
 portal_get_context
 portal_get_doc_fields
 portal_list_uploads
```

---

### 2️⃣ Test Checklist Seeding

**Option A: Via SQL**
```sql
-- Replace :deal_id with your UUID
select checklist_key, title, required, received_at
from public.deal_checklist_items
where deal_id = :deal_id
order by checklist_key;
```

**Option B: Via E2E Script**
```bash
./tests/test-portal-e2e.sh
# When prompted, enter your deal ID
```

**Expected result:**
- Multiple rows (business_tax_return_2024, personal_tax_return_2024, etc.)
- `required` = true for most items
- `received_at` = NULL initially

**If empty:**
- Action: Click "Save + Auto-Seed Checklist" in deal cockpit
- Or run manual insert (see `supabase/migrations/20251228_borrower_portal_e2e.sql`)

---

### 3️⃣ Create Borrower Portal Link

**Option A: Via API (recommended)**
```bash
curl -X POST http://localhost:3000/api/portal/create-link \
  -H "Content-Type: application/json" \
  -d '{"deal_id":"YOUR_DEAL_UUID_HERE"}'
```

**Response:**
```json
{
  "token": "abc123xyz789...",
  "portal_url": "http://localhost:3000/upload/abc123xyz789..."
}
```

**Option B: Via SQL**
```sql
insert into public.borrower_portal_links (deal_id, token, label, single_use, expires_at)
values (
  'YOUR_DEAL_UUID',
  encode(gen_random_bytes(24), 'base64'),
  'Test Portal Link',
  true,
  now() + interval '72 hours'
)
returning id, token, expires_at;
```

**Verify:**
```sql
select id, deal_id, label, single_use, expires_at, used_at, token, created_at
from public.borrower_portal_links
where deal_id = 'YOUR_DEAL_UUID'
order by created_at desc;
```

---

### 4️⃣ Test RPC Functions

**Test portal_get_context:**
```sql
select * from public.portal_get_context('YOUR_TOKEN_HERE');
```

**Expected:**
| deal_id | link_id | label | single_use | expires_at | used_at |
|---------|---------|-------|------------|------------|---------|
| uuid    | uuid    | Test  | true       | timestamp  | NULL    |

**Test portal_list_uploads:**
```sql
select * from public.portal_list_uploads('YOUR_TOKEN_HERE');
```

**Expected (initially):**
- Empty (no uploads yet)
- After borrower uploads: rows with filename, mime_type, status, doc_type

---

### 5️⃣ Borrower Flow (Manual Test)

1. **Open Portal URL:**
   ```
   http://localhost:3000/upload/YOUR_TOKEN_HERE
   ```

2. **Upload Document:**
   - Drag & drop PDF, Excel, or Word file
   - Wait for OCR processing

3. **Review Extracted Fields:**
   - Should see AI-extracted data
   - Yellow highlights = needs attention
   - Click "Confirm" on highlighted fields

4. **Submit:**
   - Click "Confirm & Submit Document"
   - Should see success message

---

### 6️⃣ Verify Submission

**Run verification script:**
```bash
./tests/verify-submission.sh YOUR_DEAL_UUID
```

**Or check manually:**

**6a. Check doc_submissions:**
```sql
select id, deal_id, upload_id, token, status, created_at
from public.doc_submissions
where deal_id = 'YOUR_DEAL_UUID'
order by created_at desc;
```

**Expected:**
- At least one row
- status = 'submitted' or 'pending'

**6b. Check checklist_items updated:**
```sql
select checklist_key, received_at, received_upload_id
from public.deal_checklist_items
where deal_id = 'YOUR_DEAL_UUID'
  and received_at is not null
order by received_at desc;
```

**Expected:**
- Items that matched uploaded doc have `received_at` populated
- `received_upload_id` matches upload

**6c. Check underwriting readiness:**
```sql
select 
  id,
  name,
  stage,
  underwriting_ready_at,
  underwriting_started_at
from public.deals
where id = 'YOUR_DEAL_UUID';
```

**Expected (if all required items received):**
- `underwriting_ready_at` = timestamp
- `deal_events` has 'deal_ready_for_underwriting' event

---

### 7️⃣ Check Deal Events (Audit Trail)

```sql
select created_at, kind, metadata as payload
from public.deal_events
where deal_id = 'YOUR_DEAL_UUID'
order by created_at desc
limit 50;
```

**Expected events:**
- `field_confirmed` - When borrower confirms a field
- `doc_submitted` - When borrower submits document
- `checklist_item_received` - When item matched
- `deal_ready_for_underwriting` - When all required items received (if applicable)

---

## Common Issues & Fixes

### ❌ "Invalid or expired token"

**Cause:** Token doesn't exist or has expired

**Fix:**
```sql
-- Check expiration
select token, expires_at, used_at from public.borrower_portal_links
where token = 'YOUR_TOKEN';

-- Extend expiration
update public.borrower_portal_links
set expires_at = now() + interval '72 hours'
where token = 'YOUR_TOKEN';
```

### ❌ "No checklist items found"

**Cause:** Auto-seed didn't run

**Fix:**
- Click "Save + Auto-Seed Checklist" in deal cockpit
- Or manually insert via migration SQL

### ❌ "RPC function not found"

**Cause:** Migration not applied

**Fix:**
```bash
./run-migration-now.sh
```

**Verify:**
```sql
select routine_name from information_schema.routines 
where routine_name like 'portal_%';
```

### ❌ "Permission denied for function"

**Cause:** Missing grant to anon

**Fix:**
```sql
grant execute on function public.portal_get_context(text) to anon;
grant execute on function public.portal_list_uploads(text) to anon;
grant execute on function public.portal_get_doc_fields(text, uuid) to anon;
grant execute on function public.portal_confirm_and_submit_document(text, uuid) to anon;
```

### ❌ "Underwriting not auto-triggering"

**Cause:** Trigger not installed or logic issue

**Verify trigger exists:**
```sql
select tgname from pg_trigger where tgname like '%checklist%';
```

**Manually trigger:**
```sql
select public.try_mark_deal_underwriting_ready('YOUR_DEAL_UUID');
```

---

## Test Twilio SMS (Optional)

**Prerequisites:**
```bash
export TWILIO_ACCOUNT_SID=AC...
export TWILIO_AUTH_TOKEN=...
export TWILIO_FROM_NUMBER=+15551234567
```

**Send SMS:**
```bash
curl -X POST http://localhost:3000/api/portal/send-link \
  -H "Content-Type: application/json" \
  -d '{
    "deal_id": "YOUR_DEAL_UUID",
    "to_phone": "+15551234567"
  }'
```

**Verify:**
```sql
select created_at, channel, to_value, status, error, sent_at
from public.outbound_messages
where deal_id = 'YOUR_DEAL_UUID'
order by created_at desc;
```

---

## Success Criteria Checklist

- [ ] Migration applied (4 RPC functions exist)
- [ ] Checklist items seeded (multiple rows in deal_checklist_items)
- [ ] Portal link created (borrower_portal_links has row)
- [ ] RPC functions work (can call portal_get_context)
- [ ] Borrower can open portal URL
- [ ] Upload completes (file appears in portal_list_uploads)
- [ ] Fields extracted (portal_get_doc_fields returns data)
- [ ] Submission succeeds (doc_submissions row created)
- [ ] Checklist updated (received_at populated)
- [ ] Events logged (field_confirmed, doc_submitted in deal_events)
- [ ] Underwriting triggers (if all required items → underwriting_ready_at set)

---

## Quick Commands Reference

```bash
# Apply migration
./run-migration-now.sh

# E2E test guide
./tests/test-portal-e2e.sh

# Verify submission
./tests/verify-submission.sh <deal_id>

# Manual SQL checks
psql $DATABASE_URL -f tests/sanity-check-portal.sql

# Create portal link
curl -X POST localhost:3000/api/portal/create-link \
  -H "Content-Type: application/json" \
  -d '{"deal_id":"..."}'

# Send SMS
curl -X POST localhost:3000/api/portal/send-link \
  -H "Content-Type: application/json" \
  -d '{"deal_id":"...","to_phone":"+15551234567"}'
```

---

## Next Steps After Successful Test

1. **Deploy to production:**
   ```bash
   npm run build
   vercel --prod
   ```

2. **Set up Vercel Cron for underwriting poll:**
   ```json
   // vercel.json
   {
     "crons": [{
       "path": "/api/underwriting/poll",
       "schedule": "*/15 * * * *"
     }]
   }
   ```

3. **Add environment variables in Vercel:**
   - TWILIO_ACCOUNT_SID
   - TWILIO_AUTH_TOKEN
   - TWILIO_FROM_NUMBER
   - CRON_SECRET

4. **Monitor outbound_messages for failures:**
   ```sql
   select * from public.outbound_messages where status = 'failed';
   ```

---

For detailed documentation, see [RPC_SECURITY_TWILIO_COMPLETE.md](../RPC_SECURITY_TWILIO_COMPLETE.md)
