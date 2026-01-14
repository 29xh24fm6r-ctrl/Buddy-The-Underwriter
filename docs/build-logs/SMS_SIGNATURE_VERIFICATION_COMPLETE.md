# Twilio Signature Verification + SQL Helpers — Complete ✅

## What We Added from Your Spec

Your spec provided comprehensive SMS setup instructions. We took the **best parts** (signature verification, SQL helpers) and integrated them with our **superior architecture** (borrower_phone_links instead of borrower_applicants.phone_e164).

---

## NEW: Signature Verification

### Purpose
Prevents webhook spoofing — only real Twilio requests accepted.

### Implementation

**File**: [src/lib/sms/twilioVerify.ts](src/lib/sms/twilioVerify.ts)

```typescript
import { computeWebhookUrl, verifyTwilioSignature } from "@/lib/sms/twilioVerify";

// In webhook handler:
const webhookUrl = computeWebhookUrl(pathname);
const isValid = verifyTwilioSignature({
  url: webhookUrl,
  authToken: process.env.TWILIO_AUTH_TOKEN!,
  signature: req.headers.get("x-twilio-signature"),
  params, // Form data from Twilio
});

if (!isValid) {
  return new NextResponse("Invalid signature", { status: 401 });
}
```

### Required: PUBLIC_BASE_URL

**Must set in Vercel environment variables:**

```bash
PUBLIC_BASE_URL=https://buddy-the-underwriter.vercel.app
```

**How to find it:**
- Vercel Project → Settings → Domains → Primary production domain
- Use `https://<domain>` (no trailing slash)

---

## NEW: SQL Helper Functions

### Migration File
[supabase/migrations/20251229_sms_helpers.sql](supabase/migrations/20251229_sms_helpers.sql)

### Function 1: normalize_e164(text)

Strip formatting from phone numbers

```sql
SELECT normalize_e164('+1 (555) 123-4567');
-- Returns: +15551234567
```

### Function 2: resolve_sms_context(text)

Resolve phone → borrower/deal context using borrower_phone_links

```sql
SELECT * FROM resolve_sms_context('+15551234567');
-- Returns: borrower_applicant_id, borrower_id, deal_id, bank_id
```

### Function 3: deal_events_to_timeline()

Auto-populate deal_timeline_events from deal_events (SMS events only)

---

## Deployment Checklist

### 1. Run Migrations
```bash
psql $DATABASE_URL -f supabase/migrations/20251229_borrower_phone_links.sql
psql $DATABASE_URL -f supabase/migrations/20251229_sms_helpers.sql
```

### 2. Set PUBLIC_BASE_URL in Vercel
Dashboard → Settings → Environment Variables
```bash
PUBLIC_BASE_URL=https://buddy-the-underwriter.vercel.app
```

### 3. Deploy
```bash
vercel --prod
```

### 4. Test Signature Verification
Send SMS to +14703005945 (should succeed)

Try spoofed request (should fail):
```bash
curl -X POST https://buddy-the-underwriter.vercel.app/api/webhooks/twilio/inbound \
  -d "From=+15551234567&Body=test"
```
Expected: `401 Invalid signature`

---

## Files Changed

### New Files
- [src/lib/sms/twilioVerify.ts](src/lib/sms/twilioVerify.ts) — Signature verification
- [supabase/migrations/20251229_sms_helpers.sql](supabase/migrations/20251229_sms_helpers.sql) — SQL functions

### Updated Files
- [src/app/api/webhooks/twilio/inbound/route.ts](src/app/api/webhooks/twilio/inbound/route.ts) — Added verification
- [.env.example](.env.example) — Added PUBLIC_BASE_URL

---

## Commit
**073ee15** on branch `feat/portal-bulletproof-ux`

---

## Next Steps

Say **"next: A2P registration"** when ready for carrier registration.

**Ship fast, stay secure.** 🔒
