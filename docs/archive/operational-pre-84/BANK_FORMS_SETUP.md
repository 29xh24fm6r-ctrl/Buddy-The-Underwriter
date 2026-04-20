# Bank Forms System - Setup Guide

## Overview
Auto-generate filled bank PDFs (PFS, Credit Apps) from deal data using template mapping.

## Step 1: Create Supabase Storage Buckets

Go to Supabase Dashboard → Storage → Create Bucket (all **private**, no public access):

1. **bank-templates** - Stores uploaded PDF templates
2. **bank-policies** - Stores credit policy documents  
3. **filled-documents** - Stores generated filled PDFs

**Settings for each:**
- Public: `false` (unchecked)
- File size limit: 50MB
- Allowed MIME types: `application/pdf` (or leave empty for all)

## Step 2: Create Database Tables

Run these migrations in Supabase SQL Editor:

```sql
-- Bank profiles
CREATE TABLE IF NOT EXISTS bank_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link deals to banks (one bank per deal)
CREATE TABLE IF NOT EXISTS deal_bank_links (
  deal_id UUID PRIMARY KEY REFERENCES deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL REFERENCES bank_profiles(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PDF templates uploaded by banks
CREATE TABLE IF NOT EXISTS bank_document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL REFERENCES bank_profiles(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL, -- e.g., "PFS", "CREDIT_APP"
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL, -- storage path
  metadata JSONB DEFAULT '{}', -- stores pdf_form_fields: [{name, type}]
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bank_id, template_key, version)
);

-- Field mappings (canonical → PDF field)
CREATE TABLE IF NOT EXISTS bank_template_field_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES bank_document_templates(id) ON DELETE CASCADE,
  canonical_field TEXT NOT NULL, -- e.g., "borrower.full_name"
  pdf_field TEXT NOT NULL, -- e.g., "BorrowerName" from PDF AcroForm
  transform TEXT, -- optional: "money", "date", "upper", "boolean_yesno"
  required BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(template_id, canonical_field, pdf_field)
);

-- Credit policies (for AI context)
CREATE TABLE IF NOT EXISTS bank_credit_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL REFERENCES bank_profiles(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  extracted_text TEXT, -- nullable, for future OCR
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bank_id, version)
);

-- Generated filled documents (audit trail)
CREATE TABLE IF NOT EXISTS filled_bank_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL REFERENCES bank_profiles(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES bank_document_templates(id) ON DELETE CASCADE,
  output_file_path TEXT NOT NULL,
  status TEXT DEFAULT 'generated',
  metadata JSONB DEFAULT '{}', -- tracks missing_canonical[], missing_pdf_fields[]
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_deal_bank_links_bank ON deal_bank_links(bank_id);
CREATE INDEX IF NOT EXISTS idx_templates_bank_active ON bank_document_templates(bank_id, is_active);
CREATE INDEX IF NOT EXISTS idx_field_maps_template ON bank_template_field_maps(template_id);
CREATE INDEX IF NOT EXISTS idx_filled_docs_deal ON filled_bank_documents(deal_id);
```

## Step 3: One-Time Setup

### 3.1 Insert a Bank

Go to Table Editor → `bank_profiles` → Insert Row:

```
name: Old Glory Bank
slug: ogb
```

Copy the generated `id` (UUID).

### 3.2 Link a Deal to the Bank

From browser console on any Buddy page:

```javascript
fetch("/api/admin/deals/<DEAL_ID>/set-bank", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bank_id: "<BANK_ID>" })
}).then(r => r.json()).then(console.log)
```

Replace:
- `<DEAL_ID>` - UUID of existing deal
- `<BANK_ID>` - UUID from step 3.1

## Step 4: Upload Template & Map Fields

1. Go to `/banks/<BANK_ID>/documents` (e.g., `/banks/123.../documents`)
2. **Upload Template:**
   - Template Key: `PFS`
   - Version: `v1`
   - Name: `Personal Financial Statement`
   - Choose PDF file (must have AcroForm fields)
   - Click "Upload Template PDF"
3. **Map Fields:**
   - Select template from left panel
   - Add mappings:
     - Canonical Field: `borrower.full_name` → PDF Field: `BorrowerName` → Transform: `upper`
     - Canonical Field: `deal.requested_amount` → PDF Field: `LoanAmount` → Transform: `money`
   - Repeat for all required fields

## Step 5: Generate PDFs

1. Go to Deal Cockpit for the linked deal
2. BankDocsCard should now show "Generate PFS" / "Generate Credit App" buttons
3. Click to generate → filled PDF stored in `filled-documents` bucket
4. Download link appears with 10-minute expiry

## Canonical Fields Available

See [canonicalFields.ts](src/lib/bankForms/canonicalFields.ts) for full list:

**Borrower:**
- `borrower.full_name`
- `borrower.first_name`
- `borrower.last_name`
- `borrower.email`
- `borrower.phone`
- `borrower.ssn`

**Deal:**
- `deal.requested_amount`
- `deal.term_months`
- `deal.purpose`

**PFS (optional):**
- `pfs.total_assets`
- `pfs.total_liabilities`
- `pfs.net_worth`
- `pfs.annual_income`

**Signature:**
- `signature.name`
- `signature.date`
- `signature.title`

## Transforms

- `money` - Formats as `$500,000.00`
- `date` - ISO 8601: `2025-12-18`
- `upper` - UPPERCASE TEXT
- `boolean_yesno` - Maps true→"YES", false→"NO"

## Audit Trail

All generated documents logged to `filled_bank_documents` table with metadata:
- `missing_canonical[]` - Required canonical fields not found in deal data
- `missing_pdf_fields[]` - Mapped PDF fields not found in template

## Security

- All buckets **private** (service role only)
- Signed URLs expire in 10 minutes
- SHA256 hashing on uploads for integrity
- Version management prevents accidental overwrites
- RLS policies recommended for production
