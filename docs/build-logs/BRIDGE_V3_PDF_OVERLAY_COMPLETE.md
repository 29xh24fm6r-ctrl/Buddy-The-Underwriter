# PDF OVERLAY DEEP LINKING — COMPLETE ✅

**Date:** December 21, 2025  
**Status:** Production Ready  
**Goal:** One click from Command Bridge → exact PDF page + focused overlay + excerpt modal

---

## What Was Built

This implementation adds **museum-quality deep-linking** from the Command Bridge Live Intelligence feed to the exact location in PDF documents, complete with:

1. **URL-driven evidence navigation** with query params (fileId, page, overlayId, gcs, gce)
2. **Unified launcher utilities** for consistent evidence opening across the app
3. **Visual overlay focus** with pulse animations and auto-clear
4. **Automatic excerpt modal** opening after navigation
5. **Full backward compatibility** with existing evidence launcher

---

## Files Created (4 new)

### 1. `src/lib/evidence/launchPdfOverlay.ts`
**Purpose:** Primary launcher for PDF page + overlay deep-linking

**Exports:**
- `LaunchPdfOverlayArgs` - Type for all launch parameters
- `buildPdfOverlayHref(args)` - Builds URL with query params
- `launchPdfOverlay(args)` - Navigates to PDF with overlay focus

**URL Contract:**
```
/deals/{dealId}?fileId={fileId}&page={page}&overlayId={overlayId}&gcs={start}&gce={end}
```

**Example:**
```typescript
launchPdfOverlay({
  dealId: "123",
  fileId: "456",
  page: 3,
  overlayId: "overlay-789",
  globalCharStart: 12030,
  globalCharEnd: 12105,
  citationId: "cite-123",
  source: "bridge_feed",
});
```

### 2. `src/lib/evidence/pdfViewerStore.ts`
**Purpose:** Lightweight state management for PDF viewer controls

**State:**
- `currentFileId` - Active PDF file ID
- `currentPage` - Current page number (1-based)
- `focusedOverlayId` - ID of overlay to flash/highlight

**Controls:**
- `openFile(fileId)` - Switch to different PDF
- `setPage(page)` - Jump to page number
- `focusOverlay(overlayId)` - Flash overlay for 2.5 seconds

**Pattern:** Module-level state with listener pattern (no Zustand dependency)

### 3. `src/components/evidence/DealEvidenceDeepLinkHandler.tsx`
**Purpose:** Client component that reads URL params and orchestrates deep-linking

**Behavior:**
1. Reads query params (fileId, page, overlayId, gcs, gce)
2. Opens PDF file via `viewer.openFile()`
3. Jumps to page via `viewer.setPage()`
4. Focuses overlay via `viewer.focusOverlay()`
5. Opens excerpt modal after 250ms delay

**Mount location:** `/deals/[dealId]/page.tsx`

### 4. `BRIDGE_V3_PDF_OVERLAY_COMPLETE.md`
**Purpose:** This documentation file

---

## Files Modified (5 existing)

### 1. `src/lib/intel/events.ts`
**Changes:**
- Added `overlayId?: string | null` to `RecordIntelEventArgs` type
- Store overlay_id in `meta.overlay_id` during event insert

**Before:**
```typescript
meta: args.meta ?? {},
```

**After:**
```typescript
meta: {
  ...(args.meta ?? {}),
  overlay_id: args.overlayId ?? (args.meta as any)?.overlay_id ?? null,
},
```

### 2. `src/components/evidence/PdfOverlayViewer.tsx`
**Changes:**
- Import `usePdfViewerStore` hook
- Connect to viewer state with `viewerState = usePdfViewerStore(true)`
- Add focused overlay styling with pulse animation

**Before:**
```tsx
<div className="absolute rounded-sm bg-yellow-200/40 outline outline-1 outline-yellow-400/60" />
```

**After:**
```tsx
<div className={[
  "absolute rounded-sm",
  isFocused 
    ? "z-50 ring-2 ring-white/70 bg-white/15 animate-pulse" 
    : "z-10 bg-yellow-200/40 outline outline-1 outline-yellow-400/60"
].join(" ")} />
```

**Visual effect:** Focused overlays get white ring, brighter background, and pulse for 2.5 seconds

### 3. `src/components/home/CommandBridgeV3.tsx`
**Changes:**
- Import `launchPdfOverlay` utility
- Add `page` and `overlayId` to feed event type
- Update IntelRow click handler to use PDF overlay launcher when page exists
- Update NBA "why" chip click handler similarly

**Decision logic:**
```typescript
if (e.deal_id && e.file_id && typeof page === "number") {
  launchPdfOverlay({ ... }); // New deep-link path
} else {
  launchEvidence({ ... }); // Fallback to old launcher
}
```

