# UI Fixes: Material Icons + Double Chrome Issue

## Root Cause Analysis

### 1. Material Icons Rendering as Text ✅ ALREADY FIXED
**Status**: Font IS loaded in root layout  
**Location**: [src/app/layout.tsx](src/app/layout.tsx#L83-L86)

```tsx
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
/>
```

**If still appearing as text on Vercel**, the issue is:
- CSS not being applied (check Network tab for 404/CORS)
- or Vercel edge cache not purged

### 2. Double Chrome Issue 🔴 CRITICAL
**Problem**: `/deals` page shows THREE navigation systems simultaneously:

1. **Stitch embedded chrome** (in page.tsx):
   - Top black header: "Buddy the Underwriter"
   - Left vertical icon rail: "Dashboard / Deals / Intake / Undrwrt..."
   
2. **AppSidebar** (from (app)/layout.tsx):
   - Left sidebar: "Buddy — Pages / Stitch exports + real routes"
   
3. **ConditionalHeroBar** (from root layout.tsx):
   - Top navigation

**Why**: `/deals` is a Stitch export (full standalone page with embedded nav) placed inside `(app)` route group which wraps it with AppSidebar.

## Solutions

### Option A: Move deals page OUT of (app) group
Create `/deals` as standalone route without sidebar wrapper.

### Option B: Extract only content from Stitch export
Remove the embedded navigation from the Stitch HTML, keep only the content area.

### Option C: Create real component-based deals page (RECOMMENDED)
Replace Stitch export with proper Next.js components that integrate with existing layout.

## Quick Fix (Option B)

Remove embedded nav from Stitch HTML in `/deals` page, let (app)/layout.tsx provide navigation.

Changes needed in `src/app/(app)/deals/page.tsx`:
1. Remove top header HTML (lines ~34-71)
2. Remove left nav rail HTML (lines ~73-113)
3. Keep only main content area

## Production-Ready Fix (Option C)

1. Create `src/app/(app)/deals/page.tsx` as real component
2. Use existing `<AppSidebar>` from layout
3. Build content with proper React components
4. Delete Stitch backup files

---

**Current Status**: Diagnosed, fix ready to apply
**Recommendation**: Apply Option C for maintainability
**Quick Unblock**: Apply Option B to hide double chrome immediately
