# Timeline Magic Complete 🎉

## What Just Shipped (3 Features in 1 Sprint)

### 1. **Stage → Borrower "What happens next" checklist**
Auto-generated, borrower-safe guidance that changes by deal stage.

### 2. **Auto timeline events from uploads**
Every document upload creates a borrower-visible timeline event like "Bank received: 2023 Tax Return"

### 3. **Banker ETA note templates**
Quick-apply templates in Inbox controls ("Ordered appraisal", "Waiting on third-party", etc.)

---

## Architecture Overview

### Database Schema (Migration)

**File:** `supabase/migrations/20251220_status_playbook_templates_and_doc_receipts.sql`

#### Tables Created:

1. **`deal_stage_playbook`**
   - Purpose: Stage-specific borrower guidance ("What happens next")
   - Columns: `stage`, `borrower_title`, `borrower_steps` (jsonb array)
   - Seeded with 8 stages worth of borrower-safe copy
   - Example: "Underwriting" → "Your file is in underwriting review", "If underwriting requests items, they will appear in your checklist"

2. **`deal_eta_note_templates`**
   - Purpose: Reusable borrower-safe notes for bankers
   - Columns: `id`, `label`, `note`, `created_by`, `created_at`
   - Seeded with 4 global templates (null `created_by`)
   - Bankers can create custom templates

3. **`deal_document_receipts`**
   - Purpose: Log every document received (upload/email/portal/banker)
   - Columns: `id`, `deal_id`, `file_name`, `doc_type`, `doc_year`, `source`, `received_by`, `received_at`
   - **Has a database trigger** that auto-creates borrower-visible timeline events

#### Database Trigger (The Magic):

**Function:** `on_doc_receipt_log_timeline()`
- Fires on INSERT into `deal_document_receipts`
- Creates `deal_timeline_events` row with:
  - `kind`: "doc_received"
  - `title`: "Bank received: Tax Return received" (or "Bank received: Document received")
  - `detail`: "2023 • my_tax_return_2023.pdf" (if year detected)
  - `visible_to_borrower`: true

**Result:** Borrowers see "Bank received: Tax Return received" instantly after upload completes.

---

## Server Libraries

### 1. `src/lib/deals/playbook.ts`

**Exports:**
- `getBorrowerPlaybookForStage(stage: string)` → returns `{ stage, borrower_title, borrower_steps[] }`

**Usage:**
```typescript
const playbook = await getBorrowerPlaybookForStage("underwriting");
// Returns: { stage: "underwriting", borrower_title: "Underwriting", borrower_steps: ["Your file is...", "If underwriting..."] }
```

### 2. `src/lib/deals/etaTemplates.ts`

**Exports:**
- `listEtaNoteTemplates()` → returns `EtaNoteTemplate[]`
- `createEtaNoteTemplate({ label, note, createdBy })` → returns created template

**Usage:**
```typescript
const templates = await listEtaNoteTemplates();
// Returns: [{ id: "...", label: "Ordered appraisal", note: "We have ordered..." }, ...]

await createEtaNoteTemplate({
  label: "Closing scheduled",
  note: "Closing is scheduled for next week. We will send signing instructions.",
  createdBy: userId
});
```

### 3. `src/lib/deals/docReceipts.ts`

**Exports:**
- `logDealDocumentReceipt({ dealId, fileName, docType?, docYear?, source?, receivedBy? })`

**Usage:**
```typescript
await logDealDocumentReceipt({
  dealId: "123",
  fileName: "acme_corp_2023_taxes.pdf",
  docType: "Tax Return",
  docYear: 2023,
  source: "portal",
  receivedBy: null
});
// Database trigger auto-creates: "Bank received: Tax Return received" timeline event
```

### 4. `src/lib/uploads/docTypeHeuristics.ts`

**Exports:**
- `inferDocTypeAndYear(fileName: string)` → returns `{ docType: string | null, docYear: number | null }`

