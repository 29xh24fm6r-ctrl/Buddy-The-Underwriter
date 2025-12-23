# Deal Command Center - Quick Reference

## Access

**URL:** `/deals/[dealId]/command`

Example: `http://localhost:3000/deals/abc-123/command`

---

## What It Shows

### Header
- Deal name
- Bank name
- Snapshot timestamp
- Quick nav buttons

### Stats (4 cards)
- Uploads count
- Doc Requests count
- Conditions count
- Intel Runs count

### Intel Panel
- Bank fee extraction
- Financial statement extraction
- Total fees, products, periods
- Full JSON dumps

### Pricing Panel
- Pricing policies (from snapshot)
- Pricing quotes (from snapshot)
- "Quote Pricing" button

### Docs Panel
- Recent uploads (12 max)
- Recent requests (12 max)
- Status for each

### Timeline Panel
- Combined events (20 max):
  - Deal timeline
  - Condition events
  - Upload events
- Sorted by timestamp

### Raw Context Panel
- Full snapshot JSON
- Shows what AI reads
- Useful for debugging

---

## Actions

### Run Intel Now
**What:** Runs intelligence extraction on latest upload  
**How:** Click button → POST `/api/deals/[dealId]/intel/run`  
**Result:** Extractions written → snapshot refreshes → page reloads

### Quote Pricing
**What:** Generates pricing quote from deal context  
**How:** Click button → POST `/api/deals/[dealId]/pricing/quote`  
**Parameters:**
```json
{
  "requestedAmount": 500000,
  "termMonths": 60,
  "riskRating": 5,
  "collateralStrength": "moderate"
}
```
**Result:** Pricing calculated → quote created → page reloads

---

## Data Flow

```
deal_context_snapshots
        ↓
  getDealContext()
        ↓
    Command Center Page
        ↓
    [ All Panels ]
```

---

## API Endpoints

### Run Intel
```bash
POST /api/deals/[dealId]/intel/run

# Example
curl -X POST "http://localhost:3000/api/deals/abc-123/intel/run"
```

**Response:**
```json
{
  "ok": true,
  "uploadId": "...",
  "dealId": "...",
  "stored": ["BANK_STATEMENTS", "FINANCIAL_STATEMENTS"],
  "classifier": { "doc_type": "...", "confidence": 0.7 }
}
```

### Quote Pricing
```bash
POST /api/deals/[dealId]/pricing/quote
Content-Type: application/json

{
  "requestedAmount": 500000,
  "termMonths": 60,
  "riskRating": 5,
  "collateralStrength": "moderate"
}
```

**Response:**
```json
{
  "ok": true,
  "baseRate": 0.065,
  "adjustedRate": 0.072,
  "monthlyPayment": 9876.54,
  "quote_id": "..."
}
```

---

## File Locations

| Component | File |
|-----------|------|
| Main Page | `src/app/deals/[dealId]/command/page.tsx` |
| Data Loader | `src/lib/deals/getDealContext.ts` |
| Header | `src/app/deals/[dealId]/_components/CommandHeader.tsx` |
| Stats | `src/app/deals/[dealId]/_components/StatGrid.tsx` |
| Intel | `src/app/deals/[dealId]/_components/IntelPanel.tsx` |
| Pricing | `src/app/deals/[dealId]/_components/PricingPanel.tsx` |
| Docs | `src/app/deals/[dealId]/_components/DocsPanel.tsx` |
| Timeline | `src/app/deals/[dealId]/_components/TimelinePanel.tsx` |
| Raw Context | `src/app/deals/[dealId]/_components/RawContextPanel.tsx` |
| Intel API | `src/app/api/deals/[dealId]/intel/run/route.ts` |
| Pricing API | `src/app/api/deals/[dealId]/pricing/quote/route.ts` |

---

## Testing

```bash
# Run test suite
./test-command-center.sh

# Manual test
npm run dev
# Visit http://localhost:3000/deals/[DEAL_ID]/command
```

---

## Customization

### Add a Panel
1. Create component in `_components/YourPanel.tsx`
2. Add to page: `<YourPanel ctx={ctx} />`

### Modify Stats
Edit `StatGrid.tsx`:
```tsx
const items = [
  { label: "Your Stat", value: ctx?.your_array?.length ?? 0 },
  // ...
];
```

### Change Layout
Edit `command/page.tsx`:
```tsx
// Current: 2-col main + 1-col sidebar
<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

// Full width:
<div className="space-y-4">
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Context empty | Check snapshot exists: `SELECT * FROM deal_context_snapshots WHERE deal_id = '...'` |
| Intel fails | Check uploads exist: `SELECT * FROM borrower_uploads WHERE deal_id = '...'` |
| Pricing fails | Check console for API errors |
| Snapshot stale | Manually refresh: `SELECT refresh_deal_context_snapshot('...')` |

---

## Next Steps

**Choose one:**

### Option A: Pricing Quote Writer
Build engine that reads snapshot → generates normalized pricing quote

**Result:** Real pricing based on deal risk, not placeholder values

### Option B: Memo Generator
Build engine that reads snapshot → generates memo PDF

**Result:** One-click approval artifact from deal context

---

**Documentation:** [DEAL_COMMAND_CENTER.md](DEAL_COMMAND_CENTER.md)

**Related:** 
- [UPLOAD_INTELLIGENCE_SETUP.md](UPLOAD_INTELLIGENCE_SETUP.md)
- [NAVIGATION_SYSTEM.md](NAVIGATION_SYSTEM.md)
- [FLOW.md](FLOW.md)
