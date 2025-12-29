# Deal Cockpit Issues - Fixed

## Issues Identified and Resolved

### 1. ✅ Auto-Seed Checklist Not Updating Pending Required Items

**Root Cause**: Documents uploaded through the banker cockpit weren't automatically linked to checklist items.

**Solution**:
- Created `autoMatchChecklistFromFilename.ts` with intelligent filename pattern matching
- Created `/api/deals/[dealId]/files/auto-match-checklist` endpoint
- Added "Auto-Match Checklist" button to DealFilesCard

**How to Use**:
1. Upload documents to the deal (via any method)
2. In the Deal Cockpit, find the "Deal Files" card
3. Click **"Auto-Match Checklist"** button
4. The system will:
   - Scan all uploaded filenames
   - Match patterns like "business tax", "personal financial statement", etc.
   - Automatically mark matching checklist items as "received"
   - Update the checklist_key on the files

**Pattern Matching Examples**:
- `Business_Tax_Return_2023.pdf` → `IRS_BUSINESS_2Y`
- `Personal_1040_2023.pdf` → `IRS_PERSONAL_2Y`
- `Personal_Financial_Statement.pdf` → `PFS_CURRENT`
- `Rent_Roll_Dec2024.xlsx` → `RENT_ROLL`
- `Bank_Statement_Nov2024.pdf` → `BANK_STMT_3M`

### 2. ✅ CRE Loan Type Differentiation

**Root Cause**: Commercial real estate loans need different underwriting based on use:
- Owner-occupied (business uses the property)
- Investor (rental/investment property)
- Owner-occupied with rent (<49% leased out)

**Solution**:
- Expanded `LoanType` enum to include:
  - `CRE_OWNER_OCCUPIED`
  - `CRE_INVESTOR`
  - `CRE_OWNER_OCCUPIED_WITH_RENT`
- Added different checklist items for each subtype:
  - **Owner-Occupied**: Business plan, projected occupancy
  - **Investor**: Operating agreement, exit strategy
  - **Mixed Use**: Lease schedule, rental income projection

**Updated Components**:
- `src/lib/deals/checklistPresets.ts` - Added CRE subtypes and specific checklist items
- `src/components/deals/DealIntakeCard.tsx` - Dropdown now shows 3 CRE options
- `src/app/api/deals/[dealId]/intake/set/route.ts` - Validates new loan types

**How to Use**:
1. In Deal Cockpit → Deal Intake card
2. Select loan type dropdown
3. Choose from:
   - **CRE - Owner Occupied** (business will occupy 51%+ of space)
   - **CRE - Investor** (rental/investment property)
   - **CRE - Owner Occupied with Rent** (business occupies 51%+, but leases <49%)
4. Click "Save + Auto-Seed Checklist"
5. The appropriate checklist items will be created based on the CRE subtype

### 3. ⚠️ Button Functionality Issues

**Potential Causes**:
1. **Client-side JavaScript not loaded**: Check browser console for errors
2. **Build issues**: Run `npm run build` to check for TypeScript errors
3. **Missing environment variables**: Ensure `.env.local` has required keys

**Troubleshooting Steps**:
1. Open browser DevTools (F12)
2. Check Console tab for errors
3. Check Network tab to see if API calls are failing
4. Verify authentication (Clerk session)

Common issues:
- `useState` hooks not updating (React version mismatch)
- API routes returning 401 (not signed in)
- Missing Supabase credentials

## Files Modified

### New Files Created:
1. `src/lib/deals/autoMatchChecklistFromFilename.ts` - Auto-matching logic
2. `src/app/api/deals/[dealId]/files/auto-match-checklist/route.ts` - API endpoint

### Files Modified:
1. `src/lib/deals/checklistPresets.ts` - Added CRE subtypes
2. `src/components/deals/DealIntakeCard.tsx` - Updated loan type dropdown
3. `src/app/api/deals/[dealId]/intake/set/route.ts` - Added validation for new types
4. `src/components/deals/DealFilesCard.tsx` - Added auto-match button

## Testing Steps

### Test Auto-Seed and Auto-Match:
1. Navigate to `/deals/[dealId]/cockpit`
2. In "Deal Intake" card:
   - Select "CRE - Owner Occupied"
   - Click "Save + Auto-Seed Checklist"
   - Page reloads → checklist items appear
3. Upload test files (or use existing):
   - `Business_Tax_Return_2023.pdf`
   - `Personal_Financial_Statement.pdf`
   - `Personal_Tax_Return_2023.pdf`
4. In "Deal Files" card:
   - Click "Auto-Match Checklist"
   - Should see: "Matched X checklist items from Y files"
5. Check "Deal Checklist" or "Enhanced Checklist" cards:
   - Previously "Pending Required" items should now show "Received ✅"

### Test CRE Subtypes:
1. Create 3 test deals
2. For each, select different CRE subtype
3. Click "Save + Auto-Seed Checklist"
4. Verify different checklist items:
   - **Owner-Occupied**: Should include "Business plan", "Projected occupancy"
   - **Investor**: Should include "Exit strategy", "Operating agreement"
   - **Mixed Use**: Should include both owner-occupied items + "Lease schedule", "Rental income projection"

## Architecture Notes

### Why This Approach?

**Pattern Matching vs AI Classification**:
- ✅ **Fast**: No LLM latency
- ✅ **Deterministic**: Same filename always matches same keys
- ✅ **Auditable**: Clear rules in code
- ✅ **Extensible**: Easy to add new patterns

**Manual Trigger vs Auto-Trigger**:
- Current: Manual "Auto-Match Checklist" button
- Future: Could add database trigger on `deal_files` insert
- Tradeoff: Manual gives banker control, auto is hands-off

**Two Checklist Tables**:
- `deal_checklist_items` - Banker-facing (Deal Cockpit)
- `deal_portal_checklist_items` - Borrower-facing (Borrower Portal)
- These are intentionally separate for different UX flows

## Next Steps (Optional Enhancements)

### Immediate (if needed):
1. **Add database trigger** to auto-run matching on file upload
2. **Improve patterns** based on real-world filename variations
3. **Add manual override** to assign checklist keys in UI

### Future:
1. **AI-powered classification** for ambiguous files
2. **Multi-file matching** (e.g., 3 years of tax returns → IRS_BUSINESS_3Y)
3. **Confidence scoring** for matches (exact vs fuzzy)
4. **Borrower portal integration** (auto-match there too)

## Database Schema Changes

No schema changes were required - using existing tables:
- `deal_checklist_items` (loan_type column already supports text values)
- `deal_files` (checklist_key column already exists)

The new loan types (`CRE_OWNER_OCCUPIED`, etc.) are just string values in the `loan_type` column of `deal_intake` table.

## Environment Requirements

No new environment variables needed. Uses existing:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLERK_SECRET_KEY`

## Support

If buttons still aren't working after these fixes:
1. Check browser console for errors
2. Run `npm run build` and check for TypeScript errors
3. Verify user is authenticated (signed in with Clerk)
4. Check that Supabase service role key is set
5. Look for API route errors in server logs

Common error messages:
- **"Unauthorized"** → Not signed in or Clerk session expired
- **"Missing loanType"** → Frontend not sending correct body
- **"Failed to create signed URL"** → Supabase storage permissions issue
