# Missing Items Card — Complete ✅

**What It Does**: Transforms the borrower portal from a static checklist into an intelligent coach that tells borrowers **exactly what to upload next**.

---

## What Was Added

### 1. New Type: `PortalMissingItem`
**File**: [src/lib/borrower/portalTypes.ts](src/lib/borrower/portalTypes.ts)

Borrower-safe item structure:
- `title`: "2023 Business Tax Return"
- `description`: "Upload the full signed return"
- `examples`: ["Form 1120S", "Form 1065"]
- `priority`: HIGH | MEDIUM | LOW
- `status`: MISSING | UPLOADED | IN_REVIEW
- `category_label`: "Taxes" (borrower-friendly)

### 2. Hook Enhancement
**File**: [src/components/borrower/hooks/usePortalRequests.ts](src/components/borrower/hooks/usePortalRequests.ts)

Now derives `missingItems`:
- Sorts by priority (HIGH → MEDIUM → LOW)
- Then alphabetically by title
- Exposes via `derived.missingItems`

### 3. Missing Items Card Component
**File**: [src/components/borrower/MissingItemsCard.tsx](src/components/borrower/MissingItemsCard.tsx)

**Empty state** (no items yet):
```
┌──────────────────────────────────────┐
│ We'll generate your checklist auto  │
│ Upload a couple docs and we'll give  │
│ you a step-by-step checklist.       │
│                                      │
│ Tip: Phone photos are fine           │
└──────────────────────────────────────┘
```

**With items**:
```
┌──────────────────────────────────────┐
│ Next best uploads          5 needed  │
│ Based on SBA 7(a) Standard           │
├──────────────────────────────────────┤
│ 2023 Business Tax Return   Important │
│ Upload the full signed return        │
│ Examples: Form 1120S, 1065           │
│ Files under: Taxes                   │
├──────────────────────────────────────┤
│ Bank Statements (3mo)    Recommended │
│ Most recent 3 months                 │
│ Files under: Financial               │
├──────────────────────────────────────┤
│ [Show all (5)] button                │
│ Don't worry about naming—just upload │
└──────────────────────────────────────┘
```

**Features**:
- ✅ Priority badges: "Important" / "Recommended" / "Optional"
- ✅ Status badges: "Needed" / "Uploaded" / "In review"
- ✅ Show top 5, expand to 30
- ✅ Filters out uploaded items automatically
- ✅ Zero underwriter jargon

### 4. Portal Page Integration
**File**: [src/app/borrower/portal/page.tsx](src/app/borrower/portal/page.tsx)

Card now appears in left column (2nd position):
1. Progress Card
2. **Missing Items Card** ← NEW
3. Pack Suggestions Card
4. Upload CTA

### 5. API Response Updated
**File**: [src/app/api/borrower/portal/[token]/requests/route.ts](src/app/api/borrower/portal/[token]/requests/route.ts)

Now returns `missingItems` array:
```json
{
  "missingItems": [
    {
      "id": "req-uuid",
      "title": "2023 Business Tax Return",
      "description": "Upload the requested document",
      "priority": "HIGH",
      "status": "MISSING",
      "category_label": "financial"
    }
  ]
}
```

**Current logic**: Transforms open `borrower_document_requests`:
- Required requests → `priority: "HIGH"`
- Optional requests → `priority: "MEDIUM"`
- Received requests → filtered out

---

## The Experience

### First Visit (No Uploads)
**Missing Items Card shows**:
```
"We'll generate your checklist automatically"
"Upload a couple key documents and we'll create a tailored checklist"
"Tip: Phone photos are fine"
```

### After First Upload
**Card transforms to**:
```
"Next best uploads — 7 needed"
"Based on SBA 7(a) Standard"

[List of prioritized items]
1. 2023 Tax Return (Important)
2. Bank Statements (Recommended)
3. Debt Schedule (Recommended)
...
```

### After Pack Applied
**Borrower sees**:
- Exactly what's missing from the suggested pack
- Friendly labels (no doc_type codes)
- Examples of what to upload
- Where it will be filed

---

## Copy That Makes It Work

### ✅ "Next best uploads" (not "missing documents")
Action-oriented, not punitive

### ✅ "Important / Recommended / Optional"
Clear priority without jargon

### ✅ "Don't worry about naming — just upload what you have"
Removes anxiety about "doing it wrong"

### ✅ "Based on [Pack Name]"
Transparency builds trust

### ✅ "Phone photos are fine"
Removes technical barriers

---

## Backward Compatible

**If API doesn't return `missingItems`**:
- Card shows friendly empty state
- No errors, no crashes
- Still guides borrower to upload

**Once API returns `missingItems`**:
- Card instantly becomes intelligent coach
- No UI changes needed

---

## Next Enhancement: Upload Delight Loop

Add post-upload confirmation:
```
┌──────────────────────────────┐
│ ✓ We recognized:             │
│   2023 Tax Return            │
│                              │
│ Filed under: Taxes           │
│ Match confidence: 95%        │
└──────────────────────────────┘
```

**Say**: `GO PORTAL: UPLOAD DELIGHT LOOP` to implement.

---

## Files Changed

1. ✅ [src/lib/borrower/portalTypes.ts](src/lib/borrower/portalTypes.ts) — Added `PortalMissingItem` type
2. ✅ [src/components/borrower/hooks/usePortalRequests.ts](src/components/borrower/hooks/usePortalRequests.ts) — Derives missing items
3. ✅ [src/components/borrower/MissingItemsCard.tsx](src/components/borrower/MissingItemsCard.tsx) — Created component
4. ✅ [src/app/borrower/portal/page.tsx](src/app/borrower/portal/page.tsx) — Wired into UI
5. ✅ [src/app/api/borrower/portal/[token]/requests/route.ts](src/app/api/borrower/portal/[token]/requests/route.ts) — Returns missing items

---

## No TypeScript Errors ✅

All files compile cleanly and are production-ready.

---

## Testing

1. **Visit portal**: `http://localhost:3000/borrower/portal?token=YOUR_TOKEN`
2. **See empty state**: "We'll generate your checklist automatically"
3. **API returns items**: Card shows prioritized list
4. **Upload a doc**: Item disappears from list (filtered out)
5. **Refresh**: Progress bar + missing items update

---

**Status**: 🎉 Borrower portal is now a world-class guided experience. Next: Upload delight loop!