**Heuristics:**
- Extracts year from filename using regex: `/(19|20)\d{2}/`
- Detects doc types:
  - "Tax Return" (1120, 1065, 1040, K-1)
  - "Personal Financial Statement" (PFS)
  - "Financial Statement" (balance sheet, P&L)
  - "Bank Statement"
  - "A/R Aging", "A/P Aging", "Rent Roll", "Insurance"

**Usage:**
```typescript
const { docType, docYear } = inferDocTypeAndYear("acme_2023_taxes_1120.pdf");
// Returns: { docType: "Tax Return", docYear: 2023 }
```

---

## API Routes

### 1. `GET /api/banker/eta-templates`

**Auth:** Requires `x-user-id` header

**Response:**
```json
{
  "ok": true,
  "templates": [
    {
      "id": "uuid",
      "label": "Ordered appraisal",
      "note": "We have ordered the appraisal/valuation...",
      "created_at": "2025-12-20T...",
      "created_by": null
    }
  ]
}
```

### 2. `POST /api/banker/eta-templates`

**Auth:** Requires `x-user-id` header

**Body:**
```json
{
  "label": "Custom template label",
  "note": "Custom borrower-safe note"
}
```

**Response:**
```json
{
  "ok": true,
  "template": {
    "id": "uuid",
    "label": "Custom template label",
    "note": "Custom borrower-safe note",
    "created_at": "2025-12-20T...",
    "created_by": "user123"
  }
}
```

### 3. `GET /api/deals/[dealId]/timeline` (UPDATED)

**Auth:** Server-only (no RLS, uses supabaseAdmin)

**Response:**
```json
{
  "ok": true,
  "status": {
    "deal_id": "123",
    "stage": "underwriting",
    "eta_date": "2025-12-28",
    "eta_note": "Waiting on appraisal scheduling",
    "updated_at": "2025-12-20T..."
  },
  "playbook": {
    "stage": "underwriting",
    "borrower_title": "Underwriting",
    "borrower_steps": [
      "Your file is in underwriting review",
      "If underwriting requests items, they will appear in your checklist",
      "We will keep your ETA updated here"
    ]
  },
  "events": [
    {
      "id": "uuid",
      "kind": "doc_received",
      "title": "Bank received: Tax Return received",
      "detail": "2023 • acme_corp_2023_taxes.pdf",
      "created_at": "2025-12-20T..."
    }
  ]
}
```

**What Changed:**
- Now returns `playbook` object in addition to `status` and `events`
- Uses `getBorrowerPlaybookForStage()` to fetch stage-specific guidance

---

## React Components

### 1. `DealStageEtaControls` (UPDATED)

**File:** `src/components/banker/DealStageEtaControls.tsx`

**New Features:**
- Templates dropdown (loads from `/api/banker/eta-templates`)
- "Apply" button (copies template note to ETA note field)
- "New template" toggle (shows mini-form to create template)
- Template creation form (saves via POST to `/api/banker/eta-templates`)

**UI Flow:**
1. Banker opens deal in inbox
2. Sees stage dropdown, ETA date picker, note field
3. **NEW:** Sees template dropdown pre-populated with "Ordered appraisal", "Waiting on third-party", etc.
4. Selects template → clicks "Apply" → note field auto-fills
5. **NEW:** Can click "New template" → mini-form appears → saves custom template for future reuse
6. Clicks "Save" → updates deal status + creates timeline event

**Props:**
```typescript
{
  dealId: string;
  initialStage?: DealStage;
  initialEtaDate?: string | null;
  initialEtaNote?: string | null;
  actorUserId: string; // for x-user-id header
  onSaved?: (next) => void;
}
```

### 2. `BorrowerTimeline` (UPDATED)

**File:** `src/components/borrower/BorrowerTimeline.tsx`

**New Features:**
- "What happens next" section (stage-specific playbook)
- Shows current stage + borrower_title
- Lists borrower_steps as checklist with bullet points

**UI Layout:**
1. **Header:** Current stage (left) + ETA (right)
2. **ETA Note:** Gray box with borrower-safe note (if set)
3. **NEW: "What happens next"** → Stage-specific checklist (e.g. "Upload any missing documents shown in your checklist")
4. **Updates:** Timeline events (most recent first)

