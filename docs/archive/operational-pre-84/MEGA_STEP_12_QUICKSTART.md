# MEGA STEP 12 - Quick Start Guide

## What You Got

**Smart Missing Docs Emails** that show EXACT gaps:
- ✅ "Have years: 2023. Need 2 distinct years (missing 1)."
- ✅ "Have months: 2025-01, 2025-02, 2025-03. Need 6 distinct months (missing 3)."
- ✅ Auto-updates as docs upload (wired into MEGA 11 reconciler)
- ✅ Auto-send with throttle (optional, per-deal configuration)
- ✅ Full audit trail (deal_outbound_ledger)

## Files Created

1. **src/lib/outbound/missingDocsPlanner.ts** (167 lines)
   - `buildMissingDocsPlan()` - Analyzes evidence gaps
   - `renderMissingDocsEmail()` - Generates smart email text

2. **src/lib/outbound/outboundOrchestrator.ts** (294 lines)
   - `processMissingDocsOutbound()` - Main orchestrator
   - Upserts drafts, handles auto-send, records audit trail

3. **src/app/api/deals/[dealId]/outbound/missing-docs/route.ts** (35 lines)
   - Manual endpoint: `POST /api/deals/{dealId}/outbound/missing-docs`

4. **supabase/migrations/20251218_mega_step_12_outbound.sql** (55 lines)
   - Tables: `deal_outbound_settings`, `deal_outbound_ledger`
   - Indexes for performance

**Total**: 496 lines of new code

## Quick Setup

### 1. Run Migration

```bash
# Apply MEGA 12 schema
supabase migration up

# Or manually:
psql $DATABASE_URL < supabase/migrations/20251218_mega_step_12_outbound.sql
```

### 2. Set Borrower Email (required for auto-send)

```sql
UPDATE deals 
SET borrower_email = 'borrower@example.com' 
WHERE id = '<DEAL_UUID>';
```

### 3. Enable Auto-Send (optional, per-deal)

```sql
-- Default is auto_send=false (safe, human approval required)
-- Enable for testing:
INSERT INTO deal_outbound_settings (deal_id, auto_send, throttle_minutes)
VALUES ('<DEAL_UUID>', true, 0) -- 0 = no throttle (testing only)
ON CONFLICT (deal_id) DO UPDATE
  SET auto_send = true, throttle_minutes = 0;
```

**For production**: Use `throttle_minutes = 240` (4 hours)

## Testing

### Test 1: Manual Trigger

```bash
# Force update missing docs email for a deal
curl -X POST http://localhost:3000/api/deals/<DEAL_UUID>/outbound/missing-docs

# Check response
{
  "ok": true,
  "dealId": "uuid",
  "result": {
    "ok": true,
    "action": "draft_updated",  # or "sent" if auto-send enabled
    "auto_send": false
  }
}
```

### Test 2: Auto-Trigger via Upload

```bash
# 1. Upload a document (triggers reconciliation)
curl -X POST http://localhost:3000/api/deals/<DEAL_UUID>/upload \
  -F "file=@2023_tax_return.pdf"

# 2. Check drafts table (email should be auto-created/updated)
psql $DATABASE_URL -c "
  SELECT kind, status, subject, 
         substring(body from 1 for 100) as body_preview
  FROM deal_message_drafts
  WHERE deal_id = '<DEAL_UUID>'
"

# Expected: draft with "Have years: 2023. Need 2 distinct years (missing 1)."
```

### Test 3: Satisfaction Auto-Cancel

```bash
# Upload second tax return (satisfies 2-year requirement)
curl -X POST http://localhost:3000/api/deals/<DEAL_UUID>/upload \
  -F "file=@2024_tax_return.pdf"

# Check drafts (should be canceled if all conditions satisfied)
psql $DATABASE_URL -c "
  SELECT kind, status, updated_at
  FROM deal_message_drafts
  WHERE deal_id = '<DEAL_UUID>'
    AND kind = 'MISSING_DOCS_REQUEST'
"

# Expected: status='canceled' OR updated plan (if other conditions open)
```

## How It Works

### Automatic Flow

```
Upload PDF
  ↓
OCR extracts text
  ↓
Classify identifies doc_type
  ↓
Reconcile appends evidence (MEGA 11)
  ↓
processMissingDocsOutbound() ← MEGA 12 triggers here
  ↓
1. Analyze evidence gaps (which years/months missing?)
2. Build missing docs plan (sorted by priority)
3. Render smart email ("Have X, need Y")
4. Upsert draft (one canonical per deal)
5. Auto-send if enabled (with throttle check)
6. Record in audit ledger
```