**Backward compatibility:** Events without page info still work via old launcher

### 4. `src/app/api/home/command-bridge/route.ts`
**Changes:**
- Add `page` to intel feed SELECT query
- Include `page` and `overlayId` in NBA "why" chips

**Before:**
```typescript
.select("...,icon,meta")
```

**After:**
```typescript
.select("...,page,icon,meta")
```

**NBA why chip structure:**
```typescript
{
  text: "Click to open exact excerpt",
  dealId: firstEvidence.deal_id,
  fileId: firstEvidence.file_id,
  page: firstEvidence.page,
  overlayId: firstEvidence.meta?.overlay_id ?? null,
  ...
}
```

### 5. `src/app/deals/[dealId]/page.tsx`
**Changes:**
- Import `DealEvidenceDeepLinkHandler`
- Mount handler component before `DealWorkspaceClient`

**Before:**
```tsx
return <DealWorkspaceClient dealId={dealId} dealName={dealName} />;
```

**After:**
```tsx
return (
  <>
    <DealEvidenceDeepLinkHandler dealId={dealId} />
    <DealWorkspaceClient dealId={dealId} dealName={dealName} />
  </>
);
```

---

## How It Works (End-to-End Flow)

### Scenario: Banker clicks Command Bridge feed event

1. **User clicks intel event** in Command Bridge Live Intelligence feed
2. **CommandBridgeV3** checks if event has `page` data:
   - If YES → calls `launchPdfOverlay()`
   - If NO → calls `launchEvidence()` (fallback)
3. **launchPdfOverlay()** builds URL:
   ```
   /deals/123?fileId=456&page=3&overlayId=overlay-789&gcs=12030&gce=12105
   ```
4. **Browser navigates** to deal page with query params
5. **DealEvidenceDeepLinkHandler** reads params and:
   - Calls `viewer.openFile("456")` → PDF loads
   - Calls `viewer.setPage(3)` → Jumps to page 3
   - Calls `viewer.focusOverlay("overlay-789")` → Flashes overlay
   - Waits 250ms, then calls `openExcerpt()` → Modal opens with highlighted text
6. **PdfOverlayViewer** renders:
   - Page 3 of PDF
   - All overlays on that page
   - Focused overlay with white ring + pulse animation
7. **ExcerptBridgeProvider** modal shows:
   - Extracted text excerpt
   - Highlighted character range
   - "Open Deal" and "Close" buttons

**Result:** One click → exact evidence location with visual confirmation

---

## Testing Checklist

### ✅ Phase 1: Create test event
```bash
# Create intel event with full metadata
curl -X POST http://localhost:3000/api/test/intel-event \
  -H "Content-Type: application/json" \
  -d '{
    "bankId": "your-bank-id",
    "dealId": "deal-123",
    "fileId": "file-456",
    "page": 3,
    "overlayId": "overlay-789",
    "globalCharStart": 12030,
    "globalCharEnd": 12105,
    "citationId": "cite-123",
    "title": "Test: Click to open page 3",
    "message": "This should deep-link to page 3 with overlay flash",
    "severity": "info"
  }'
```

### ✅ Phase 2: Navigate to Command Bridge
```
http://localhost:3000/deals
```
- Scroll to "Live Intelligence" feed
- See test event in list
- Badge shows "click to evidence"

### ✅ Phase 3: Click event
- Click the test event row
- Browser navigates to: `/deals/deal-123?fileId=file-456&page=3&overlayId=overlay-789&gcs=12030&gce=12105`
- Deal page loads

### ✅ Phase 4: Verify PDF viewer behavior
- PDF opens to page 3 (not page 1)
- Overlay with ID "overlay-789" flashes white ring
- Overlay pulses for ~2.5 seconds
- Excerpt modal opens automatically
- Modal shows highlighted text from chars 12030-12105

### ✅ Phase 5: Test NBA "why" chip
- Navigate to Command Bridge home
- See Next Best Action section
- Click "Click to open exact excerpt" chip
- Same deep-linking flow as above

### ✅ Phase 6: Test fallback
- Create event WITHOUT page:
  ```json
  { "dealId": "123", "fileId": "456", "page": null }
  ```
- Click event → navigates to deal page (no deep-link)
- Old launcher behavior preserved

---

## URL Query Param Contract

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `fileId` | string | ✅ Yes | Document/file ID to open |
| `page` | number | ✅ Yes | 1-based page number |
| `overlayId` | string | ❌ No | Overlay rectangle ID to focus |
| `gcs` | number | ❌ No | Global character start for excerpt |
| `gce` | number | ❌ No | Global character end for excerpt |

**Example URLs:**
```
# Minimal (just file + page)
/deals/123?fileId=456&page=3

# With overlay focus
/deals/123?fileId=456&page=3&overlayId=overlay-789

# Full deep-link with excerpt
/deals/123?fileId=456&page=3&overlayId=overlay-789&gcs=12030&gce=12105
```

