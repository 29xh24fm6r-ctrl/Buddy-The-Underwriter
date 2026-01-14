# Ownership Intelligence Engine — COMPLETE ✅

AI-native ownership system that extracts from docs, shows evidence, confirms with one tap, and auto-provisions everything downstream.

---

## What You Got

**Evidence-Driven Extraction:**
- Scans uploaded docs (operating agreement, K-1s, cap table, stock ledger)
- Extracts owner names + percentages with confidence scores
- Shows borrower-safe evidence: doc name + page + snippet
- No manual data entry required

**One-Tap Confirmation:**
- Borrower sees owner cards with evidence chips
- Tap "✓ Confirm all" or confirm/reject individually
- Or type natural language correction: "Me 60%, John 25%, Sarah 15%"
- No sliders, no forms, no spreadsheets

**Natural Language Parser:**
- Understands: "Matt 55, John 25, Sarah 20"
- Handles: "I'm 51%, spouse 49%"
- Accepts: "Add Mike Johnson, 10%, mike@example.com"
- Validates totals (warns if >100% or <80%)

**Auto-Provision Pipeline:**
- Creates `deal_owners` with 20% rule enforcement
- Ensures owner checklists (PFS + 3yr tax + guaranty)
- Creates owner portal tokens (14-day expiry)
- Queues email invites (server-side)
- Creates banker timeline event

**Borrower Experience:**
> "We found 3 owners. Please confirm."  
> [✓ Confirm] [✏️ Fix]  
> …done in 10 seconds.

---

## Files Created

### 1. Migration
- `supabase/migrations/20251220_ownership_findings.sql`
  - **deal_ownership_findings** — extracted candidates with evidence
  - Columns: name, percent, confidence, evidence (doc/page/snippet), status
  - RLS deny-all (server-only)

### 2. Server Libraries
- `src/lib/ownership/extractor.ts`
  - `extractOwnershipFromDocs()` — pattern matching in OCR text
  - Looks for: "Name - XX%", "Member: Name (XX%)", "| Name | XX% |"
  - Returns candidates with confidence + evidence
  - `saveOwnershipFindings()` — writes to database
  - `ensureOwnershipFindings()` — idempotent extraction (runs once)

- `src/lib/ownership/parser.ts`
  - `parseOwnershipText()` — natural language → structured data
  - Handles: percentages, "me/spouse" resolution, emails
  - `validateOwnershipTotals()` — checks totals (80-100% acceptable)

### 3. Portal APIs
- `src/app/api/portal/deals/[dealId]/ownership/findings/route.ts`
  - **GET** — borrower-safe findings view
  - Returns: proposed cards (with evidence), confirmed owners, coverage %
  - Auto-runs extraction on first call (idempotent)

- `src/app/api/portal/deals/[dealId]/ownership/confirm/route.ts`
  - **POST** actions:
    - `confirm_all` — accept all proposed findings
    - `confirm_one` — accept single finding
    - `reject_one` — reject single finding
    - `correct_text` — parse natural language correction
  - Auto-provisions: owners → checklists → portals → outreach emails

### 4. UI Component
- `src/components/portal/OwnershipConfirmPanel.tsx`
  - Evidence-driven owner cards
  - Confidence badges (High/Medium/Low)
  - Evidence chips (doc name + page)
  - Evidence snippets (borrower-safe excerpts)
  - One-tap confirm/reject buttons
  - Natural language correction box with examples
  - Coverage banner (green if ≥80%, yellow if partial)

---

## The Extraction Flow

### 1. Borrower Uploads Documents
- Operating agreement
- K-1s
- Cap table
- Stock ledger
- Articles of organization

### 2. System Auto-Extracts (Background)
```ts
await ensureOwnershipFindings(dealId);
// Scans all uploaded docs → finds patterns → saves to deal_ownership_findings
```

**Patterns detected:**
- "John Smith - 30%"
- "Member: Sarah Jones (25%)"
- "| Robert Lee | 45% |"

**Evidence captured:**
- Doc: "Operating Agreement LLC.pdf"
- Page: 4
- Snippet: "Member: John Smith shall hold thirty percent (30%) membership interest..."
- Confidence: 0.75 (High)

### 3. Borrower Sees Confirmation Screen
Owner cards:
```
┌─────────────────────────────────────┐
│ John Smith                    [High]│
│ 30% ownership                       │
│ 📄 Operating Agreement LLC.pdf p.4  │
│ "Member: John Smith shall hold..."  │
│                                     │
│         [✓ Confirm]  [✕ Remove]     │
└─────────────────────────────────────┘
```

### 4. Borrower Actions

**Option A: Confirm all**
- Tap "✓ Confirm all"
- System creates owners → provisions portals → queues emails
- Done

**Option B: Fix/Add**
- Tap "✏️ Fix / Add owners"
- Type: "Me 55%, John 30%, Sarah 15%"
- Submit → system parses → provisions
- Done

**Option C: Individual confirm/reject**
- Confirm: "John Smith" ✓
- Reject: "Robert Lee" ✕
- Add manually: "Sarah Jones, 15%, sarah@example.com"

### 5. Auto-Provision Triggers

Once confirmed:
```ts
await confirmAndProvision(dealId, owners);
```

1. Creates `deal_owners` rows
2. Calculates 20% rule: `requires_personal_package = true`
3. Ensures owner checklists (PFS + 3yr tax + guaranty)
4. Creates owner portal tokens
5. Queues invite emails
6. Creates banker timeline event

---

## Natural Language Examples

