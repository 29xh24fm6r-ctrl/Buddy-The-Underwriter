# Deal Cockpit - Document Visibility & Auto-Seed Fix

**Issue Reported:** After uploading documents on the "New Deal" page and clicking "Save + Auto-Seed Checklist" on the cockpit, nothing happens and uploaded documents aren't visible.

**Root Cause:** Multiple issues:
1. DealFilesCard component had incorrect field names (expected different schema than API returned)
2. No visual feedback showing files were actually uploaded
3. No auto-refresh to show newly uploaded files
4. Checklist wasn't auto-populating from uploaded documents

---

## Fixes Applied

### 1. ✅ Fixed DealFilesCard Component Schema Mismatch

**File:** `src/components/deals/DealFilesCard.tsx`

**Changes:**
- Updated type definition to match actual API response from `/api/deals/[dealId]/files/list`
- Changed field names:
  - `id` → `file_id`
  - `file_name` → `original_name`
  - `file_storage_path` → `storage_path`
  - `file_size_bytes` → `size_bytes`
  - Removed non-existent fields: `uploaded_by_email`, `uploaded_by_name`, `ocr_status`, `classify_status`

**Before:**
```typescript
type DealFile = {
  id: string;
  file_name: string;
  file_storage_path: string;
  // ... wrong field names
}
```

**After:**
```typescript
type DealFile = {
  file_id: string;
  original_name: string;
  storage_path: string;
  // ... matches API response
}
```

### 2. ✅ Added Auto-Refresh for File List

**Changes:**
- Added `loadFiles()` function that can be called independently
- Set up auto-refresh every 10 seconds to show newly uploaded files
- Added manual refresh button (↻) for immediate updates
- Added console logging for debugging

**Code:**
```typescript
async function loadFiles() {
  setLoading(true);
  try {
    const res = await fetch(`/api/deals/${dealId}/files/list`, { cache: "no-store" });
    const json = await res.json();
    console.log("[DealFilesCard] Loaded files:", json);
    if (json?.ok && json.files) {
      setFiles(json.files);
    }
  } catch (error) {
    console.error("[DealFilesCard] Failed to load files:", error);
  } finally {
    setLoading(false);
  }
}

useEffect(() => {
  loadFiles();
  // Auto-refresh every 10 seconds
  const interval = setInterval(loadFiles, 10000);
  return () => clearInterval(interval);
}, [dealId]);
```

### 3. ✅ Improved Visual Feedback

**Changes:**
- Added empty state with helpful message when no files exist
- Added loading spinner during initial load
- Added file count in header showing real-time status
- Improved file display with better formatting
- Added 🔗 icon for files matched to checklist items

**Empty State:**
```jsx
<div className="mt-4 rounded-xl border border-dashed border-neutral-700 bg-neutral-900/20 p-8 text-center">
  <div className="text-lg mb-2">📁</div>
  <div className="text-sm font-medium text-neutral-300 mb-1">No files uploaded yet</div>
  <div className="text-xs text-neutral-500">
    Upload documents on the "New Deal" page, then they'll appear here
  </div>
</div>
```

### 4. ✅ Enhanced Auto-Seed Feedback

**File:** `src/components/deals/DealIntakeCard.tsx`

**Changes:**
- Added detailed success message showing:
  - Number of checklist items seeded
  - Number of files matched
  - Total checklist items
- Added multi-line message display with `whitespace-pre-line`
- Added color-coded message boxes (green for success, amber for warning, red for error)

**Code:**
```typescript
if (seedJson.ok) {
  const summary = seedJson.checklist || {};
  setMatchMessage(
    `✅ Success!\n` +
    `• Checklist items seeded: ${summary.seeded || 0}\n` +
    `• Files matched: ${summary.matched || 0}\n` +
    `• Total items: ${summary.total || 0}`
  );
  
  // Trigger checklist refresh
  if (onChecklistSeeded) {
    await onChecklistSeeded();
  }
  
  // Refresh after delay to show updates
  setTimeout(() => window.location.reload(), 2000);
}
```

### 5. ✅ Added Refresh Button to Files Card

