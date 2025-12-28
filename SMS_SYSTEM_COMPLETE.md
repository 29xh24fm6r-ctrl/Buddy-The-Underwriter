# 📱 Complete SMS System - Production Ready

## ✅ Full Stack Implemented

**4-part SMS system with automated reminders, compliance, and timeline:**

1. **SMS Timeline** - Real-time activity in deal command center
2. **STOP/HELP Compliance** - Carrier-required keyword handling + opt-out enforcement  
3. **Borrower Reminder Automation** - Cron-based reminders with smart eligibility
4. **Phone→Deal Resolution** - Inbound SMS auto-attaches to correct deal

---

## 🎯 Quick Reference

### Endpoints

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `/api/webhooks/twilio/inbound` | Inbound SMS webhook | Twilio |
| `/api/webhooks/twilio/status` | Delivery status callback | Twilio |
| `/api/portal/send-link` | Send upload link via SMS | Clerk |
| `/api/cron/borrower-reminders` | Automated reminder cron | `CRON_SECRET` |

### Environment Variables

```bash
# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+14703005945
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxx  # Optional (A2P)

# Cron
CRON_SECRET=<random-secret>

# App
NEXT_PUBLIC_APP_URL=https://yourapp.com
```

### Database Tables

| Table | Purpose |
|-------|---------|
| `deal_events` | All SMS events (inbound, outbound, opt-out, opt-in, help) |
| `outbound_messages` | SMS delivery tracking (Twilio status updates) |
| `borrower_portal_links` | Upload link tokens (used for phone resolution) |
| `deals` | Deal context (includes `borrower_phone`) |

---

## 🔄 Complete Flow Diagrams

### Outbound SMS (Banker Sends Link)

```
┌─────────────────────────────────────────────────────────┐
│ 1. Banker clicks "Send Upload Link" in command center  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 2. POST /api/portal/send-link                           │
│    - Creates borrower_portal_links row                  │
│    - Calls sendSmsWithConsent()                         │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 3. sendSmsWithConsent() (src/lib/sms/send.ts)          │
│    - Check assertSmsAllowed(phone)                      │
│    - If opted out → throw SMS_OPTED_OUT error           │
│    - If allowed → send via Twilio                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Twilio sends SMS                                     │
│    - Returns message SID                                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Log to outbound_messages + deal_events              │
│    - outbound_messages: delivery tracking               │
│    - deal_events: kind='sms_outbound', label='Upload link' │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 6. Twilio delivery callback (async)                    │
│    POST /api/webhooks/twilio/status                     │
│    - Updates outbound_messages.status                   │
└─────────────────────────────────────────────────────────┘
```

### Inbound SMS (Borrower Replies)

```
┌─────────────────────────────────────────────────────────┐
│ 1. Borrower texts Twilio number                        │
│    "Can I upload tomorrow?" or "STOP"                   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Twilio webhook                                       │
│    POST /api/webhooks/twilio/inbound                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Phone→Deal Resolution                               │
│    resolveDealByPhone(from_phone)                       │
│    - Check active portal links                          │
│    - Direct deal lookup                                 │
│    - Return { deal_id, bank_id, deal_name }            │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Log to deal_events                                   │
│    kind='sms_inbound', deal_id=<resolved>, metadata     │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Keyword Detection                                    │
│    - STOP → Log sms_opt_out, TwiML auto-reply          │
│    - START → Log sms_opt_in, TwiML auto-reply          │
│    - HELP → Log sms_help, TwiML help text              │
│    - Regular → No auto-reply (clean UX)                 │
└─────────────────────────────────────────────────────────┘
```

### Automated Reminders (Cron)

```
┌─────────────────────────────────────────────────────────┐
│ 1. Vercel Cron triggers (daily at 14:00 UTC)          │
│    POST /api/cron/borrower-reminders                    │
│    Header: x-cron-secret                                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Select Candidates (src/lib/reminders/selectCandidates.ts) │
│    - Active portal links (not used, not expired)        │
│    - Has missing required checklist items               │
│    - Has borrower_phone                                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 3. For each candidate:                                  │
│    getReminderStats(deal_id, phone)                     │
│    - Check attempts < 3                                 │
│    - Check last reminder > 48h ago                      │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 4. sendSmsWithConsent()                                 │
│    - Auto-checks opt-out state                          │
│    - If opted out → skip (return skipped: opted_out)    │
│    - If allowed → send reminder                         │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Log to deal_events                                   │
│    kind='sms_outbound', label='Upload reminder'         │
│    metadata: { attempt: 2, missing_items: 3 }           │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 6. Return summary                                       │
│    { sent: 10, skipped: 5, results: [...] }            │
└─────────────────────────────────────────────────────────┘
```

---

## 🧪 Testing Checklist

### 1. Local Development

