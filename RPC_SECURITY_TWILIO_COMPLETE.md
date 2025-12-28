# RPC Security Model + Twilio SMS Integration

## Overview

This system replaces the previous API route-based borrower portal with a **Supabase RPC SECURITY DEFINER** pattern for enhanced security. Borrowers use the anon key but can only access their deal data through token-validated RPC functions.

## Architecture

### Security Model

**Previous Approach (API Routes):**
- Borrower → API routes → Service role client → Database
- ❌ Service role client too permissive for client-side exposure
- ❌ Requires custom token validation in middleware

**NEW Approach (RPC SECURITY DEFINER):**
- Borrower → Anon client → RPC functions → Database (as postgres)
- ✅ Borrowers use anon key safely (no service role exposure)
- ✅ Token validation inside RPC, not in middleware
- ✅ RPC functions bypass RLS with SECURITY DEFINER
- ✅ Banker actions still use service-role API routes

### Database Schema

**New Tables:**
```sql
-- Portal access tokens
CREATE TABLE borrower_portal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id),
  token text NOT NULL UNIQUE,
  label text,
  single_use boolean DEFAULT true,
  used boolean DEFAULT false,
  expires_at timestamptz NOT NULL,
  channel text, -- 'email' | 'sms' | 'qr'
  created_at timestamptz DEFAULT now()
);

-- Outbound messaging queue (SMS + Email)
CREATE TABLE outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid REFERENCES deals(id),
  channel text NOT NULL, -- 'sms' | 'email'
  to_value text NOT NULL, -- phone or email
  body text NOT NULL,
  status text DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
  provider text, -- 'twilio' | 'resend'
  provider_message_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

### RPC Functions

**1. portal_get_context(p_token)**
- Validates token (not expired, not used if single_use)
- Returns deal context (name, borrower, required items)
- Usage: Initial portal load

**2. portal_list_uploads(p_token)**
- Returns all uploads for the deal (with classification status)
- Usage: List borrower's uploaded documents

**3. portal_get_doc_fields(p_token, p_upload_id)**
- Returns extracted fields for a specific upload
- Usage: Display AI-extracted data for borrower confirmation

**4. portal_confirm_and_submit_document(p_token, p_upload_id)**
- Atomically confirms all fields and submits document
- Marks single_use links as used
- Triggers underwriting_ready check
- Usage: Final borrower submission

**Grant Pattern:**
```sql
GRANT EXECUTE ON FUNCTION portal_get_context TO anon;
GRANT EXECUTE ON FUNCTION portal_list_uploads TO anon;
GRANT EXECUTE ON FUNCTION portal_get_doc_fields TO anon;
GRANT EXECUTE ON FUNCTION portal_confirm_and_submit_document TO anon;
```

## Twilio SMS Integration

### Setup

1. **Get Twilio Credentials:**
   - Sign up at [twilio.com](https://www.twilio.com)
   - Get Account SID, Auth Token, and a phone number

2. **Environment Variables:**
```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+15551234567
NEXT_PUBLIC_APP_URL=https://yourapp.com
```

3. **Install SDK:**
```bash
npm install twilio
```

### Banker Workflow

**Step 1: Create Portal Link**
```typescript
POST /api/portal/create-link
Body: { deal_id: "..." }
Response: { token: "abc123...", portal_url: "https://app.com/upload/abc123" }
```

**Step 2: Send via SMS**
```typescript
POST /api/portal/send-link
Body: {
  deal_id: "...",
  to_phone: "+15551234567",
  message: "Upload your docs: https://app.com/upload/abc123" // optional
}
Response: { ok: true, sid: "SM...", portal_url: "..." }
```

**Combined Flow (via UI):**
- Banker enters borrower phone number
- Clicks "Send Upload Link"
- System creates link + sends SMS
- Borrower receives text with link
- Click → lands on token-protected portal

### Borrower Flow

1. **Receive SMS:**
   ```
   Buddy upload link: https://app.com/upload/abc123xyz
   (Expires in 72h)
   ```

2. **Click Link:**
   - Lands on `/upload/[token]` page
   - Client component uses anon key
   - Calls `supabase.rpc('portal_get_context', { p_token: token })`

3. **Upload Documents:**
   - File upload still uses `/api/portal/[token]/upload` (signed URL flow)
   - After upload, calls `supabase.rpc('portal_list_uploads', { p_token })`

4. **Review Extracted Data:**
   - Calls `supabase.rpc('portal_get_doc_fields', { p_token, p_upload_id })`
   - Shows AI-extracted fields
   - Borrower confirms/corrects

5. **Submit:**
   - Calls `supabase.rpc('portal_confirm_and_submit_document', { p_token, p_upload_id })`
   - Marks doc as confirmed
   - Link marked as used (if single_use)
   - Triggers underwriting_ready check

## Underwriting Automation

### Trigger: try_mark_deal_underwriting_ready()

**What it does:**
- Checks if all required checklist items have confirmed submissions
- If yes → sets `deals.underwriting_ready = true`
- Creates notification for banker

**When it runs:**
- After every `portal_confirm_and_submit_document()` call
- Can also be polled via cron (see below)

### Polling Endpoint

```typescript
GET /api/underwriting/poll
Headers: Authorization: Bearer <CRON_SECRET>
```

**What it does:**
- Finds all deals with `underwriting_ready = false` and `stage = 'underwriting'`
- Checks if required docs received
- Updates status + creates notifications

**Setup with Vercel Cron:**
```json
// vercel.json
{
  "crons": [{
    "path": "/api/underwriting/poll",
    "schedule": "*/15 * * * *" // Every 15 minutes
  }]
}
```

## UI Components

### BorrowerPortalControls

**Location:** `src/components/deals/BorrowerPortalControls.tsx`

**Props:**
```typescript
interface Props {
  dealId: string;
}
```

**Features:**
- Phone number input
- Custom message (optional)
- "Send Upload Link" button
- Success/error status display

**Integration:**
```tsx
import { BorrowerPortalControls } from "@/components/deals/BorrowerPortalControls";

