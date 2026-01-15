# 📱 Borrower Reminder Automation - Complete

## ✅ What's Live

**Complete SMS stack with automated borrower reminders:**

1. **STOP/HELP Compliance** (carrier-required)
   - Keyword detection: STOP, HELP, START
   - Automatic opt-out enforcement
   - TwiML auto-replies

2. **Reminder Automation** (this implementation)
   - Cron-based (daily at 14:00 UTC)
   - Smart eligibility (missing docs + cooldown + max attempts)
   - Opt-out safe (uses `sendSmsWithConsent`)

3. **SMS Timeline** (read-only observation)
   - Floating card in deal command center
   - Shows all SMS activity (reminders, manual sends, opt-outs)

---

## 🏗️ Architecture

### Reminder Policy
**File:** `src/lib/reminders/policy.ts`

```typescript
export const REMINDER_POLICY = {
  cooldownHours: 48,      // Wait 48h between reminders
  maxAttempts: 3,         // Max 3 reminders per deal
};
```

### Eligibility Logic
**File:** `src/lib/reminders/selectCandidates.ts`

Borrowers are eligible for reminders when:
1. ✅ Active borrower portal link (not used, not expired)
2. ✅ Has missing required checklist items
3. ✅ Has valid phone number
4. ✅ < 3 reminder attempts
5. ✅ Last reminder > 48 hours ago
6. ✅ Not opted out (enforced in `sendSmsWithConsent`)

### Database Schema

**Reminder tracking:**
- `deal_events` table:
  - `kind = 'sms_outbound'`
  - `metadata->>'label' = 'Upload reminder'`
  - `metadata->>'attempt' = '1'` (increments)
  - `metadata->>'missing_items' = '3'`

**Opt-out tracking:**
- `deal_events` table:
  - `kind = 'sms_opt_out'` (from STOP keyword)
  - `kind = 'sms_opt_in'` (from START keyword)

**Message delivery:**
- `outbound_messages` table:
  - `channel = 'sms'`
  - `status = 'queued' | 'sent' | 'delivered' | 'failed'`
  - `body = 'Friendly reminder from Buddy...'`

---

## 🎯 Cron Endpoint

### Endpoint
```
POST /api/cron/borrower-reminders
```

### Authentication
```bash
Authorization: Bearer <CRON_SECRET>
```

### Response
```json
{
  "ok": true,
  "timestamp": "2025-12-28T14:00:00.000Z",
  "candidates": 15,
  "sent": 10,
  "skipped": 5,
  "results": [
    {
      "dealId": "uuid",
      "borrowerPhone": "+15551234567",
      "action": "sent"
    },
    {
      "dealId": "uuid",
      "borrowerPhone": "+15559876543",
      "action": "skipped",
      "reason": "cooldown"
    }
  ]
}
```

### Skip Reasons
- `max_attempts` - Already sent 3 reminders
- `cooldown` - Last reminder < 48 hours ago
- `opted_out` - Borrower sent STOP keyword
- `error` - Twilio send failed

---

## 🧪 Testing

### Local Test (Manual Cron)
```bash
# Set CRON_SECRET in .env.local first
source .env.local

curl -sS -X POST "http://localhost:3000/api/cron/borrower-reminders" \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

### Automated Test Suite
```bash
./tests/test-borrower-reminders.sh
```

**Tests:**
1. Cron endpoint execution
2. Database logging verification
3. Auth protection (rejects bad secrets)

### SQL Verification
```bash
psql $DATABASE_URL -f tests/verify-borrower-reminders.sql
```

**Queries:**
- Reminder stats (total sends, max attempts)
- Recent reminders
- Attempts per deal
- Deals approaching max attempts
- Cooldown status
- Eligible for next run

---

## 📅 Production Deployment

### Vercel Cron Configuration
**File:** `vercel.json`

```json
{
  "crons": [{
    "path": "/api/cron/borrower-reminders",
    "schedule": "0 14 * * *"
  }]
}
```

**Schedule:** Daily at **14:00 UTC** (9am EST / 6am PST)

### Environment Variables (Vercel)
```bash
# Required
CRON_SECRET=<generate-with-openssl-rand-hex-32>
NEXT_PUBLIC_APP_URL=https://yourapp.vercel.app

# Already configured (from previous steps)
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=...
```

### Deploy
```bash
vercel --prod
```

### Monitor
**Vercel Dashboard:**
- Functions → Cron
- View execution logs
- Check success/failure rates

---

## 📊 Message Template

### Reminder SMS
```
Friendly reminder from Buddy 👋

We're still missing 3 documents for ABC Manufacturing Loan.

Please upload here:
https://yourapp.com/upload/<token>

