# CRITICAL BUG FIX: Auto-Seed Not Working

## Problem
User uploads documents → navigates to cockpit → clicks "Save + Auto-Seed Checklist" → nothing happens. Checklist stays empty even though files are visible in Upload Audit Trail.

## Root Cause
**Table Mismatch:** The `/api/deals/[dealId]/auto-seed` endpoint was reading `loan_type` from the wrong table:
- ❌ **Was reading from:** `deals` table (which doesn't have `loan_type` column)
- ✅ **Should read from:** `deal_intake` table (where loan type is actually saved)

When intake form saves data, it writes to `deal_intake` table. But auto-seed was looking in `deals` table, finding NULL, and returning early with "Deal intake incomplete" message.

## Fix Applied

### File: `src/app/api/deals/[dealId]/auto-seed/route.ts`

**Before:**
```typescript
const { data: deal } = await sb
  .from("deals")
  .select("loan_type, sba_program")
  .eq("id", dealId)
  .eq("bank_id", bankId)
  .single();

if (!deal || !deal.loan_type) {
  return NextResponse.json({
    ok: true,
    status: "pending",
    message: "Deal intake incomplete. Please set loan type first.",
  });
}
```

**After:**
```typescript
const { data: intake, error: intakeErr } = await sb
  .from("deal_intake")  // ✅ Correct table
  .select("loan_type, sba_program")
  .eq("deal_id", dealId)
  .single();

if (intakeErr || !intake || !intake.loan_type) {
  return NextResponse.json({
    ok: true,
    status: "pending",
    message: "Deal intake incomplete. Please set loan type first.",
    checklist: { seeded: 0, matched: 0, total: 0 },
  });
}
```

### Additional Improvements

1. **Added comprehensive console logging** to trace execution:
   - `[auto-seed] Processing request for dealId:...`
   - `[auto-seed] Intake data:...`
   - `[auto-seed] Generated checklist rows:...`
   - `[auto-seed] Found files for matching:...`
   - `[auto-seed] Match result for [filename]:...`
   - `[auto-seed] Success! Checklist:...`

2. **Enhanced client-side logging** in `DealIntakeCard.tsx`:
   - Logs intake save request/response
   - Logs auto-seed request/response
   - Logs checklist refresh callback
   - All errors logged to console with context

3. **Enhanced client-side logging** in `EnhancedChecklistCard.tsx`:
   - Logs component mount
   - Logs refresh function registration
   - Logs checklist data fetch results

## How It Works Now

### Correct Flow:
1. User uploads files on "New Deal" page
2. Files saved to `deal_documents` table
3. User navigates to `/deals/[dealId]/cockpit`
4. User selects loan type (e.g., "CRE - Owner Occupied")
5. User clicks "Save + Auto-Seed Checklist"
6. **Intake endpoint** saves to `deal_intake` table with `loan_type = "CRE_OWNER_OCCUPIED"`
7. **Auto-seed endpoint** reads from `deal_intake` table ✅
8. Generates checklist based on loan type
9. Matches uploaded files to checklist items
10. Returns success with details
11. Checklist refreshes automatically

## Testing Instructions

1. **Open browser console** (F12)
2. Click "Save + Auto-Seed Checklist"
3. **Watch console logs:**
   ```
   [DealIntakeCard] Saving intake with loan_type: CRE_OWNER_OCCUPIED
   [DealIntakeCard] Intake save response: { ok: true, ... }
   [DealIntakeCard] Calling auto-seed endpoint...
   [auto-seed] Processing request for dealId: 5e949152-...
   [auto-seed] Intake data: { intake: { loan_type: "CRE_OWNER_OCCUPIED", ... } }
   [auto-seed] Generated checklist rows: 12
   [auto-seed] Checklist items upserted successfully
   [auto-seed] Found files for matching: 6
   [auto-seed] Match result for "Total Financial Solutions BTR 2022.pdf": { updated: 1 }
   [auto-seed] Success! Checklist: { seeded: 12, matched: 3, total: 12 }
   [DealIntakeCard] Auto-seed response: { ok: true, ... }
   [DealIntakeCard] Triggering checklist refresh callback
   [EnhancedChecklistCard] Refreshing checklist for deal: 5e949152-...
   [EnhancedChecklistCard] Checklist data: { ok: true, items: [... 12 items] }
   [DealIntakeCard] Reloading page...
   ```

4. **Success message should show:**
   ```
   ✅ Success!
   • Loan type: CRE_OWNER_OCCUPIED
   • Checklist items created: 12
   • Files matched: 3
   
   Refreshing page in 2 seconds...
   ```

5. After page reloads, checklist should display with items marked "Received" (green) or "Pending" (amber)

## Files Modified

1. **src/app/api/deals/[dealId]/auto-seed/route.ts**
   - Changed query from `deals` table to `deal_intake` table
   - Added extensive console logging
   - Added error details to response

2. **src/components/deals/DealIntakeCard.tsx**
   - Added console logging for save flow
   - Enhanced error messages with "Check browser console" prompt
   - Added loan type to success message

3. **src/components/deals/EnhancedChecklistCard.tsx**
   - Added console logging for refresh flow
   - Logs component lifecycle events

## Database Schema Notes

**Two tables store deal data:**

```sql
-- Main deal record (minimal metadata)
deals {
  id uuid PRIMARY KEY,
  bank_id uuid,
  name text,
  status text,
  created_at timestamptz,
  -- NO loan_type column here!
}

-- Deal intake form data (where loan type lives)
deal_intake {
  deal_id uuid PRIMARY KEY REFERENCES deals(id),
  loan_type text,  -- ✅ This is where it's stored!
  sba_program text,
  borrower_name text,
  borrower_email text,
  borrower_phone text,
  created_at timestamptz,
  updated_at timestamptz
}
```

## What Was Broken vs Fixed

| Component | Before | After |
|-----------|--------|-------|
| Auto-seed endpoint | Read from `deals.loan_type` (NULL) | Read from `deal_intake.loan_type` ✅ |
| Error visibility | Silent failure | Detailed console logs |
| Success feedback | Generic message | Specific counts + loan type |
| Debugging | Impossible to trace | Full execution trace |

## Status

✅ **FIXED** - Auto-seed now reads from correct table and generates checklist properly

## Next Steps for User

1. Refresh browser page
2. Open browser console (F12)
3. Click "Save + Auto-Seed Checklist"
4. Watch console for detailed execution trace
5. Checklist should populate within 2 seconds
6. If still fails, share console logs for further debugging