<BorrowerPortalControls dealId={deal.id} />
```

### PortalClient (RPC Version)

**Location:** `src/components/borrower/PortalClient.tsx`

**Key Changes:**
```typescript
// OLD (API routes)
const res = await fetch(`/api/portal/${token}/docs`);
const { docs } = await res.json();

// NEW (RPCs)
const { data } = await supabase.rpc("portal_list_uploads", {
  p_token: token
});
```

**Supabase Client:**
```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! // ANON key, not service role
);
```

## Migration Guide

### 1. Apply Database Migration

```bash
# Connect to Supabase
psql $DATABASE_URL -f supabase/migrations/20251228_rpc_security_twilio.sql
```

**Or via Supabase Dashboard:**
- SQL Editor → New Query → Paste migration
- Run

### 2. Update Environment Variables

```bash
# .env.local
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+15551234567
NEXT_PUBLIC_APP_URL=https://yourapp.com
CRON_SECRET=random_secret_for_cron
```

### 3. Deploy

```bash
npm run build
vercel --prod
```

### 4. Test Flow

**Banker Side:**
```bash
# Create link
curl -X POST https://yourapp.com/api/portal/create-link \
  -H "Content-Type: application/json" \
  -d '{"deal_id":"..."}'

# Send SMS
curl -X POST https://yourapp.com/api/portal/send-link \
  -H "Content-Type: application/json" \
  -d '{"deal_id":"...","to_phone":"+15551234567"}'
```

**Borrower Side:**
- Click SMS link
- Upload document
- Confirm extracted fields
- Submit

**Banker Notification:**
- Check notifications table
- Should see "underwriting_ready" notification when all docs received

## Security Considerations

### Token Expiration
- Default: 72 hours
- Customizable via `expires_hours` param
- RPC validates `expires_at` before returning data

### Single-Use Links
- `single_use = true` → link becomes invalid after first submission
- Prevents multiple submissions
- Can be disabled for ongoing upload portals

### Token Format
- 24 random bytes → base64url (32 chars)
- Cryptographically secure (`crypto.randomBytes`)
- Indexed for fast lookups

### RLS Bypass
- RPC functions use `SECURITY DEFINER`
- Run as postgres user (bypass RLS)
- Critical: Token validation MUST happen inside RPC, not assumed

### Anon Key Safety
- Borrowers use anon key → ZERO database access without RPC
- Even if anon key leaked, can't query tables directly
- All access gated through token-validated RPCs

## Monitoring

### Outbound Messages Table

```sql
-- Check SMS send status
SELECT channel, status, COUNT(*) FROM outbound_messages GROUP BY channel, status;

-- Failed messages
SELECT * FROM outbound_messages WHERE status = 'failed' ORDER BY created_at DESC;

-- Recent sends
SELECT to_value, body, sent_at FROM outbound_messages WHERE status = 'sent' ORDER BY sent_at DESC LIMIT 10;
```

### Portal Links

```sql
-- Active links
SELECT deal_id, label, expires_at FROM borrower_portal_links WHERE used = false AND expires_at > now();

-- Usage stats
SELECT
  COUNT(*) FILTER (WHERE used = true) AS used_links,
  COUNT(*) FILTER (WHERE used = false AND expires_at > now()) AS active_links,
  COUNT(*) FILTER (WHERE expires_at < now()) AS expired_links
FROM borrower_portal_links;
```

## Troubleshooting

### "Invalid or expired link"
- Check `borrower_portal_links.expires_at`
- Check `borrower_portal_links.used` (if single_use)
- Verify token matches exactly (no whitespace)

### "Twilio not configured"
- Missing env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- Check Twilio dashboard for account status
- Verify phone number format: E.164 (+15551234567)

### "SMS failed"
- Check `outbound_messages.error` column
- Twilio errors: invalid phone, blocked number, account suspended
- Rate limits: Twilio free tier has restrictions

### "RPC not found"
- Migration not applied
- Check Supabase dashboard → Database → Functions
- Verify grant to anon role

### "Underwriting not auto-updating"
- Check cron job running (Vercel logs)
- Verify `CRON_SECRET` matches
- Run manual poll: `GET /api/underwriting/poll`
- Check `deals.stage = 'underwriting'` (only polls underwriting-stage deals)

## Next Steps

1. **Add Email Fallback:**
   - If SMS fails, queue email via Resend
   - Use `outbound_messages.channel = 'email'`

2. **QR Code Links:**
   - Generate QR for in-person handoffs
   - Store in `borrower_portal_links.channel = 'qr'`

3. **Link Analytics:**
   - Track clicks, uploads, completion rates
   - Add `borrower_portal_link_events` table

4. **Multi-Document Packs:**
   - Current: 1 upload = 1 doc
   - Future: Borrower submits pack (3yr tax returns) in one session

5. **Real-time Updates:**
   - Supabase Realtime subscriptions
   - Banker sees borrower uploads live

## Reference

- **Migration:** `supabase/migrations/20251228_rpc_security_twilio.sql`
- **Banker API:** `src/app/api/portal/create-link/route.ts`, `src/app/api/portal/send-link/route.ts`
- **Borrower UI:** `src/components/borrower/PortalClient.tsx`
- **Banker UI:** `src/components/deals/BorrowerPortalControls.tsx`
- **Poll:** `src/app/api/underwriting/poll/route.ts`
- **Docs:** This file (RPC_SECURITY_TWILIO_COMPLETE.md)