**Props:**
```typescript
{
  dealId: string;
}
```

**Polling:** Refetches every 15 seconds to keep timeline live

---

## Upload Flow (Auto Timeline Events)

### Modified File: `src/app/api/borrower/portal/[token]/upload/route.ts`

**What Changed:**
1. Added imports:
   ```typescript
   import { logDealDocumentReceipt } from "@/lib/deals/docReceipts";
   import { inferDocTypeAndYear } from "@/lib/uploads/docTypeHeuristics";
   ```

2. After successful auto-match (confidence >= 85), added:
   ```typescript
   // Infer doc type and year from filename
   const inferred = inferDocTypeAndYear(filename);
   const docType = hinted_doc_type || inferred.docType;
   const docYear = inferred.docYear;

   // Log document receipt (database trigger creates timeline event)
   await logDealDocumentReceipt({
     dealId: deal_id,
     fileName: filename,
     docType,
     docYear,
     source: "portal",
     receivedBy: null
   }).catch(() => null); // soft-fail to not break upload flow
   ```

**Result:**
- Borrower uploads "acme_2023_taxes_1120.pdf"
- System infers: `{ docType: "Tax Return", docYear: 2023 }`
- Creates `deal_document_receipts` row
- Database trigger fires
- Borrower sees: **"Bank received: Tax Return received"** with detail "2023 • acme_2023_taxes_1120.pdf"

---

## Deployment Steps

### 1. Run Database Migration

```bash
# Option A: Via Supabase CLI
supabase db push

# Option B: Via psql
psql $DATABASE_URL < supabase/migrations/20251220_status_playbook_templates_and_doc_receipts.sql
```

**What This Does:**
- Creates 3 new tables (`deal_stage_playbook`, `deal_eta_note_templates`, `deal_document_receipts`)
- Seeds playbook with 8 stages
- Seeds templates with 4 global defaults
- Creates database trigger `on_doc_receipt_log_timeline()`

### 2. Verify Tables Created

```sql
SELECT * FROM deal_stage_playbook;
-- Should return 8 rows (intake → declined)

SELECT * FROM deal_eta_note_templates;
-- Should return 4 rows (Ordered appraisal, Waiting on third-party, etc.)
```

### 3. Test Timeline API

```bash
curl http://localhost:3000/api/deals/YOUR_DEAL_ID/timeline
```

**Expected Response:**
```json
{
  "ok": true,
  "status": null,
  "playbook": {
    "stage": "intake",
    "borrower_title": "Intake",
    "borrower_steps": [...]
  },
  "events": []
}
```

### 4. Test ETA Templates API

```bash
curl http://localhost:3000/api/banker/eta-templates \
  -H "x-user-id: test-user-123"
```

**Expected Response:**
```json
{
  "ok": true,
  "templates": [
    { "id": "...", "label": "Ordered appraisal", "note": "..." },
    ...
  ]
}
```

---

## Integration Guide

### Banker Inbox Integration

**Where:** Your banker inbox file (e.g., `src/app/banks/[bankId]/deals/page.tsx`)

**Step 1:** Import the component
```typescript
import { DealStageEtaControls } from "@/components/banker/DealStageEtaControls";
```

**Step 2:** Update inbox API to join `deal_status`
```typescript
const { data: deals } = await supabase
  .from("deals")
  .select(`
    *,
    status:deal_status(stage, eta_date, eta_note, updated_at)
  `)
  .eq("bank_id", bankId);
```

**Step 3:** Render controls in deal row/card
```tsx
<DealStageEtaControls
  dealId={deal.id}
  initialStage={deal.status?.stage}
  initialEtaDate={deal.status?.eta_date ?? null}
  initialEtaNote={deal.status?.eta_note ?? null}
  actorUserId={session.userId} // from Clerk or your auth
  onSaved={() => router.refresh()} // refresh deal list
/>
```

### Borrower Portal Integration

**Where:** `src/app/portal/[token]/page.tsx` (or wherever you show borrower timeline)

**Step 1:** Remove heuristic timeline code
- Delete `loadStatus()` function
- Delete heuristic timeline rendering

