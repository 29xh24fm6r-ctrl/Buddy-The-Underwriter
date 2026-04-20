# Deal Intake Flow - Fixed ✅

## The Problem

When you uploaded documents at `/deals/new` (business tax returns, PFS, etc.) and then clicked "Save + Auto-Seed Checklist" in the cockpit, the checklist didn't recognize any of the previously uploaded documents.

## Root Cause

The upload API route (`/api/deals/[dealId]/upload`) was saving files to `/tmp` on disk but **NOT writing them to the database** (`deal_files` table). So when the checklist was created, there were no database records to match against.

## The Fix

### 1. Database Integration for Uploads
- Updated `/api/deals/[dealId]/upload` to insert files into `deal_files` table
- Now every upload is tracked in the database with metadata (filename, size, mime type, etc.)

### 2. Automatic Checklist Matching
- When you click "Save + Auto-Seed Checklist", it now:
  1. Creates the checklist items based on loan type
  2. Fetches all previously uploaded files from the database
  3. Automatically matches filenames to checklist items
  4. Shows a success message: "✅ Automatically matched X uploaded documents to checklist items!"

### 3. Corrected Business Plan Requirement
- **Removed** business plan from conventional CRE loans
- Business plans are **only required for SBA startups** (businesses with less than 2 years)
- Conventional loans (2+ years with tax returns) don't need business plans

## How It Works Now

### Your Workflow:
1. **Deals Page** → Click "+ New Deal" or "Intake" button
2. **Deal Intake Console** (`/deals/new`):
   - Enter deal name
   - Upload documents (drag & drop or browse):
     - Business tax returns (last 2-3 years)
     - Personal financial statement (PFS)
     - Personal tax returns
     - Bank statements
     - etc.
   - Click **"Start Deal Processing"**
3. **Deal Cockpit** (`/deals/[dealId]/cockpit`):
   - Fill out "Deal Intake" section:
     - Select loan type (CRE - Owner Occupied, Investor, etc.)
     - Enter borrower info (optional)
   - Click **"Save + Auto-Seed Checklist"**
   - **✨ MAGIC HAPPENS**:
     - Checklist items are created
     - Previously uploaded files are automatically matched
     - You see: "✅ Automatically matched 3 uploaded documents to checklist items!"
     - Page reloads
     - Checklist now shows items as "Received ✅" instead of "Pending Required"

### Example Auto-Matching:
- `Total Financial Solutions BTR 2023.pdf` → Matches **"Business tax returns (last 2 years)"**
- `Total Financial Solutions BTR 2024.pdf` → Matches **"Business tax returns (last 2 years)"**
- `Total Financial Solutions BTR 2022.pdf` → Matches **"Business tax returns (last 2 years)"**
- Any file with "personal financial" or "PFS" → Matches **"Personal Financial Statement"**
- Any file with "personal tax" or "1040" → Matches **"Personal tax returns"**

## Pattern Matching Logic

The system recognizes these filename patterns:

| Pattern | Matches Checklist Item |
|---------|----------------------|
| `business tax`, `1120`, `1065`, `Schedule C` | Business Tax Returns |
| `personal tax`, `1040` | Personal Tax Returns |
| `personal financial`, `PFS`, `financial statement` | Personal Financial Statement (current) |
| `bank statement`, `checking`, `savings` | Bank statements |
| `rent roll`, `rental income` | Rent roll |
| `lease`, `leases` | Leases |
| `YTD`, `year to date`, `interim financial` | Year-to-date financials |
| `operating statement`, `property income` | Property operating statement |
| `appraisal`, `valuation` | Appraisal |
| `insurance`, `property insurance` | Insurance |
| `SBA 1919`, `Form 1919` | SBA Form 1919 |
| `SBA 413`, `Form 413` | SBA Form 413 |
| `debt schedule`, `liabilities` | Debt schedule |

## CRE Loan Type Options

When selecting loan type, you now have 3 CRE options:

