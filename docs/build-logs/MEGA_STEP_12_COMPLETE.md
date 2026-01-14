# MEGA STEP 12: Missing Docs Outbound System ✅

**Status**: Complete  
**Date**: December 18, 2024  
**Files Created**: 4 (2 libraries + 1 API endpoint + 1 migration)

## Overview

Smart borrower requests showing **EXACT missing items** based on MEGA 11 evidence analysis:
- "Have years: 2023. Need 2 distinct years (missing 1)."
- "Have months: 2025-01, 2025-02, 2025-03. Need 6 distinct months (missing 3)."

**Not generic** "Upload tax returns" — deterministic gap analysis from evidence trail.

## Architecture

### Flow (Auto-updating)

```
Upload → OCR → Classify → Reconcile → processMissingDocsOutbound
                                       ↓
                                       1. Analyze evidence gaps (MEGA 11)
                                       2. Build missing docs plan (sorted by priority)
                                       3. Render smart email ("Have X, need Y")
                                       4. Upsert draft (one canonical per deal+kind)
                                       5. Auto-send if enabled (with throttle)
                                       6. Record in audit ledger
```

### Key Features

**Evidence-Based Planning**:
- Counts distinct values from MEGA 11 evidence array
- Detects missing years, months, document types
- Prioritizes by most missing items first

**Draft Management**:
- One canonical draft per deal+kind (updates in place)
- Auto-cancels draft when all conditions satisfied
- Fingerprint deduplication (prevents duplicate sends)

**Auto-Send with Throttle**:
- Default: `auto_send=false` (safe, human approval required)
- Enable per deal: `UPDATE deal_outbound_settings SET auto_send=true`
- Throttle: 240 minutes (4 hours) between sends by default