Reply STOP to opt out.
```

**Variables:**
- Missing items count (e.g., "3 documents" or "1 document")
- Deal name
- Upload URL (from `borrower_portal_links.token`)

---

## 🔒 Opt-Out Enforcement

### Automatic Protection
All reminders use `sendSmsWithConsent()` which:
1. Checks latest `sms_opt_out` / `sms_opt_in` event
2. Throws `SMS_OPTED_OUT` error if opted out
3. Cron endpoint catches error → skips → continues
4. No manual opt-out checking needed

### Opt-Out Flow
1. Borrower texts **STOP** to Twilio number
2. Webhook → `/api/webhooks/twilio/inbound`
3. Creates `deal_events` row: `kind='sms_opt_out'`
4. Auto-reply: "You're unsubscribed..."
5. Next reminder attempt → skipped automatically

### Opt-In Flow
1. Borrower texts **START** to Twilio number
2. Webhook → `/api/webhooks/twilio/inbound`
3. Creates `deal_events` row: `kind='sms_opt_in'`
4. Auto-reply: "You're resubscribed..."
5. Next reminder attempt → sent normally

---

## 🎯 Reminder Policy Tuning

### Adjust Cooldown
**File:** `src/lib/reminders/policy.ts`

```typescript
export const REMINDER_POLICY = {
  cooldownHours: 72,  // Change to 72h (3 days)
  maxAttempts: 3,
};
```

### Adjust Max Attempts
```typescript
export const REMINDER_POLICY = {
  cooldownHours: 48,
  maxAttempts: 5,  // Allow 5 reminders instead of 3
};
```

### Change Schedule
**File:** `vercel.json`

```json
{
  "crons": [{
    "path": "/api/cron/borrower-reminders",
    "schedule": "0 9,17 * * *"  // Twice daily: 9am & 5pm UTC
  }]
}
```

**Cron syntax:**
- `0 14 * * *` - Daily at 14:00 UTC
- `0 9,17 * * *` - Daily at 9am & 5pm UTC
- `0 14 * * 1-5` - Weekdays only at 14:00 UTC
- `*/30 9-17 * * *` - Every 30min during business hours

---

## 📈 Analytics Queries

### Daily Reminder Stats
```sql
SELECT 
  DATE(created_at) as send_date,
  COUNT(*) as reminders_sent,
  COUNT(DISTINCT deal_id) as unique_deals,
  COUNT(DISTINCT metadata->>'to') as unique_phones
FROM deal_events
WHERE kind = 'sms_outbound'
  AND metadata->>'label' = 'Upload reminder'
GROUP BY DATE(created_at)
ORDER BY send_date DESC
LIMIT 30;
```

### Success Rate (Delivered vs Sent)
```sql
SELECT 
  DATE(created_at) as send_date,
  COUNT(*) FILTER (WHERE status = 'sent') as sent,
  COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'delivered') / COUNT(*), 1) as delivery_pct
FROM outbound_messages
WHERE channel = 'sms'
  AND body LIKE '%Friendly reminder%'
GROUP BY DATE(created_at)
ORDER BY send_date DESC
LIMIT 30;
```

### Top Deals by Reminder Count
```sql
SELECT 
  d.name,
  COUNT(*) as reminder_count,
  MAX(de.created_at) as last_reminder
FROM deal_events de
JOIN deals d ON d.id = de.deal_id
WHERE de.kind = 'sms_outbound'
  AND de.metadata->>'label' = 'Upload reminder'
GROUP BY d.id, d.name
ORDER BY reminder_count DESC
LIMIT 20;
```

---

## 🚀 Next Steps

### 1. A2P Registration (Required for Production)
Now that you have:
- ✅ Real message templates
- ✅ Opt-out compliance
- ✅ Automated sends

You can register for A2P (Application-to-Person) messaging:

**Benefits:**
- Higher delivery rates
- Better sender reputation
- Required for high-volume (>500 msgs/day)

**Ready when you say:**
```
next: A2P registration walkthrough
```

### 2. Advanced Features (Future)
- **Smart timing:** Send reminders based on borrower timezone
- **Escalation:** Send different messages after 1st/2nd/3rd reminder
- **Response detection:** Pause reminders if borrower replies
- **Deal stage filtering:** Only remind deals in certain stages

---

## 📝 Files Created

```
src/lib/reminders/
├── policy.ts              # Reminder policy config
├── ledger.ts              # Reminder stats from deal_events
└── selectCandidates.ts    # Eligibility query

src/app/api/cron/borrower-reminders/
└── route.ts               # Cron endpoint

tests/
├── test-borrower-reminders.sh     # Automated test suite
└── verify-borrower-reminders.sql  # SQL verification queries

vercel.json                # Vercel cron configuration
```

---

## 🎓 How It Works

### Full Flow (Daily at 14:00 UTC)

1. **Vercel Cron** triggers → `POST /api/cron/borrower-reminders`
2. **Auth check** → Verify `CRON_SECRET`
3. **Select candidates:**
   - Query `borrower_portal_links` (active, not used)
   - Join `deals` (get phone number)
   - Check `deal_checklist_items` (count missing required)
   - Filter: has phone + has missing items
4. **For each candidate:**
   - Get reminder stats from `deal_events`
   - Check: attempts < 3?
   - Check: last reminder > 48h ago?
   - Call `sendSmsWithConsent()`:
     - Checks opt-out status
     - Sends via Twilio
     - Logs to `outbound_messages`
     - Logs to `deal_events` (kind='sms_outbound', label='Upload reminder')
5. **Return summary** → JSON response with sent/skipped counts

---

## 🔐 Security

### Cron Authentication
- **Header:** `Authorization: Bearer <CRON_SECRET>`
- **Secret:** 32+ character random string
- **Storage:** Environment variable (never in code)
- **Rotation:** Change in Vercel dashboard → redeploy

### Opt-Out Protection
- **Enforcement:** Automatic in `sendSmsWithConsent()`
- **Audit trail:** Every opt-out logged to `deal_events`
- **User control:** Borrower can STOP/START anytime
- **Compliance:** Meets carrier requirements

### Phone Number Privacy
- **Storage:** E.164 format in `deals.borrower_phone`
- **Access:** RLS policies (bank_id scoped)
- **Logging:** Phone numbers in `deal_events` metadata (audit)

---

## 🎉 Summary

**You now have:**
1. ✅ SMS timeline (observation)
2. ✅ STOP/HELP compliance (carrier-required)
3. ✅ Borrower reminder automation (this implementation)

**Ready for:**
4. 🔜 A2P registration (higher deliverability + scale)

**Test it:**
```bash
./tests/test-borrower-reminders.sh
```

**Deploy it:**
```bash
vercel --prod
```

**Monitor it:**
Vercel Dashboard → Functions → Cron