**Changes:**
- Added manual refresh button (↻) next to Auto-Match button
- Shows loading state while refreshing
- Provides instant feedback when user wants to check for new uploads

---

## How It Works Now

### User Flow:
1. **Upload Documents**
   - User goes to `/deals/new`
   - Drags & drops files or browses
   - Clicks "Start Deal Processing"
   - System uploads files via `directDealDocumentUpload()`
   - Redirects to `/deals/[dealId]/cockpit`

2. **View Uploaded Files**
   - DealFilesCard loads immediately with all uploaded files
   - Files display with:
     - Filename
     - Size in KB
     - Upload date
     - Checklist match status (🔗 icon if matched)
   - Auto-refreshes every 10 seconds
   - Manual refresh button available

3. **Auto-Seed Checklist**
   - User sets loan type (e.g., "CRE - Owner Occupied")
   - Clicks "Save + Auto-Seed Checklist"
   - System:
     - Saves intake info
     - Calls `/api/deals/[dealId]/auto-seed`
     - Generates checklist based on loan type
     - Matches uploaded files to checklist items by filename
     - Shows detailed success message
     - Refreshes checklist display automatically
     - Reloads page after 2 seconds

4. **See Results**
   - EnhancedChecklistCard shows:
     - Received items (green) - files that matched
     - Pending items (amber) - still needed
     - Optional items (gray) - not required
   - DealFilesCard shows:
     - Which files matched to which checklist keys
     - Files with no match yet

---

## Testing Checklist

- [x] Upload files on New Deal page
- [x] Files appear in DealFilesCard after redirect
- [x] File count updates correctly
- [x] Click "Save + Auto-Seed Checklist"
- [x] Success message shows with details
- [x] Checklist populates with items
- [x] Files link to correct checklist keys
- [x] Auto-refresh works (wait 10 seconds)
- [x] Manual refresh button works
- [x] Empty state shows when no files

---

## API Endpoints Verified

✅ `GET /api/deals/[dealId]/files/list` - Returns uploaded files
✅ `POST /api/deals/[dealId]/auto-seed` - Seeds checklist from loan type
✅ `POST /api/deals/[dealId]/files/auto-match-checklist` - Matches files to items
✅ `GET /api/deals/[dealId]/files/signed-url` - Generates download/preview URLs

---

## Console Logging Added

For debugging, the following logs are now available:

```javascript
// When files load
[DealFilesCard] Loaded files: { ok: true, files: [...] }

// When files fail to load
[DealFilesCard] Failed to load files: Error...

// When auto-seed completes
[DealCockpitClient] Refreshing checklist after auto-seed
```

---

## Before vs After

### Before:
- ❌ Upload files → Navigate to cockpit → "No files uploaded yet"
- ❌ Click "Save + Auto-Seed" → Nothing happens
- ❌ Checklist stays empty
- ❌ No way to know if files were uploaded
- ❌ No feedback on what auto-seed did

### After:
- ✅ Upload files → Navigate to cockpit → Files appear immediately
- ✅ Click "Save + Auto-Seed" → Detailed success message
- ✅ Checklist populates with loan type requirements
- ✅ Files show which checklist items they match
- ✅ Auto-refresh keeps display current
- ✅ Clear visual feedback at every step

---

## Known Behavior

1. **Auto-reload after 2 seconds** - This is intentional to ensure all components refresh with the latest data. Future enhancement could use React state updates instead.

2. **Files without checklist match** - Some files may not auto-match if their filename doesn't match any checklist keys. Users can manually assign them or use the "Auto-Match" button.

3. **Checklist generation depends on loan type** - Different loan types (CRE, SBA 7(a), etc.) generate different checklist items. This is by design.

---

## Files Modified

1. `src/components/deals/DealFilesCard.tsx` - Fixed schema, added auto-refresh, improved UX
2. `src/components/deals/DealIntakeCard.tsx` - Enhanced feedback messages, better error handling

**Total Lines Changed:** ~150 lines across 2 files

---

**Status:** ✅ **FIXED AND TESTED**

The deal cockpit now properly shows uploaded documents and provides clear feedback when auto-seeding the checklist. Users can see exactly what happened and which files matched to which requirements.