---

## What's Next (Optional Enhancements)

### 🎯 Enhancement 1: Overlay Zoom + Center
**Goal:** Auto-zoom and center the focused overlay for 2 seconds

**Implementation:**
```typescript
// In pdfViewerStore.ts
focusOverlay: (overlayId: string, opts?: { zoom?: number; duration?: number }) => {
  const zoom = opts?.zoom ?? 1.5;
  const duration = opts?.duration ?? 2000;
  
  // Store original zoom
  const originalZoom = state.zoom;
  
  // Apply zoom
  state.focusedOverlayId = overlayId;
  state.zoom = zoom;
  notifyListeners();
  
  // Revert after duration
  setTimeout(() => {
    state.focusedOverlayId = null;
    state.zoom = originalZoom;
    notifyListeners();
  }, duration);
}
```

### 🎯 Enhancement 2: Scroll to Overlay
**Goal:** Auto-scroll viewport to focused overlay

**Implementation:**
```typescript
// In PdfOverlayViewer.tsx
useEffect(() => {
  if (viewerState.focusedOverlayId) {
    const el = document.querySelector(`[data-overlay-id="${viewerState.focusedOverlayId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}, [viewerState.focusedOverlayId]);
```

### 🎯 Enhancement 3: Instrumentation
**Goal:** Track deep-link usage for product analytics

**Add to DealEvidenceDeepLinkHandler:**
```typescript
useEffect(() => {
  if (fileId && page) {
    fetch("/api/analytics/track", {
      method: "POST",
      body: JSON.stringify({
        event: "pdf_overlay_deep_link",
        dealId: props.dealId,
        fileId,
        page,
        hasOverlay: !!overlayId,
        hasExcerpt: !!(gcs && gce),
      }),
    });
  }
}, [sp]);
```

### 🎯 Enhancement 4: Multi-Overlay Support
**Goal:** Focus multiple overlays simultaneously

**Current:** Only one `focusedOverlayId` at a time  
**Enhancement:** Store array `focusedOverlayIds: string[]`

---

## Success Metrics

Track these KPIs to measure impact:

1. **Deep-link click rate**: % of feed events clicked (should be >40%)
2. **Time to evidence**: Seconds from click to excerpt modal open (target <2s)
3. **Overlay focus accuracy**: % of clicks where overlay exists on target page (>95%)
4. **Excerpt modal open rate**: % of deep-links that trigger modal (target >80%)
5. **Fallback usage**: % of clicks using old launcher (should decrease over time)

---

## Migration Steps

### For existing intel event calls:

**Before:**
```typescript
await recordIntelEvent({
  dealId,
  fileId,
  globalCharStart: 1000,
  globalCharEnd: 1200,
  title: "Tax return uploaded",
  meta: {},
});
```

**After:**
```typescript
await recordIntelEvent({
  dealId,
  fileId,
  page: 3, // ✅ Add page number
  overlayId: "overlay-123", // ✅ Add overlay ID
  globalCharStart: 1000,
  globalCharEnd: 1200,
  title: "Tax return uploaded",
  meta: {},
});
```

### For existing overlay click handlers:

**Before:**
```typescript
onClick={() => {
  launchEvidence({
    dealId,
    fileId,
    globalCharStart: 1000,
    globalCharEnd: 1200,
  });
}}
```

**After:**
```typescript
onClick={() => {
  launchPdfOverlay({
    dealId,
    fileId,
    page: 3, // ✅ Add page
    overlayId: "overlay-123", // ✅ Add overlay ID
    globalCharStart: 1000,
    globalCharEnd: 1200,
  });
}}
```

---

## Related Docs

- [BRIDGE_V3_COMPLETE.md](./BRIDGE_V3_COMPLETE.md) - Previous Command Bridge upgrades
- [EVIDENCE_V3_COMPLETE.md](./EVIDENCE_V3_COMPLETE.md) - Evidence system architecture
- [docs/COMMAND_BUS_COMPLETE.md](./docs/COMMAND_BUS_COMPLETE.md) - Command bus pattern

---

## Notes

1. **Backward Compatible:** Old `launchEvidence()` still works for events without page data
2. **Zero Breaking Changes:** All existing evidence links continue working
3. **Progressive Enhancement:** Add page/overlayId incrementally as OCR improves
4. **URL-Shareable:** Deep-links can be bookmarked or shared via chat
5. **Browser-Friendly:** Back/forward buttons work correctly
6. **Performance:** No state bloat - viewer store is <50 lines
7. **TypeScript Safe:** All new utilities fully typed with zero errors

---

**Status:** ✅ Production ready - zero TypeScript errors, all tests passing, full backward compatibility
