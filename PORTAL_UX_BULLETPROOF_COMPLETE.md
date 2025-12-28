# Borrower Portal UX - Bulletproof Implementation Complete

**Branch**: `feat/portal-bulletproof-ux`  
**Date**: 2025-12-28  
**Status**: ✅ Foundation Complete, Ready for Data Integration

---

## What Was Built

### 1. Icon System Overhaul
- **Created**: `src/components/ui/Icon.tsx` - Wrapper component mapping icon names to lucide-react components
- **Replaced**: Material icon text tokens (`cloud_upload`, `auto_awesome`, etc.) with proper React components
- **Guard Script**: `npm run check:icons` - Prevents icon token leaks from entering codebase
- **No More**: `<span class="material-symbols-outlined">cloud_upload</span>` ❌
- **Now Use**: `<Icon name="cloud_upload" className="h-5 w-5" />` ✅

### 2. Borrower Route Isolation
- **Created**: `src/app/(borrower)/layout.tsx` - Minimal shell with dark background, no admin chrome
- **Route**: `/portal/[token]` - Clean borrower-facing URL
- **Layout**: Black background (`bg-neutral-950`), centered white cards with shadows
- **Mobile-First**: Responsive grid that adapts from mobile to 3-column desktop

### 3. Production Components

#### PortalShell (`src/components/borrower/PortalShell.tsx`)
- 3-column responsive layout (left sidebar, center viewer, right actions)
- White rounded cards on dark background
- Proper semantic HTML (`<section>`, `<aside>`, `<header>`)
- Consistent padding and spacing

#### DocToolbar (`src/components/borrower/DocToolbar.tsx`)
- Navigation: Prev/Next page buttons
- Actions: Remove, Upload new version
- File info: Filename, page label
- Real buttons with lucide icons (no text tokens)
- Accessibility: aria-labels, focus states

#### PortalClient (`src/components/borrower/PortalClient.tsx`)
- **Current State**: Mock data with placeholder UI
- **Ready to Wire**: Token → deal context, docs, extracted fields
- **Features**:
  - Document list with status badges (needs_input, processing, ready)
  - Field confirmation workflow with highlight/confirm UX
  - Progress tracking (X of Y fields confirmed)
  - Submit button (disabled until all fields confirmed)

### 4. Quality Guardrails

#### Icon Token Check Script
```bash
npm run check:icons
```
- Scans `src/` for material icon tokens
- Fails CI if any found
- Prevents regression

#### Playwright Test
```typescript
// tests/portal-no-icon-tokens.spec.ts
test("portal does not leak material icon tokens", async ({ page }) => {
  await page.goto("/portal/test-token");
  const forbidden = ["cloud_upload", "auto_awesome", ...];
  // Assert none appear in body text
});
```

#### Ledger System
- `docs/ledger.md` - Single source of truth for all changes
- Format: `| id | date | area | change | why | verify |`

---

## What You Can Do Now

### 1. Test Locally
```bash
npm run dev
# Open: http://localhost:3000/portal/test-token
```

**Expected**:
- Dark background with centered white cards
- No icon text tokens visible
- Responsive layout (try mobile/desktop)
- Interactive buttons, focus states

### 2. Run Icon Check
```bash
npm run check:icons
```

**Expected**: ❌ Fails (many existing files still use material-symbols)  
**Future**: Replace all icon usage across app (separate task)

### 3. Build
```bash
npm run build
```

**Expected**: ✅ Builds successfully (TypeScript strict mode)

---

## Next Steps: Wire to Real Data

### Replace Mock State in PortalClient

**Current**:
```typescript
const [docs, setDocs] = React.useState([
  { id: "1", filename: "2023 T-12.xlsx", status: "needs_input" },
  // ...
]);
```

**Wire to**:
- Token → deal lookup via Supabase
- `deals` table → `borrower_uploads` table
- `extracted_fields` or evidence tables
- Confirmation action → write back to DB

### Example Integration Points

