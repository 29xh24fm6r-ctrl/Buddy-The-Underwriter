# Supabase Storage Setup for Bank Forms

## Required Storage Buckets

Create these 3 **private** buckets in Supabase Storage:

### 1. `bank-templates`
- **Purpose:** Store blank PDF form templates for each bank
- **Privacy:** Private (requires authentication)
- **Path pattern:** `{bank_id}/{template_key}/template.pdf`
- **Example:** `old-glory-bank/pfs-form/template.pdf`

### 2. `bank-policies`
- **Purpose:** Store bank-specific policies, guidelines, and documentation
- **Privacy:** Private (requires authentication)
- **Path pattern:** `{bank_id}/{policy_type}/{filename}.pdf`
- **Example:** `old-glory-bank/underwriting-guidelines/sba-7a-policy.pdf`

### 3. `filled-documents`
- **Purpose:** Store completed/filled PDF documents for borrowers
- **Privacy:** Private (requires authentication)
- **Path pattern:** `{deal_id}/{document_type}/{filename}.pdf`
- **Example:** `deal_123/pfs/john-doe-pfs-2025-12-18.pdf`

## SQL Setup Commands

Run these in Supabase SQL Editor:

```sql
-- Create buckets (if not using UI)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('bank-templates', 'bank-templates', false, 52428800, ARRAY['application/pdf']::text[]),
  ('bank-policies', 'bank-policies', false, 52428800, ARRAY['application/pdf']::text[]),
  ('filled-documents', 'filled-documents', false, 52428800, ARRAY['application/pdf']::text[])
ON CONFLICT (id) DO NOTHING;

-- RLS policies for bank-templates bucket
CREATE POLICY "Authenticated users can read bank templates"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'bank-templates');

CREATE POLICY "Service role can upload bank templates"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'bank-templates');

-- RLS policies for bank-policies bucket
CREATE POLICY "Authenticated users can read bank policies"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'bank-policies');

CREATE POLICY "Service role can upload bank policies"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'bank-policies');

-- RLS policies for filled-documents bucket
CREATE POLICY "Users can read their own filled documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'filled-documents' AND
  (storage.foldername(name))[1] IN (
    SELECT deal_id FROM deals WHERE borrower_id = auth.uid()
  )
);

CREATE POLICY "Service role can manage filled documents"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'filled-documents')
WITH CHECK (bucket_id = 'filled-documents');
```

## Database Schema for Template Mapping

```sql
-- Bank document templates table
CREATE TABLE bank_document_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_id TEXT NOT NULL,
  template_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  storage_path TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bank_id, template_key, version)
);

-- Field mappings: canonical_field → pdf_field
CREATE TABLE bank_template_field_maps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID REFERENCES bank_document_templates(id) ON DELETE CASCADE,
  canonical_field TEXT NOT NULL,
  pdf_field TEXT NOT NULL,
  transform TEXT, -- 'money', 'date', 'upper', 'boolean_yesno'
  required BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(template_id, canonical_field)
);

CREATE INDEX idx_template_maps_template ON bank_template_field_maps(template_id);
CREATE INDEX idx_templates_bank_key ON bank_document_templates(bank_id, template_key, is_active);
```

## Usage Example

```typescript
// 1. Upload template PDF to Supabase Storage
const templatePath = 'old-glory-bank/pfs-form/template.pdf';
const { data: uploadData } = await supabase.storage
  .from('bank-templates')
  .upload(templatePath, pdfFile);

// 2. Create template record
await supabase.from('bank_document_templates').insert({
  bank_id: 'old-glory-bank',
  template_key: 'pfs-form',
  name: 'Personal Financial Statement',
  storage_path: templatePath,
  is_active: true,
  version: 1,
});

// 3. Create field mappings
await supabase.from('bank_template_field_maps').insert([
  { template_id, canonical_field: 'borrower.name', pdf_field: 'borrower_name' },
  { template_id, canonical_field: 'pfs.total_assets', pdf_field: 'total_assets', transform: 'money' },
  // ... more mappings
]);

// 4. Fill and download
const filledPdf = await fillPdfFormFields({
  pdfBytes: templateBytes,
  fieldValues: { borrower_name: 'John Doe', total_assets: 500000 },
  transforms: { total_assets: 'money' },
  flatten: true,
});

// 5. Upload filled document
await supabase.storage
  .from('filled-documents')
  .upload(`deal_123/pfs/filled-${Date.now()}.pdf`, filledPdf.pdfBytes);
```

## Verification Checklist

- [ ] All 3 buckets created (bank-templates, bank-policies, filled-documents)
- [ ] All buckets set to **private** (public = false)
- [ ] RLS policies configured for each bucket
- [ ] Database tables created (bank_document_templates, bank_template_field_maps)
- [ ] Test template upload/download works
- [ ] Test filled document generation works