**Input variations:**
- "Me 60, John 25, Sarah 15"
- "I'm 51%, spouse 49%"
- "Matt Smith 55%, John Doe 25%, Sarah Jones 20%"
- "Two owners: me and my partner, 50/50"
- "Add Mike Johnson, 10%, mike@example.com"

**Parser handles:**
- Self-references: "me" / "I" / "myself" → borrower name
- Relationships: "spouse" / "partner" / "wife" / "husband"
- Email extraction: name + percent + email
- Title casing: "john smith" → "John Smith"
- Common splits: "50/50" → 2 owners @ 50% each

**Validation:**
- Total > 100% → error: "Ownership adds up to 105%. Should be 100% or less."
- Total < 80% → error: "Only 65% assigned. Are there more owners?"
- 80-100% → valid (acceptable rounding/pending)

---

## Evidence Chips (Borrower-Safe)

What borrower sees:
- ✅ "Operating Agreement LLC.pdf p.4"
- ✅ "2024 K-1 Schedule.pdf p.2"
- ✅ "Cap Table.xlsx"

What borrower does NOT see:
- ❌ Internal doc classifications
- ❌ Underwriting scores
- ❌ Risk assessments
- ❌ Banker notes

Evidence snippets are truncated to 120 chars max, borrower-safe text only.

---

## Confidence Scoring

**High (≥75%):**
- Found in operating agreement
- Multiple mentions
- Clear context ("Member:", "Shareholder:")

**Medium (55-74%):**
- Found in ownership doc (K-1, cap table)
- Single mention
- Some context

**Low (<55%):**
- Found in other docs
- Ambiguous context
- Might be false positive

Borrower can reject low-confidence findings with one tap.

---

## Auto-Provision Details

### When Ownership ≥ 20%:
```ts
if (owner.requires_personal_package) {
  // 1. Ensure checklist
  await ensureOwnerChecklist(ownerId, dealId);
  
  // 2. Create portal token
  const portal = await createOrRefreshOwnerPortal({ dealId, ownerId });
  
  // 3. Queue invite email
  if (owner.email) {
    await sb.from("deal_owner_outreach_queue").insert({
      kind: "invite",
      to_email: owner.email,
      subject: "Personal documents needed",
      body: `Portal: ${portalUrl}`,
    });
  }
}
```

### Timeline Event:
```json
{
  "event_type": "OWNERSHIP_CONFIRMED",
  "title": "Ownership confirmed by borrower",
  "detail": "3 owner(s) confirmed",
  "meta": {
    "owners": [
      { "name": "John Smith", "percent": 30 },
      { "name": "Sarah Jones", "percent": 25 },
      { "name": "Matt Lee", "percent": 45 }
    ]
  }
}
```

---

## Integration Points

### Add to Borrower Portal Page:
```tsx
import { OwnershipConfirmPanel } from "@/components/portal/OwnershipConfirmPanel";

// In your guided upload page or dedicated ownership step:
<OwnershipConfirmPanel 
  dealId={dealId} 
  onComplete={() => {
    // Refresh checklist or show success message
  }} 
/>
```

### Trigger Extraction After Upload:
```ts
// In your document upload handler:
await ensureOwnershipFindings(dealId);
```

This runs extraction idempotently (only once per deal, unless you clear findings).

---

## Canonical Compliance ✅

**What Borrower Sees:**
- Owner names
- Ownership percentages
- Evidence (doc name + page + snippet)
- Confidence tags
- Coverage percentage

**What Borrower Does NOT See:**
- Deal financials
- Credit/risk data
- Underwriting scores
- Internal classifications
- Banker notes
- Other deals

**Security:**
- All ownership tables: RLS deny-all
- Portal auth: Bearer token (buddy_invite_token)
- Evidence snippets: borrower-safe text only
- No PII exposure (email only shown if borrower entered it)
- Auto-provision: server-only (no client DB access)

---

## Testing

### 1. Run Migration
```bash
psql $DATABASE_URL -f supabase/migrations/20251220_ownership_findings.sql
```

### 2. Upload Ownership Doc
- Upload "Operating Agreement.pdf" with text like:
  ```
  Members:
  - John Smith: 30%
  - Sarah Jones: 25%
  - Matt Lee: 45%
  ```

### 3. Trigger Extraction
```bash
curl -X GET https://yourdomain.com/api/portal/deals/DEAL_ID/ownership/findings \
  -H "authorization: Bearer INVITE_TOKEN"
```

### 4. View Findings
- Should return 3 proposed owners with evidence
- Confidence tags: High/Medium/Low
- Evidence snippets visible

### 5. Confirm Ownership
```bash
curl -X POST https://yourdomain.com/api/portal/deals/DEAL_ID/ownership/confirm \
  -H "authorization: Bearer INVITE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"action":"confirm_all"}'
```

### 6. Verify Auto-Provision
- Check `deal_owners` table → 3 rows created
- Check `deal_owner_portals` table → tokens created for ≥20% owners
- Check `deal_owner_checklist_items` table → PFS + 3yr tax items exist
- Check `deal_owner_outreach_queue` table → invite emails queued
- Check `deal_timeline_events` table → "Ownership confirmed" event

---

## Next Evolution

**GO Voice Input** — add speech-to-text so borrower can speak ownership:
> "Hey Buddy, ownership is me sixty percent, John Smith twenty-five, Sarah Jones fifteen."

System transcribes → parses → confirms → provisions. Zero typing.

---

**Status:** READY TO TEST

The AI-native ownership engine is complete. Borrower uploads docs → system extracts → shows evidence → one tap confirm → auto-provisions owners + portals + checklists + emails. Zero forms, zero spreadsheets, zero anxiety. 🚀