### Email Example

**Scenario**: Deal needs TAX_RETURNS_2Y (have 2023) + BANK_STATEMENTS_6M (have 3 months)

**Generated Email**:
```
Subject: Documents needed to continue — Acme Corp SBA 7(a)

Hi,

We're moving your file forward for Acme Corp SBA 7(a). 
To keep underwriting on schedule, please upload the following items:

• **Personal Tax Returns (2 years)** — Have years: 2023. Need 2 distinct years (missing 1).
• **Bank Statements (6 months)** — Have months: 2025-01, 2025-02, 2025-03. Need 6 distinct months (missing 3).

Once these are uploaded, we'll automatically update your file and continue processing.

Thank you,
Old Glory Bank
```

## Monitor

### Check Pending Drafts

```sql
SELECT 
  d.name AS deal_name,
  dm.kind,
  dm.status,
  dm.updated_at,
  substring(dm.subject from 1 for 50) as subject_preview
FROM deal_message_drafts dm
JOIN deals d ON d.id = dm.deal_id
WHERE dm.status IN ('draft', 'pending_approval')
ORDER BY dm.updated_at DESC;
```

### Check Sent Emails

```sql
SELECT 
  d.name AS deal_name,
  dol.to_email,
  dol.subject,
  dol.status,
  dol.provider,
  dol.created_at
FROM deal_outbound_ledger dol
JOIN deals d ON d.id = dol.deal_id
WHERE dol.created_at > now() - interval '24 hours'
ORDER BY dol.created_at DESC;
```

### Check Auto-Send Status

```sql
SELECT 
  d.name AS deal_name,
  dos.auto_send,
  dos.throttle_minutes,
  d.borrower_email
FROM deal_outbound_settings dos
JOIN deals d ON d.id = dos.deal_id
WHERE dos.auto_send = true;
```

## Next Steps

### 1. Wire Email Provider (replace stub)

**Option A: Resend** (recommended):
```bash
npm install resend
```

In `outboundOrchestrator.ts`, replace `sendEmailStub` with:
```typescript
import { Resend } from 'resend';

async function sendEmailResend(args: { to: string; subject: string; body: string }) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: 'underwriting@oldglorybank.com',
    to: args.to,
    subject: args.subject,
    text: args.body,
  });
  if (error) throw new Error(error.message);
  return { provider: "resend", provider_message_id: data.id };
}
```

**Option B: SendGrid**, **Option C: AWS SES**

### 2. Add React Email Templates

```bash
npm install @react-email/components
```

Create `src/emails/MissingDocsEmail.tsx` with styled HTML template.

### 3. Multi-Recipient Support

Add `deal_contacts` table, update `getBorrowerEmail()` to query contacts.

### 4. Scheduler (daily sweep)

Create `/api/cron/outbound-sweep` to re-check all deals daily.

### 5. Dashboard UI

Add admin page showing:
- Pending drafts (approve/edit/cancel)
- Sent emails (view/resend)
- Auto-send settings (toggle per deal)

## Configuration Reference

### Default Settings

- `auto_send`: `false` (human approval required)
- `throttle_minutes`: `240` (4 hours between sends)
- `provider`: `"stub"` (logs to console, doesn't send)

### Per-Deal Override

```sql
-- Enable auto-send with 2-hour throttle
UPDATE deal_outbound_settings 
SET auto_send = true, throttle_minutes = 120
WHERE deal_id = '<DEAL_UUID>';

-- Disable auto-send (back to manual approval)
UPDATE deal_outbound_settings 
SET auto_send = false
WHERE deal_id = '<DEAL_UUID>';

-- No throttle (send on every change, testing only)
UPDATE deal_outbound_settings 
SET throttle_minutes = 0
WHERE deal_id = '<DEAL_UUID>';
```

## Troubleshooting

### "No email sent"
- Check: `deals.borrower_email` is set
- Check: `deal_outbound_settings.auto_send = true`
- Check: Throttle not blocking (check `deal_outbound_ledger` for last send time)

### "Draft not updating"
- Check: Conditions exist in `conditions_to_close` table
- Check: Reconciliation completed (check logs for "[RECONCILE:OUTBOUND:ERROR]")
- Check: Rules exist in `condition_match_rules` table

### "Email stub only logging"
- Expected! Replace `sendEmailStub` with real provider (Resend/SendGrid)
- Check: `RESEND_API_KEY` or equivalent env var set

---

**MEGA STEP 12 Complete** ✅  
**Auto-outbound wired** 📧  
**Smart emails ready** 🎯  
**Audit trail active** 📋