**Step 2:** Import new component
```typescript
import { BorrowerTimeline } from "@/components/borrower/BorrowerTimeline";
```

**Step 3:** Replace old timeline with new component
```tsx
<BorrowerTimeline dealId={invite.deal_id} />
```

**Result:**
- Borrowers see real banker-controlled stage/ETA
- Borrowers see "What happens next" checklist (stage-specific)
- Borrowers see real timeline events (including "Bank received: ..." from uploads)

---

## Testing the Full Flow

### Scenario: Borrower uploads tax return

1. **Borrower:** Uploads "acme_2023_taxes.pdf" via portal
2. **System:** Auto-matches to "2023 Business Tax Return" request (confidence 95%)
3. **System:** Calls `inferDocTypeAndYear("acme_2023_taxes.pdf")` → returns `{ docType: "Tax Return", docYear: 2023 }`
4. **System:** Calls `logDealDocumentReceipt({ dealId, fileName: "acme_2023_taxes.pdf", docType: "Tax Return", docYear: 2023 })`
5. **Database:** Trigger creates timeline event: `{ kind: "doc_received", title: "Bank received: Tax Return received", detail: "2023 • acme_2023_taxes.pdf", visible_to_borrower: true }`
6. **Borrower:** Sees "Bank received: Tax Return received" in timeline (within 15s due to polling)

### Scenario: Banker updates ETA with template

1. **Banker:** Opens deal in inbox
2. **Banker:** Sees `DealStageEtaControls` with stage="underwriting", etaDate=null, etaNote=""
3. **Banker:** Selects "Ordered appraisal" from template dropdown
4. **Banker:** Clicks "Apply" → note field fills with "We have ordered the appraisal/valuation and will update you when it is scheduled."
5. **Banker:** Sets ETA date to "2025-12-28"
6. **Banker:** Clicks "Save"
7. **System:** PATCHes `/api/deals/{dealId}/status` with `{ stage: "underwriting", etaDate: "2025-12-28", etaNote: "We have ordered..." }`
8. **System:** Creates timeline events: "Stage updated → Stage set to underwriting", "ETA updated → ETA set to 2025-12-28"
9. **Borrower:** Refreshes portal → sees stage="Underwriting", ETA="2025-12-28", note="We have ordered..."
10. **Borrower:** Sees "What happens next" checklist change to underwriting steps

---

## Technical Details

### Why Database Trigger vs Application Logic?

**Decision:** Use database trigger for document receipt → timeline event

**Pros:**
- **Atomic:** Timeline event is created in same transaction as document receipt
- **Guaranteed:** Can't forget to log event (happens automatically)
- **Clean separation:** Upload logic doesn't need to know about timeline schema
- **Performance:** No extra round-trip to database

**Cons:**
- Less visible in application code
- Harder to debug (need to check database trigger code)

**Verdict:** Database trigger is correct choice for this use case. The logging is a pure data integrity concern, not business logic.

### RLS Strategy

All 3 new tables have strict RLS (all policies return `false`):
- **Why:** Server routes use `supabaseAdmin()` to bypass RLS
- **Borrower access:** Via server routes only (e.g., `/api/deals/[dealId]/timeline`)
- **Banker access:** Via server routes only (e.g., `/api/banker/eta-templates`)

**Alternative:** Could add RLS for banker read/write using `is_deal_banker()` function (already exists from prior migration)

### Soft-Fail Strategy for Document Receipts

```typescript
await logDealDocumentReceipt({...}).catch(() => null);
```

**Why:** Upload should succeed even if timeline logging fails (non-critical feature)

**Alternative:** Could log error to monitoring service (Sentry, etc.) but still return success to user

---

## What You Unlocked

### Borrower Experience
✅ Stage-aware guidance ("What happens next" changes by stage)
✅ Instant feedback when docs received ("Bank received: Tax Return received")
✅ Transparent ETA with borrower-safe notes
✅ Timeline feels alive (real events, not heuristics)

### Banker Experience
✅ 2-click ETA updates (select template → apply → save)
✅ Reusable note templates (global + custom)
✅ Stage management from inbox (no need to navigate to deal detail)
✅ Timeline becomes system-of-record (not inferred from checklist state)