```bash
# Start dev server
npm run dev

# Set borrower phone on test deal
psql $DATABASE_URL -c "UPDATE deals SET borrower_phone = '+15551234567' WHERE id = 'your-deal-uuid';"

# Create portal link
# Use UI: Deal Command Center → "Send Upload Link"
```

### 2. Webhook Testing (ngrok)

```bash
# Start ngrok
ngrok http 3000

# Copy ngrok URL: https://abc123.ngrok.io

# Update Twilio Console:
# Messaging Service → Inbound → https://abc123.ngrok.io/api/webhooks/twilio/inbound
# Messaging Service → Status Callback → https://abc123.ngrok.io/api/webhooks/twilio/status

# Send test SMS to your Twilio number
# Watch ngrok requests panel + dev server logs
```

### 3. STOP/HELP Compliance

```bash
# Send "STOP" to Twilio number
# Expected: TwiML auto-reply "You've been unsubscribed..."
# Verify: deal_events has sms_opt_out row

# Try sending upload link again
# Expected: 403 error "SMS blocked (opted out)"

# Send "START" to Twilio number  
# Expected: TwiML auto-reply "You're resubscribed..."
# Verify: deal_events has sms_opt_in row

# Send upload link again
# Expected: Success

# Run verification
./tests/test-sms-compliance.sh
```

### 4. Phone Resolution

```bash
# Send regular message to Twilio number (from phone with deal)
# Expected: deal_events row has deal_id populated

# Check timeline
# Visit: /deals/<deal-id>/command
# Expected: SMS timeline card shows inbound message

# Run verification
./tests/test-phone-resolver.sh
psql $DATABASE_URL -f tests/verify-phone-resolution.sql
```

### 5. Reminders

```bash
# Manual trigger (local)
source .env.local
curl -X POST "http://localhost:3000/api/cron/borrower-reminders" \
  -H "x-cron-secret: $CRON_SECRET" | jq

# Check results
psql $DATABASE_URL -f tests/verify-borrower-reminders.sql

# Verify cooldown/max attempts logic
./tests/test-borrower-reminders.sh
```

---

## 🚀 Production Deployment

### 1. Vercel Environment Variables

```bash
# In Vercel Dashboard → Project → Settings → Environment Variables

TWILIO_ACCOUNT_SID=ACxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxx
TWILIO_FROM_NUMBER=+14703005945
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxx  # Set when A2P approved

CRON_SECRET=<random-secret-32-chars>
NEXT_PUBLIC_APP_URL=https://yourapp.vercel.app

# Already set (from previous setup)
SUPABASE_SERVICE_ROLE_KEY=xxxxxxxxxxxx
CLERK_SECRET_KEY=xxxxxxxxxxxx
```

### 2. Twilio Webhook Configuration

**Messaging Service Settings:**
- Inbound: `https://yourapp.vercel.app/api/webhooks/twilio/inbound`
- Status Callback: `https://yourapp.vercel.app/api/webhooks/twilio/status`

**Or Phone Number Settings (if not using messaging service):**
- "A message comes in": `https://yourapp.vercel.app/api/webhooks/twilio/inbound`

### 3. Deploy

```bash
vercel --prod
```

### 4. Verify Cron

**Vercel Dashboard:**
- Functions → Cron
- Check execution logs (runs daily at 14:00 UTC)
- Should see: `{ sent: X, skipped: Y, candidates: Z }`

### 5. Monitor

**Database queries:**
```sql
-- Daily SMS stats
SELECT 
  DATE(created_at) as date,
  COUNT(*) FILTER (WHERE kind = 'sms_outbound') as sent,
  COUNT(*) FILTER (WHERE kind = 'sms_inbound') as received,
  COUNT(*) FILTER (WHERE kind = 'sms_opt_out') as opt_outs
FROM deal_events
WHERE kind LIKE 'sms_%'
GROUP BY DATE(created_at)
ORDER BY date DESC
LIMIT 30;

-- Reminder success rate
SELECT 
  COUNT(*) FILTER (WHERE metadata->>'label' = 'Upload reminder') as reminders,
  COUNT(*) FILTER (WHERE kind = 'sms_opt_out') as opt_outs_after_reminder
FROM deal_events
WHERE created_at > NOW() - INTERVAL '7 days';
```

---

## 📊 Key Metrics to Track

### Opt-Out Rate
```sql
SELECT 
  COUNT(*) FILTER (WHERE kind = 'sms_outbound') as total_sent,
  COUNT(*) FILTER (WHERE kind = 'sms_opt_out') as opt_outs,
  ROUND(100.0 * COUNT(*) FILTER (WHERE kind = 'sms_opt_out') / 
    NULLIF(COUNT(*) FILTER (WHERE kind = 'sms_outbound'), 0), 2) as opt_out_pct
FROM deal_events
WHERE created_at > NOW() - INTERVAL '30 days';
```

