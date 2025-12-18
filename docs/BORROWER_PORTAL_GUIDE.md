# Borrower Portal - Developer Guide

## Overview

The Borrower Portal enables borrowers to complete loan applications via magic link, automatically creating underwriter-ready deals with intelligent pack organization and SBA 7(a) eligibility evaluation.

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. INVITATION                                                   │
│    Underwriter creates application → magic link generated       │
│    borrower_applications.access_token (32 bytes, 30-day expiry) │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. BORROWER WIZARD (5 steps)                                    │
│    /borrower/[token]                                            │
│                                                                 │
│    Step 1: Business Info → annual_revenue, num_employees       │
│    Step 2: Loan Request → loan_amount, loan_purpose            │
│    Step 3: SBA Eligibility → is_for_profit, is_us_based, etc   │
│    Step 4: Upload Docs → multipart/form-data to /api/storage   │
│    Step 5: Review & Submit                                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. SBA ELIGIBILITY EVALUATION                                   │
│    evaluateSBA7aEligibility(borrowerData)                       │
│                                                                 │
│    Gates: Loan Amount | For-Profit | US-Based | Size Standards │
│           Prohibited Types | Equity | Taxes | Foreign Ownership│
│           Character | DSCR                                      │
│                                                                 │
│    Returns: { eligible, status, reasons, warnings }             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. UNDERWRITER HANDOFF AUTOMATION                               │
│    POST /api/borrower/[token]/submit                            │
│                                                                 │
│    ✓ Create deal record                                         │
│    ✓ Create GROUP entity (ensure_group_entity RPC)              │
│    ✓ Create pack from borrower_uploads → pack_items             │
│    ✓ Enqueue OCR classification jobs                            │
│    ✓ Update application status → SUBMITTED                      │
│                                                                 │
│    Returns: { deal_id, sba_eligibility }                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. UNDERWRITER DASHBOARD                                        │
│    /deals/[dealId]                                              │
│                                                                 │
│    - View SBA eligibility status & reasons                      │
│    - Review classified documents in pack                        │
│    - View auto-suggested entities                               │
│    - Assign documents to entities                               │
│    - Check requirements coverage                                │
│    - Generate combined financial spreads                        │
└─────────────────────────────────────────────────────────────────┘
```

## API Endpoints

### Borrower Portal APIs

#### `GET /api/borrower/[token]/load`
Load application data for magic link portal.

**Request:**
```
GET /api/borrower/abc123def456/load
```

**Response:**
```json
{
  "ok": true,
  "application": {
    "id": "app-uuid",
    "status": "IN_PROGRESS",
    "created_at": "2024-01-15T10:00:00Z"
  },
  "applicants": [
    { "name": "John Doe", "ownership_pct": 60, "role": "CEO" }
  ],
  "answers": [
    { "question_key": "business_name", "answer_value": "Acme Corp" },
    { "question_key": "loan_amount", "answer_value": "500000" }
  ],
  "uploads": [
    { "file_key": "deal123/app456/tax_return.pdf", "file_name": "2023_Tax_Return.pdf" }
  ]
}
```

#### `POST /api/borrower/[token]/answer`
Save wizard question answer.

**Request:**
```json
{
  "question_key": "annual_revenue",
  "question_section": "BUSINESS",
  "answer_type": "NUMBER",
  "answer_value": "2500000"
}
```

**Response:**
```json
{
  "ok": true
}
```

#### `POST /api/borrower/[token]/submit`
Submit application and trigger underwriter handoff.

**Response:**
```json
{
  "ok": true,
  "deal_id": "deal-1234567890",
  "application_id": "app-uuid",
  "sba_eligibility": {
    "status": "ELIGIBLE",
    "eligible": true,
    "reasons": [
      "✅ Loan amount ($500,000) is within SBA 7(a) limit ($5,000,000)",
      "✅ Business is for-profit",
      "✅ Business is US-based"
    ],
    "warnings": []
  }
}
```

### Storage APIs

#### `POST /api/storage/upload`
Upload file to Supabase Storage or local fallback.

**Request (multipart/form-data):**
```
dealId: deal-123
applicationId: app-456
file: <binary>
```

**Response:**
```json
{
  "ok": true,
  "file_key": "deal-123/app-456/1705320000_tax_return.pdf",
  "file_name": "2023_Tax_Return.pdf",
  "file_size": 524288,
  "mime_type": "application/pdf"
}
```

#### `GET /api/storage/signed-url?file_key=...&expires_in=3600`
Generate signed URL for secure file access.

**Response:**
```json
{
  "ok": true,
  "signed_url": "https://xyz.supabase.co/storage/v1/object/sign/deal_uploads/...",
  "expires_in": 3600
}
```

## Database Schema

### `borrower_applications`
```sql
id               UUID PRIMARY KEY
deal_id          UUID REFERENCES deals(id)  -- NULL until submitted
access_token     TEXT UNIQUE NOT NULL       -- hex(random_bytes(32))
token_expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
status           TEXT DEFAULT 'DRAFT'       -- DRAFT | IN_PROGRESS | SUBMITTED | EXPIRED
submitted_at     TIMESTAMPTZ
created_at       TIMESTAMPTZ DEFAULT NOW()
updated_at       TIMESTAMPTZ DEFAULT NOW()
```

### `borrower_applicants`
```sql
id             UUID PRIMARY KEY
application_id UUID REFERENCES borrower_applications(id)
name           TEXT NOT NULL
ownership_pct  NUMERIC(5,2)
role           TEXT  -- CEO | CFO | OWNER | GUARANTOR
created_at     TIMESTAMPTZ DEFAULT NOW()
```

### `borrower_answers`
```sql
id               UUID PRIMARY KEY
application_id   UUID REFERENCES borrower_applications(id)
question_key     TEXT NOT NULL      -- annual_revenue | is_for_profit | etc
question_section TEXT               -- BUSINESS | LOAN | ELIGIBILITY
answer_type      TEXT NOT NULL      -- TEXT | NUMBER | BOOLEAN | DATE
answer_value     JSONB NOT NULL     -- flexible storage
answered_at      TIMESTAMPTZ DEFAULT NOW()
```

### `borrower_uploads`
```sql
id             UUID PRIMARY KEY
application_id UUID REFERENCES borrower_applications(id)
file_key       TEXT UNIQUE NOT NULL  -- storage path
file_name      TEXT NOT NULL
file_size      BIGINT
mime_type      TEXT
uploaded_at    TIMESTAMPTZ DEFAULT NOW()
```

## SBA 7(a) Eligibility Gates

The eligibility engine evaluates 10 gates:

| Gate | Rule | Failure Reason |
|------|------|----------------|
| **Loan Amount** | ≤ $5,000,000 | "Loan exceeds SBA 7(a) maximum ($5M)" |
| **For-Profit** | `is_for_profit = true` | "Business must be for-profit" |
| **US-Based** | `is_us_based = true` | "Business must be located in the US" |
| **Size Standards** | `has_sba_size_standard_compliant = true` | "Business exceeds SBA size standards for industry" |
| **Prohibited Types** | No gambling/lending/passive RE/speculative | "Prohibited business type: gambling" |
| **Owner Equity** | 10-20% injection | "Owner equity injection below 10%" |
| **Tax Compliance** | `has_delinquent_taxes = false` | "Delinquent taxes must be resolved" |
| **Foreign Ownership** | < 49% | "Foreign ownership exceeds 49%" |
| **Character** | No criminal record/recent bankruptcy | "Owner has criminal record" |
| **DSCR** | ≥ 1.25 (lender overlay) | "DSCR below lender minimum (1.25)" |

**Output:**
- `eligible: true` - All gates passed
- `eligible: false` - 1+ gates failed (see `reasons`)
- `eligible: null` - Not enough data (see `missing_info`)

## Storage Configuration

### Supabase Storage (Production)

**Bucket:** `deal_uploads` (private)

**File Path Pattern:** `{dealId}/{applicationId}/{timestamp}_{sanitized_filename}`

**Example:** `deal-123/app-456/1705320000_tax_return.pdf`

**Environment Variables:**
```bash
NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Local Fallback (Development)