### System Architecture
✅ Database trigger ensures timeline integrity
✅ Smart heuristics extract doc type/year from filenames
✅ Borrower-safe playbook lives in database (can edit without deploy)
✅ Templates are shared across bankers (consistency + efficiency)

---

## Next Steps (Optional Enhancements)

### 1. Auto-highlight checklist from doc receipt
When "Tax Return received" event fires, highlight the "2023 Business Tax Return" checklist item

**Implementation:**
- Add `request_id` to `deal_document_receipts` (FK to `borrower_document_requests`)
- In `BorrowerTimeline`, fetch recent doc_received events
- Match `request_id` to checklist items
- Add CSS class for highlighted state (e.g., green border + checkmark)

### 2. Banker custom playbook editing
Allow bankers to customize "What happens next" steps per deal

**Implementation:**
- Add `deal_playbook_overrides` table (deal_id, stage, custom_steps jsonb)
- In `getBorrowerPlaybookForStage()`, check for override first
- Add UI in banker deal detail to edit playbook

### 3. Email notifications for timeline events
Send email to borrower when timeline event created

**Implementation:**
- Add another database trigger on `deal_timeline_events` INSERT
- Check if `visible_to_borrower = true`
- Queue email job (e.g., via `pg_notify` or insert into jobs table)
- Worker sends email via SendGrid/Postmark

### 4. Banker timeline event creation
Allow bankers to manually add timeline events (e.g., "Called borrower to discuss appraisal")

**Implementation:**
- Add POST `/api/deals/[dealId]/timeline/events`
- Accept `{ title, detail, visible_to_borrower }` body
- Insert into `deal_timeline_events` with `kind: "banker_note"`
- Show in borrower timeline if `visible_to_borrower = true`

---

## Files Created/Modified Summary

### Created (10 files):
1. `supabase/migrations/20251220_status_playbook_templates_and_doc_receipts.sql` (174 lines)
2. `src/lib/deals/playbook.ts` (23 lines)
3. `src/lib/deals/etaTemplates.ts` (44 lines)
4. `src/lib/deals/docReceipts.ts` (31 lines)
5. `src/lib/uploads/docTypeHeuristics.ts` (21 lines)
6. `src/app/api/banker/eta-templates/route.ts` (48 lines)
7. `TIMELINE_MAGIC_COMPLETE.md` (this file)

### Modified (3 files):
1. `src/app/api/deals/[dealId]/timeline/route.ts` (added playbook fetch)
2. `src/components/banker/DealStageEtaControls.tsx` (added templates dropdown + create form)
3. `src/components/borrower/BorrowerTimeline.tsx` (added playbook "What happens next" section)
4. `src/app/api/borrower/portal/[token]/upload/route.ts` (added document receipt logging)

### Total Lines Added: ~600 lines of production code

---

## Support

For questions or issues:
1. Check database trigger logs: `SELECT * FROM deal_timeline_events WHERE kind = 'doc_received';`
2. Verify templates loaded: `SELECT * FROM deal_eta_note_templates;`
3. Test playbook API: `curl http://localhost:3000/api/deals/YOUR_DEAL_ID/timeline`
4. Check upload logs for doc receipt errors (should soft-fail silently)

**Common Issues:**

**Q:** Templates not loading in banker controls?
**A:** Check `x-user-id` header is present. Open Network tab → verify GET `/api/banker/eta-templates` returns 200.

**Q:** "What happens next" not showing for borrower?
**A:** Verify `deal_status` row exists for deal. Check stage value matches playbook table (e.g., "underwriting" not "Underwriting").

**Q:** Timeline events not appearing after upload?
**A:** Check `deal_document_receipts` table has row. Verify database trigger exists: `SELECT prosrc FROM pg_proc WHERE proname = 'on_doc_receipt_log_timeline';`

---

**Status:** ✅ Complete and ready for deployment
**Tested:** All TypeScript files compile with no errors
**Ready for:** Migration deployment → banker inbox integration → borrower portal integration