**Healthy:** < 1% opt-out rate  
**Warning:** > 5% opt-out rate (review message templates)

### Resolution Success Rate
```sql
SELECT 
  COUNT(*) FILTER (WHERE deal_id IS NOT NULL) * 100.0 / COUNT(*) as pct_resolved
FROM deal_events
WHERE kind = 'sms_inbound'
  AND created_at > NOW() - INTERVAL '7 days';
```

**Target:** > 90% (ensure deals have borrower_phone set)

### Reminder Effectiveness
```sql
WITH reminder_deals AS (
  SELECT DISTINCT deal_id
  FROM deal_events
  WHERE kind = 'sms_outbound'
    AND metadata->>'label' = 'Upload reminder'
    AND created_at > NOW() - INTERVAL '7 days'
)
SELECT 
  COUNT(DISTINCT rd.deal_id) as deals_reminded,
  COUNT(DISTINCT CASE WHEN ci.received_at IS NOT NULL THEN rd.deal_id END) as deals_uploaded,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN ci.received_at IS NOT NULL THEN rd.deal_id END) / 
    COUNT(DISTINCT rd.deal_id), 1) as upload_rate
FROM reminder_deals rd
JOIN deal_checklist_items ci ON ci.deal_id = rd.deal_id
WHERE ci.required = true;
```

**Target:** > 30% upload rate within 48h of reminder

---

## 🔧 Tuning Guide

### Adjust Cooldown Period

**File:** `src/lib/reminders/policy.ts`

```typescript
export const REMINDER_POLICY = {
  cooldownHours: 72,  // Change from 48h to 72h (3 days)
  maxAttempts: 3,
};
```

### Adjust Max Attempts

```typescript
export const REMINDER_POLICY = {
  cooldownHours: 48,
  maxAttempts: 5,  // Allow up to 5 reminders instead of 3
};
```

### Change Cron Schedule

**File:** `vercel.json`

```json
{
  "crons": [{
    "path": "/api/cron/borrower-reminders",
    "schedule": "0 9,17 * * *"  // Twice daily: 9am & 5pm UTC
  }]
}
```

### Customize Message Template

**File:** `src/app/api/cron/borrower-reminders/route.ts`

```typescript
const itemText = c.missingItemsCount === 1 ? "document" : "documents";
const body =
  `Hi from Buddy! 👋\n\n` +  // Changed greeting
  `Quick reminder: We need ${c.missingItemsCount} ${itemText} for ${c.dealName}.\n\n` +
  `Upload here: ${c.uploadUrl}\n\n` +
  `Reply STOP to opt out.`;  // Required
```

---

## 🎓 Architecture Decisions

### Why deal_events instead of dedicated sms_ledger table?

**Decision:** Use Buddy's existing `deal_events` table

**Rationale:**
- Already has bank_id scoping (multi-tenant ready)
- Timeline UI already renders deal_events
- Simpler schema (one event source of truth)
- Easy to add other event types (email, webhooks, etc.)

**Trade-off:** More generic schema vs. SMS-specific columns

### Why no reminder queue table?

**Decision:** Compute eligibility on each cron run

**Rationale:**
- Simpler (no queue state machine)
- Self-healing (eligibility recomputes from ground truth)
- No stale queue rows
- Easy to change rules without migrations

**Trade-off:** Slightly more DB queries per cron vs. stateful queue

### Why per-phone opt-out vs. per-deal?

**Decision:** Opt-out applies globally to phone number

**Rationale:**
- Carrier requirement (STOP must stop ALL messages)
- User expectation (one STOP = no more texts)
- Privacy (user controls their phone, not per-campaign)

**Trade-off:** Can't opt out of one deal but not another

---

## 📚 Related Documentation

- **STOP/HELP Compliance:** `PORTAL_UX_BULLETPROOF_COMPLETE.md`
- **Reminder Automation:** `BORROWER_REMINDER_AUTOMATION_COMPLETE.md`
- **Phone Resolution:** `PHONE_RESOLUTION_COMPLETE.md`
- **Deployment:** `DEPLOYMENT.md`
- **Twilio Setup:** Twilio Console → Messaging

---

## 🎉 Success Criteria

Your SMS system is production-ready when:

- ✅ Banker can send upload link via SMS from command center
- ✅ STOP keyword immediately blocks all future sends
- ✅ START keyword allows borrower to resubscribe
- ✅ HELP keyword provides assistance (no human in loop)
- ✅ Inbound SMS auto-attaches to correct deal
- ✅ Timeline shows complete SMS conversation
- ✅ Reminders send daily for deals with missing docs
- ✅ Reminders respect 48h cooldown and 3-attempt limit
- ✅ Opted-out borrowers never receive reminders
- ✅ Delivery status updates tracked in database
- ✅ All events logged for audit trail

**Next:** A2P registration for higher deliverability + scale!