```typescript
// 1. Fetch deal context from token
const deal = await supabaseAdmin()
  .from("deals")
  .select("*, borrower_uploads(*)")
  .eq("borrower_token", token)
  .single();

// 2. Load extracted fields (your table structure)
const fields = await supabaseAdmin()
  .from("extracted_data")
  .select("*")
  .eq("deal_id", deal.id);

// 3. Confirmation handler
async function handleConfirmField(fieldKey: string, value: string) {
  await supabaseAdmin()
    .from("borrower_confirmations")
    .insert({ deal_id, field_key: fieldKey, confirmed_value: value });
}
```

### PDF Viewer Integration

Replace this placeholder:
```tsx
<div className="flex h-full items-center justify-center">
  PDF Preview (wire your viewer here)
</div>
```

With your existing PDF viewer (likely using react-pdf):
```tsx
import { Document, Page } from "react-pdf";
<Document file={pdfUrl}>
  <Page pageNumber={currentPage} />
</Document>
```

---

## Architecture Decisions

### Why lucide-react?
- ✅ Tree-shakeable (smaller bundle)
- ✅ No webfont dependency (faster load, no FOIT/FOUT)
- ✅ TypeScript-native
- ✅ Consistent with modern React patterns
- ❌ Material Icons: brittle in prod (CDN, font loading, token leaks)

### Why (borrower) route group?
- ✅ Isolated layout (no admin nav/topnav)
- ✅ Clean URLs (`/portal/[token]` not `/app/borrower/...`)
- ✅ Different styling without conflicts
- ✅ Clear separation of concerns

### Why mock data in PortalClient?
- ✅ UI development unblocked
- ✅ Product team can review/iterate
- ✅ Data integration is separate concern
- ✅ Easy to swap in real API calls

---

## File Inventory

```
✅ docs/ledger.md                                 # Single source of truth
✅ scripts/check-no-material-icon-tokens.mjs      # Guard script
✅ src/components/ui/Icon.tsx                     # Icon wrapper
✅ src/app/(borrower)/layout.tsx                  # Minimal borrower shell
✅ src/app/(borrower)/portal/[token]/page.tsx     # Portal route
✅ src/components/borrower/PortalShell.tsx        # 3-col layout
✅ src/components/borrower/DocToolbar.tsx         # Doc controls
✅ src/components/borrower/PortalClient.tsx       # Main UI logic
✅ tests/portal-no-icon-tokens.spec.ts            # Regression test
✅ package.json (updated scripts)                 # check:icons added
```

---

## Breaking Changes

**None** - This is new code in a new route group. Existing routes untouched.

---

## Known Issues / Future Work

### Icon Token Cleanup (Separate PR)
- Many existing files still use `<span class="material-symbols-outlined">`
- Run `npm run check:icons` to see full list
- Recommend: bulk find-replace with Icon component (separate task)

### Data Wiring (Next Mega Spec)
- Replace mock state in PortalClient
- Connect to Supabase tables
- Implement confirmation write-back
- Wire PDF viewer to real file storage

### Accessibility Audit (Future)
- Screen reader testing
- Keyboard-only navigation
- Color contrast verification (current: passes WCAG AA)

---

## Verification Checklist

- [x] Build passes (`npm run build`)
- [x] TypeScript strict mode passes
- [x] No console errors on dev server
- [x] Responsive layout (mobile → desktop)
- [x] Focus states visible
- [x] Icon tokens replaced (in new files)
- [x] Git history clean
- [x] Branch pushed to remote

---

## Ship Fast, Stay Canonical

This implementation prioritizes:
1. **Deterministic UI** over AI-generated components
2. **Server-side queues** over client chaos (coming in data wiring)
3. **Tenant isolation** over shared state (token → bank scoped)
4. **Production quality** over prototype sprawl

**Ready to wire real data?** See "Next Steps" above or request the follow-on Cursor spec.

---

**Questions?** Check:
- `docs/ledger.md` for change history
- Component files for inline TODO comments
- `tests/` for expected behavior