**Audit Trail**:
- `deal_outbound_ledger`: Every send recorded (success + failures)
- Provider message ID tracked (for deliverability monitoring)
- Non-fatal errors (outbound won't break reconciliation)

## Database Schema

### Tables (from migration)

**deal_outbound_settings**:
```sql
CREATE TABLE public.deal_outbound_settings (
  deal_id UUID PRIMARY KEY REFERENCES deals(id),
  auto_send BOOLEAN NOT NULL DEFAULT false,
  throttle_minutes INTEGER NOT NULL DEFAULT 240,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**deal_outbound_ledger**:
```sql
CREATE TABLE public.deal_outbound_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  kind TEXT NOT NULL, -- "MISSING_DOCS_REQUEST"
  fingerprint TEXT NOT NULL, -- sha256(dealId|kind|subject|body)
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  provider TEXT NOT NULL, -- "stub", "resend", "sendgrid"
  provider_message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Indexes**:
- `idx_deal_outbound_settings_auto_send`: Fast lookup of deals with auto-send enabled
- `idx_deal_outbound_ledger_deal_kind`: Fast throttle checks (last sent time)
- `idx_deal_outbound_ledger_fingerprint`: Deduplication

## Files Created

### 1. src/lib/outbound/missingDocsPlanner.ts (160 lines)

**Purpose**: Build missing docs plan + render email

**Key Functions**:
- `buildMissingDocsPlan()`: Analyzes evidence, returns sorted list of missing items
- `renderMissingDocsEmail()`: Generates subject + body with smart details
- `collectDistinctValues()`: Extracts distinct_key_values from evidence
- `summarizeOne()`: Builds human-readable summary for one condition

**Example Output**:
```typescript
{
  open_count: 3,
  items: [
    {
      condition_id: "uuid",
      key: "TAX_RETURNS_PERSONAL_2Y",
      title: "Personal Tax Returns (2 years)",
      need: 2,
      haveCount: 1,
      missingCount: 1,
      detail: "Have years: 2023. Need 2 distinct years (missing 1).",
      keyType: "tax_year",
      have: ["2023"]
    },
    {
      key: "BANK_STATEMENTS_6M",
      title: "Bank Statements (6 months)",
      need: 6,
      haveCount: 3,
      missingCount: 3,
      detail: "Have months: 2025-01, 2025-02, 2025-03. Need 6 distinct months (missing 3).",
      keyType: "statement_month_iso",
      have: ["2025-01", "2025-02", "2025-03"]
    }
  ]
}
```

**Email Rendering**:
```
Subject: Documents needed to continue — Acme Corp SBA 7(a)

Hi,

We're moving your file forward for **Acme Corp SBA 7(a)**. To keep underwriting on schedule, please upload the following items:

• **Personal Tax Returns (2 years)** — Have years: 2023. Need 2 distinct years (missing 1).
• **Bank Statements (6 months)** — Have months: 2025-01, 2025-02, 2025-03. Need 6 distinct months (missing 3).
• **Articles of Incorporation** — Need 1 items (missing 1).

Once these are uploaded, we'll automatically update your file and continue processing.

Thank you,
Old Glory Bank
```

### 2. src/lib/outbound/outboundOrchestrator.ts (270 lines)

**Purpose**: Orchestrate draft upsert + auto-send

**Main Function**: `processMissingDocsOutbound()`

**Flow**:
1. **Load settings**: Get `auto_send` + `throttle_minutes` for deal
2. **Load data**: Deal name, borrower email, rules, conditions
3. **Build plan**: Call `buildMissingDocsPlan()` from planner
4. **Cancel if done**: If `open_count=0`, cancel pending drafts (don't spam)
5. **Render email**: Call `renderMissingDocsEmail()`
6. **Fingerprint**: `sha256(dealId|kind|subject|body)` for deduplication
7. **Upsert draft**: Update existing or insert new (one canonical draft)
8. **Auto-send gate**: Check `auto_send`, `borrowerEmail`, throttle
9. **Send**: Call provider (stub for now, wire Resend/SendGrid later)
10. **Record ledger**: Audit trail (sent/failed)
11. **Mark draft sent**: Update status in deal_message_drafts

**Return Values**:
```typescript
{ ok: true, action: "nothing_missing" }    // All conditions satisfied
{ ok: true, action: "draft_updated", auto_send: false }  // Draft created, awaiting approval
{ ok: true, action: "draft_updated_no_recipient", auto_send: true }  // No borrower email
{ ok: true, action: "throttled", auto_send: true }  // Sent too recently
{ ok: true, action: "sent", auto_send: true }  // Email sent successfully
{ ok: false, action: "send_failed", error: "..." }  // Send failed
```

**Email Provider Stub**:
```typescript
async function sendEmailStub(args: { to: string; subject: string; body: string }) {
  console.log("[OUTBOUND:STUB]", { to: args.to, subject: args.subject, bodyPreview: args.body.slice(0, 180) });
  return { provider: "stub", provider_message_id: null as string | null };
}
```

**Replace with Resend/SendGrid**:
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

### 3. src/app/api/deals/[dealId]/outbound/missing-docs/route.ts (35 lines)

**Purpose**: Manual endpoint to force re-plan

**Endpoint**: `POST /api/deals/{dealId}/outbound/missing-docs`

**Usage**:
```bash
# Force update missing docs email
curl -X POST http://localhost:3000/api/deals/<UUID>/outbound/missing-docs

# Or from browser console
fetch("/api/deals/<UUID>/outbound/missing-docs", { method: "POST" })
  .then(r => r.json())
  .then(console.log);
```

**Response**:
```json
{
  "ok": true,
  "dealId": "uuid",
  "result": {
    "ok": true,
    "action": "draft_updated",
    "auto_send": false
  }
}
```

### 4. supabase/migrations/20251218_mega_step_12_outbound.sql (55 lines)

**Creates**:
- `deal_outbound_settings` table + index
- `deal_outbound_ledger` table + 2 indexes
- Grants for service_role
- Comments explaining each column

## Integration with MEGA 11

### Wired into Reconciler

**File**: `src/lib/conditions/reconcileConditions.ts`

**Added at end of `reconcileConditionsFromOcrResult()`**:
```typescript
// 9. MEGA STEP 12: Auto-update missing docs outbound (draft + optional auto-send)
//    Non-fatal: log errors but don't fail reconciliation
try {
  await processMissingDocsOutbound({ sb, dealId, trigger: "reconcile" });
} catch (e: any) {
  console.error("[RECONCILE:OUTBOUND:ERROR]", dealId, e?.message ?? String(e));
}
```

**Flow**:
1. Upload → OCR complete
2. Classify → doc_type identified
3. Reconcile → evidence appended (MEGA 11)
4. Reconcile → conditions may satisfy
5. **Reconcile → processMissingDocsOutbound** ← NEW
6. Missing docs email updated/sent automatically

## Configuration

### Enable Auto-Send (per deal)

**SQL**:
```sql
INSERT INTO public.deal_outbound_settings (deal_id, auto_send, throttle_minutes)
VALUES ('<DEAL_UUID>', true, 240)
ON CONFLICT (deal_id) DO UPDATE
  SET auto_send = excluded.auto_send,
      throttle_minutes = excluded.throttle_minutes,
      updated_at = now();
```

**Default**: `auto_send=false` (safe, human approval required)

### Borrower Email

**Requirements**: `deals.borrower_email` must be set

**SQL**:
```sql
UPDATE deals SET borrower_email = 'borrower@example.com' WHERE id = '<DEAL_UUID>';
```

**Future**: Wire `contacts` table for multiple recipients

### Throttle Settings

**Default**: 240 minutes (4 hours)

**Adjust per deal**:
```sql
UPDATE deal_outbound_settings 
SET throttle_minutes = 120 -- 2 hours
WHERE deal_id = '<DEAL_UUID>';
```

**Disable throttle** (send on every reconcile):
```sql
UPDATE deal_outbound_settings 
SET throttle_minutes = 0
WHERE deal_id = '<DEAL_UUID>';
```

## Testing

### Unit Test: Plan Builder

```typescript
const rulesByKey = new Map([
  ["TAX_RETURNS_PERSONAL_2Y", {
    condition_key: "TAX_RETURNS_PERSONAL_2Y",
    doc_type: "TAX_RETURN",
    min_confidence: 0.8,
    matcher: { required_distinct_count: 2, distinct_key: "tax_year" }
  }]
]);

const conditions = [{
  id: "uuid",
  condition_type: "TAX_RETURNS_PERSONAL_2Y",
  title: "Personal Tax Returns (2 years)",
  satisfied: false,
  evidence: [
    { distinct_key_value: "2023" }
  ]
}];

const plan = buildMissingDocsPlan({ rulesByKey, conditions });

expect(plan.open_count).toBe(1);
expect(plan.items[0].haveCount).toBe(1);
expect(plan.items[0].missingCount).toBe(1);
expect(plan.items[0].detail).toContain("Have years: 2023");
expect(plan.items[0].detail).toContain("Need 2 distinct years");
```

### Integration Test: Full Flow

```typescript
// Setup: deal with 2 open conditions
const dealId = await createTestDeal();
await enableAutoSend(dealId, throttleMinutes: 0); // No throttle for testing
await setBorrowerEmail(dealId, "test@example.com");

// Upload first tax return
await uploadAndProcess(dealId, "2023_tax_return.pdf");

// Check: draft should be created with "missing 1 year"
let drafts = await getDrafts(dealId, "MISSING_DOCS_REQUEST");
expect(drafts).toHaveLength(1);
expect(drafts[0].body).toContain("Have years: 2023");
expect(drafts[0].status).toBe("pending_approval"); // or "sent" if auto-send enabled

// Upload second tax return
await uploadAndProcess(dealId, "2024_tax_return.pdf");

// Check: draft should be updated/canceled (condition satisfied)
drafts = await getDrafts(dealId, "MISSING_DOCS_REQUEST");
// If all conditions satisfied: draft status = "canceled"
// If other conditions still open: draft updated with new plan
```

### Manual Test: API Endpoint

```bash
# 1. Create test deal
DEAL_ID=$(curl -X POST http://localhost:3000/api/deals \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Deal","borrower_email":"test@example.com"}' \
  | jq -r '.id')

# 2. Force update missing docs email
curl -X POST http://localhost:3000/api/deals/$DEAL_ID/outbound/missing-docs \
  | jq

# Expected response:
# {
#   "ok": true,
#   "dealId": "uuid",
#   "result": {
#     "ok": true,
#     "action": "draft_updated",
#     "auto_send": false
#   }
# }

# 3. Check drafts table
psql $DATABASE_URL -c "
  SELECT kind, status, subject, length(body) as body_len
  FROM deal_message_drafts
  WHERE deal_id = '$DEAL_ID'
"
```

## Monitoring

### Query: Pending Drafts

```sql
SELECT 
  d.name AS deal_name,
  dm.kind,
  dm.status,
  dm.subject,
  dm.updated_at,
  dm.body
FROM deal_message_drafts dm
JOIN deals d ON d.id = dm.deal_id
WHERE dm.status = 'pending_approval'
ORDER BY dm.updated_at DESC;
```

### Query: Sent Emails (Last 24h)

```sql
SELECT 
  d.name AS deal_name,
  dol.kind,
  dol.to_email,
  dol.subject,
  dol.provider,
  dol.status,
  dol.error,
  dol.created_at
FROM deal_outbound_ledger dol
JOIN deals d ON d.id = dol.deal_id
WHERE dol.created_at > now() - interval '24 hours'
ORDER BY dol.created_at DESC;
```

### Query: Auto-Send Enabled Deals

```sql
SELECT 
  d.name AS deal_name,
  dos.auto_send,
  dos.throttle_minutes,
  dos.updated_at
FROM deal_outbound_settings dos
JOIN deals d ON d.id = dos.deal_id
WHERE dos.auto_send = true;
```

### Query: Throttle Check

```sql
-- Check if deal can send (not throttled)
SELECT 
  deal_id,
  kind,
  created_at,
  extract(epoch from (now() - created_at))/60 AS minutes_since_last_send
FROM deal_outbound_ledger
WHERE deal_id = '<DEAL_UUID>'
  AND kind = 'MISSING_DOCS_REQUEST'
ORDER BY created_at DESC
LIMIT 1;
```

## Future Enhancements

### 1. Email Provider Integration

**Resend** (recommended):
```typescript
import { Resend } from 'resend';

async function sendEmailResend(args: { to: string; subject: string; body: string }) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: 'underwriting@oldglorybank.com',
    to: args.to,
    subject: args.subject,
    html: convertMarkdownToHtml(args.body), // Or use React Email
  });
  if (error) throw new Error(error.message);
  return { provider: "resend", provider_message_id: data.id };
}
```

**SendGrid**:
```typescript
import sgMail from '@sendgrid/mail';

async function sendEmailSendGrid(args: { to: string; subject: string; body: string }) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
  const msg = {
    to: args.to,
    from: 'underwriting@oldglorybank.com',
    subject: args.subject,
    text: args.body,
  };
  const [response] = await sgMail.send(msg);
  return { provider: "sendgrid", provider_message_id: response.headers['x-message-id'] };
}
```

### 2. React Email Templates

**Install**:
```bash
npm install @react-email/components
```

**Template**:
```tsx
import { Html, Head, Body, Container, Text, Heading, Hr } from '@react-email/components';

export function MissingDocsEmail({ dealName, items }: { dealName: string; items: any[] }) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'sans-serif' }}>
        <Container>
          <Heading>Documents Needed</Heading>
          <Text>We're moving your file forward for <strong>{dealName}</strong>.</Text>
          <Text>To keep underwriting on schedule, please upload:</Text>
          {items.map((it, i) => (
            <div key={i}>
              <Text><strong>{it.title}</strong> — {it.detail}</Text>
            </div>
          ))}
          <Hr />
          <Text>Once these are uploaded, we'll automatically update your file.</Text>
          <Text>Thank you,<br/>Old Glory Bank</Text>
        </Container>
      </Body>
    </Html>
  );
}
```

### 3. Multi-Recipient Support

**Add contacts table**:
```sql
CREATE TABLE deal_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL, -- "borrower", "guarantor", "broker"
  receive_outbound BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Update getBorrowerEmail()**:
```typescript
async function getBorrowerEmails(sb: SupabaseAdmin, dealId: string): Promise<string[]> {
  const { data, error } = await sb
    .from("deal_contacts")
    .select("email")
    .eq("deal_id", dealId)
    .eq("receive_outbound", true);
  
  if (error) throw error;
  return (data ?? []).map((d: any) => d.email);
}
```

### 4. Smart Gap Detection

**Detect missing months in sequence**:
```typescript
function detectMonthGaps(have: string[], need: number): string[] {
  // have: ["2025-01", "2025-03", "2025-04"] → missing: ["2025-02"]
  const sorted = have.sort();
  const missing: string[] = [];
  
  // Generate expected sequence
  const start = new Date(sorted[0]);
  for (let i = 0; i < need; i++) {
    const expected = formatISO(addMonths(start, i), { representation: 'date' }).slice(0, 7);
    if (!have.includes(expected)) {
      missing.push(expected);
    }
  }
  
  return missing;
}
```

**Update email detail**:
```
• **Bank Statements (6 months)** — Missing: Feb 2025, May 2025, Jun 2025
```

### 5. Scheduler (daily sweep)

**Trigger**: processMissingDocsOutbound for all deals with open conditions

**Cron** (Vercel/GitHub Actions):
```typescript
// src/app/api/cron/outbound-sweep/route.ts
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin();
  
  // Get deals with open conditions
  const { data: deals } = await sb
    .from('deals')
    .select('id')
    .not('next_action_json', 'is', null);

  for (const deal of deals ?? []) {
    await processMissingDocsOutbound({ sb, dealId: deal.id, trigger: 'scheduler' });
  }

  return NextResponse.json({ ok: true, processed: deals?.length ?? 0 });
}
```

**vercel.json**:
```json
{
  "crons": [{
    "path": "/api/cron/outbound-sweep",
    "schedule": "0 9 * * *"
  }]
}
```

---

## Summary

**MEGA STEP 12 Complete** ✅

**Capabilities**:
- 📊 **Evidence-based planning**: Analyzes MEGA 11 distinct values
- 📝 **Smart emails**: "Have 2023, need 2 years (missing 1)"
- 🔄 **Auto-updating**: Reconcile → draft updated/sent
- 🎯 **Canonical drafts**: One per deal+kind (updates in place)
- 🚦 **Auto-send with throttle**: Safe defaults, optional per-deal
- 📋 **Audit trail**: Every send logged (success + failures)
- 🔧 **Non-fatal**: Outbound errors don't break reconciliation

**Files**: 4 new (2 libraries + 1 API + 1 migration), 1 updated (reconciler)

**Lines**: ~465 new code

**Next**: Wire Resend/SendGrid, add React Email templates, multi-recipient support

**Immediate Use**:
```bash
# Enable auto-send for a deal
psql $DATABASE_URL -c "
  INSERT INTO deal_outbound_settings (deal_id, auto_send, throttle_minutes)
  VALUES ('<DEAL_UUID>', true, 240)
"

# Upload doc → reconcile → email auto-updates/sends! 🎉
```