**Directory:** `.data/uploads/`

**File Path Pattern:** Same as Supabase

**Serving:** `GET /api/files/local?path={file_key}`

**Security:** Path traversal protection (normalizes paths, validates baseDir)

## Example Usage

### Creating a Borrower Application (Underwriter)

```typescript
// In underwriter UI
const { data } = await supabase
  .rpc('create_borrower_application', {
    p_deal_name: 'Acme Corp Application',
    p_borrower_email: 'john@acme.com'
  });

const magicLink = `https://app.example.com/borrower/${data.access_token}`;
// Send magic link via email
```

### Wizard Integration (Borrower)

```typescript
// In borrower wizard component
const saveAnswer = async (questionKey: string, value: any) => {
  await fetch(`/api/borrower/${token}/answer`, {
    method: 'POST',
    body: JSON.stringify({
      question_key: questionKey,
      question_section: 'BUSINESS',
      answer_type: typeof value === 'boolean' ? 'BOOLEAN' : 'TEXT',
      answer_value: value,
    }),
  });
};

const handleSubmit = async () => {
  const res = await fetch(`/api/borrower/${token}/submit`, { method: 'POST' });
  const data = await res.json();
  
  console.log('Deal created:', data.deal_id);
  console.log('SBA eligibility:', data.sba_eligibility.status);
};
```

### File Upload (Borrower)

```typescript
const uploadFile = async (file: File) => {
  const formData = new FormData();
  formData.append('dealId', dealId);
  formData.append('applicationId', applicationId);
  formData.append('file', file);
  
  const res = await fetch('/api/storage/upload', {
    method: 'POST',
    body: formData,
  });
  
  const data = await res.json();
  console.log('Uploaded:', data.file_key);
};
```

## Testing

### Test Borrower Flow (No Supabase)

1. Open borrower wizard: `http://localhost:3000/borrower/test-token-123`
2. Fill wizard steps 1-3
3. Click "Submit Application"
4. Check console logs for mock data flow