### 1. CRE - Owner Occupied
- Business will occupy **51%+ of the property**
- Required documents:
  - All core items (PFS, tax returns, financials)
  - All CRE items (rent roll, property operating statement, etc.)
  - Property use statement (optional)

### 2. CRE - Investor (Rental Property)
- Property is for **investment/rental income**
- Required documents:
  - All core items
  - All CRE items
  - Operating agreement / entity docs (optional)
  - Exit strategy / business plan (optional)

### 3. CRE - Owner Occupied with Rent
- Business occupies **51%+**, but leases out **<49%** of space
- Required documents:
  - All core items
  - All CRE items
  - Property use statement (optional)
  - **Lease schedule** (shows which spaces are leased vs occupied)
  - **Rental income projection** (for the <49% leased portion)

## Files Modified

### Core Changes:
1. **`src/app/api/deals/[dealId]/upload/route.ts`**
   - Added Supabase database insertion
   - Files now tracked in `deal_files` table

2. **`src/app/api/deals/[dealId]/intake/set/route.ts`**
   - Auto-runs filename matching after seeding checklist
   - Returns match results to frontend

3. **`src/components/deals/DealIntakeCard.tsx`**
   - Shows auto-match success message
   - Updated CRE dropdown options

4. **`src/lib/deals/checklistPresets.ts`**
   - Removed business plan from conventional CRE
   - Added CRE subtypes
   - Added specific checklist items for each subtype

### Previously Created (from earlier fix):
5. **`src/lib/deals/autoMatchChecklistFromFilename.ts`**
   - Pattern matching logic
   
6. **`src/app/api/deals/[dealId]/files/auto-match-checklist/route.ts`**
   - Manual trigger endpoint (still available if needed)

## Testing Steps

1. **Start Fresh**:
   - Go to `/deals`
   - Click "+ New Deal"

2. **Upload Test Files**:
   - Name them clearly (e.g., "Business_Tax_Return_2023.pdf", "Personal_Financial_Statement.pdf")
   - Click "Start Deal Processing"

3. **In Cockpit**:
   - Select "CRE - Owner Occupied"
   - Click "Save + Auto-Seed Checklist"
   - **Look for**: Green success message showing "✅ Automatically matched X uploaded documents"
   - Page will reload

4. **Verify**:
   - Scroll to "Enhanced Checklist" card (right column)
   - Items should show "✅ Received" instead of "🔴 Pending Required"
   - Check "Deal Files" card - files should have `checklist_key` assigned

## Troubleshooting

### If files still don't match:
1. Check the filenames - they need to contain recognizable keywords
2. Look at browser console (F12) for any errors
3. Try the manual "Auto-Match Checklist" button in Deal Files card as backup

### If no files appear in Deal Files card:
1. Files might not have been saved to database during upload
2. Check browser console during upload for errors
3. Verify Supabase credentials are set correctly

### If checklist doesn't appear:
1. Make sure you selected a loan type
2. Check that "Save + Auto-Seed Checklist" button actually triggered
3. Look for error messages in browser console

## What's Next

The system is now fully automatic:
1. ✅ Upload documents during deal creation
2. ✅ Files saved to database
3. ✅ Select loan type & seed checklist
4. ✅ Auto-matching happens automatically
5. ✅ See results immediately

No more manual "Auto-Match Checklist" button clicking needed (though it's still there as a backup/retry option).

## Business Logic Notes

### Conventional vs SBA Loans:
- **Conventional loans** (mature businesses, 2+ years): 
  - NO business plan required
  - Rely on historical financials and tax returns
  
- **SBA startup loans** (new businesses, <2 years):
  - Business plan IS required
  - Need projections, use of proceeds, etc.

### CRE Occupancy Rules:
- **Owner-occupied**: 51%+ owner use
- **Investor**: Rental/investment property
- **Mixed use**: 51%+ owner, <49% leased (special underwriting)

The system now correctly differentiates these and generates appropriate checklists!
