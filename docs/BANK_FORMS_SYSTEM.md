# Bank Forms PDF System - Implementation Complete

## ✅ Files Created (4 files)

### Core Libraries
1. **[src/lib/bankForms/canonicalFields.ts](../src/lib/bankForms/canonicalFields.ts)** - Canonical field dictionary
   - 17 standard fields (borrower, deal, pfs, signature)
   - Single source of truth for all bank forms
   
2. **[src/lib/bankForms/pdf.ts](../src/lib/bankForms/pdf.ts)** - PDF utilities
   - `listPdfFormFields()` - Inspect PDF form field names
   - `fillPdfFormFields()` - Fill PDF with data + transforms
   - Supports: money, date, upper, boolean_yesno transforms
   - Safe field handling with try/catch
   
3. **[src/lib/bankForms/map.ts](../src/lib/bankForms/map.ts)** - Mapping engine
   - `getActiveTemplate()` - Fetch active template for bank
   - `getTemplateMaps()` - Get field mappings for template
   - `buildPdfFieldValuesFromCanonical()` - Map canonical → PDF fields

### Documentation
4. **[docs/SUPABASE_STORAGE_SETUP.md](../docs/SUPABASE_STORAGE_SETUP.md)** - Complete setup guide
   - Storage bucket configuration (bank-templates, bank-policies, filled-documents)
   - RLS policies
   - Database schema
   - Usage examples

## 📦 Dependencies Installed

```bash
✅ pdf-lib - Server-side PDF manipulation
```

## 🗄️ Database Schema Required

```sql
-- Templates table
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

-- Field mappings
CREATE TABLE bank_template_field_maps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID REFERENCES bank_document_templates(id) ON DELETE CASCADE,
  canonical_field TEXT NOT NULL,
  pdf_field TEXT NOT NULL,
  transform TEXT,
  required BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(template_id, canonical_field)
);
```

## 🚀 Usage Flow

### 1. Setup Template (One-time)
```typescript
// Upload template PDF
const { data } = await supabase.storage
  .from('bank-templates')
  .upload('old-glory-bank/pfs-form/template.pdf', pdfFile);

// Create template record
const { data: template } = await supabase
  .from('bank_document_templates')
  .insert({
    bank_id: 'old-glory-bank',
    template_key: 'pfs-form',
    name: 'Personal Financial Statement',
    storage_path: 'old-glory-bank/pfs-form/template.pdf',
  })
  .select()
  .single();

// Map canonical fields → PDF fields
await supabase.from('bank_template_field_maps').insert([
  { 
    template_id: template.id, 
    canonical_field: 'borrower.name', 
    pdf_field: 'BorrowerName' 
  },
  { 
    template_id: template.id, 
    canonical_field: 'pfs.total_assets', 
    pdf_field: 'TotalAssets',
    transform: 'money' 
  },
  // ... more mappings
]);
```

### 2. Inspect PDF Fields (During setup)
```typescript
import { listPdfFormFields } from '@/lib/bankForms/pdf';

const fields = await listPdfFormFields(templateBytes);
console.log(fields);
// [{ name: 'BorrowerName', type: 'PDFTextField' }, ...]
```

### 3. Fill PDF (Runtime)
```typescript
import { getActiveTemplate, getTemplateMaps, buildPdfFieldValuesFromCanonical } from '@/lib/bankForms/map';
import { fillPdfFormFields } from '@/lib/bankForms/pdf';

// 1. Get template + mappings
const template = await getActiveTemplate('old-glory-bank', 'pfs-form');
const maps = await getTemplateMaps(template.id);

// 2. Build canonical values from your data
const canonicalValues = {
  'borrower.name': 'John Doe',
  'borrower.ssn': '123-45-6789',
  'pfs.total_assets': 500000,
  'pfs.total_liabilities': 100000,
  'pfs.net_worth': 400000,
  'signature.date': new Date(),
};

// 3. Map canonical → PDF fields
const { fieldValues, transforms } = buildPdfFieldValuesFromCanonical({
  canonicalValues,
  maps,
});

// 4. Download template from storage
const { data: templateBlob } = await supabase.storage
  .from('bank-templates')
  .download(template.storage_path);
const templateBytes = new Uint8Array(await templateBlob.arrayBuffer());

// 5. Fill PDF
const { pdfBytes, missingFields } = await fillPdfFormFields({
  pdfBytes: templateBytes,
  fieldValues,
  transforms,
  flatten: true, // Flatten to prevent editing
});

// 6. Upload filled document
await supabase.storage
  .from('filled-documents')
  .upload(`deal_${dealId}/pfs/pfs-${Date.now()}.pdf`, pdfBytes);
```

## 🔧 Transforms Available

| Transform | Input | Output Example |
|-----------|-------|----------------|
| `money` | `500000` | `$500,000.00` |
| `date` | `Date` object | `2025-12-18` |
| `upper` | `"john doe"` | `"JOHN DOE"` |
| `boolean_yesno` | `true` | `"YES"` |
| (none) | any | String conversion |

## 📋 Next Steps

1. **Create Supabase Buckets** (see [SUPABASE_STORAGE_SETUP.md](../docs/SUPABASE_STORAGE_SETUP.md))
   - [ ] `bank-templates` (private)
   - [ ] `bank-policies` (private)
   - [ ] `filled-documents` (private)

2. **Create Database Tables**
   - [ ] `bank_document_templates`
   - [ ] `bank_template_field_maps`

3. **Upload First Template**
   - [ ] Get bank's PDF form template
   - [ ] Inspect fields with `listPdfFormFields()`
   - [ ] Create template record
   - [ ] Map canonical fields → PDF field names

4. **Create API Routes** (Optional)
   - POST `/api/deals/[dealId]/documents/fill` - Fill template
   - GET `/api/templates/[templateId]/fields` - Inspect fields
   - POST `/api/templates/[templateId]/mappings` - Update mappings

## ✅ Compilation Status

All files compile with **zero errors**:
- ✅ canonicalFields.ts
- ✅ pdf.ts
- ✅ map.ts

## 🎯 Key Features

- **Type-safe canonical fields** - TypeScript union ensures consistency
- **Transform pipeline** - Money, dates, boolean formatting
- **Safe field handling** - Graceful errors for missing fields
- **Template versioning** - Track template versions per bank
- **Flatten support** - Prevent editing of filled forms
- **Multi-bank support** - Each bank can have custom templates

---

**System ready for production use.** Create storage buckets and database tables to start filling forms.