### Test with Supabase

1. Set environment variables in `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ```

2. Run migrations:
   ```bash
   psql -h db.xyz.supabase.co -U postgres -d postgres -f docs/migrations/001_multi_entity_foundation.sql
   psql -h db.xyz.supabase.co -U postgres -d postgres -f docs/migrations/002_borrower_portal_foundation.sql
   ```

3. Create application:
   ```sql
   SELECT create_borrower_application('Test Application', 'test@example.com');
   -- Returns: { id: '...', access_token: '...' }
   ```

4. Open wizard with real token:
   ```
   http://localhost:3000/borrower/{access_token}
   ```

## Troubleshooting

### "Invalid or expired link"
- Check token in `borrower_applications` table
- Verify `token_expires_at > NOW()`
- Check RLS policies allow token-based access

### Files not uploading
- Check `.data/uploads/` directory exists and is writable
- Verify Supabase credentials in environment variables
- Check browser console for CORS errors

### SBA eligibility always "UNKNOWN"
- Check answers in `borrower_answers` table
- Verify `question_key` matches expected keys in eligibility engine
- Add console.log in `extractBorrowerDataFromAnswers()` to see parsed data

### TypeScript errors in submit route
- Expected when Supabase client not configured
- Runtime behavior is correct (conditional execution)
- Will resolve once Supabase types are generated

## Next Steps

1. **Configure Supabase** - Set environment variables and run migrations
2. **Test magic link flow** - Create application → send link → complete wizard
3. **Verify handoff** - Check deal created, pack populated, classification enqueued
4. **Enhance wizard UI** - Add eligibility-conditional flow and file uploads
5. **Add entity auto-suggestions** - Call `/api/deals/[dealId]/entities/suggest` after handoff
