# Borrower Portal — Component Architecture

## Page Structure

```
/borrower/portal?token=ABC123
│
└─── BorrowerPortalPage (page.tsx)
     │
     ├─── usePortalRequests(token)  ← Data hook
     │    └─── Fetches: /api/borrower/portal/[token]/requests
     │
     └─── UI Layout (lg:grid-cols-12)
          │
          ├─── Left Column (lg:col-span-5)
          │    │
          │    ├─── PortalProgressCard
          │    │    └─── Progress bar + metrics
          │    │
          │    ├─── PackSuggestionsCard
          │    │    └─── Top suggestion + alternatives
          │    │
          │    └─── PortalUploadCta
          │         └─── "Upload documents" CTA
          │
          └─── Right Column (lg:col-span-7)
               │
               └─── PortalRequestsList
                    └─── Document checklist
```

## Data Flow

```
1. Page loads with token from URL
   ↓
2. usePortalRequests(token) hook fires
   ↓
3. GET /api/borrower/portal/[token]/requests
   ↓
4. Route validates token → requireValidInvite()
   ↓
5. Route queries:
   • borrower_document_requests
   • borrower_pack_confidence_summary
   • borrower_progress_and_risk
   • borrower_upload_inbox (count)
   ↓
6. Route transforms to borrower-safe format
   ↓
7. Hook derives:
   • suggestions (sorted by confidence)
   • bestSuggestion (rank 1)
   • progress (completion metrics)
   • requests (document list)
   ↓
8. Components render with derived data
```

## Upload Flow

```
Borrower clicks "Upload documents"
   ↓
Navigate to /borrower/portal/upload?token=ABC123
   ↓
File upload → POST /api/borrower/portal/[token]/upload
   ↓
Upload route:
   • Stores file in borrower-uploads bucket
   • Creates row in borrower_upload_inbox
   • Runs auto-match (computeMatch)
   ↓
If confidence ≥ 85%:
   • Attach to request
   • Update request status → "received"
   • Write borrower_pack_match_events
   • Write borrower_pack_learning_events
   ↓
If confidence < 85%:
   • Leave in inbox
   • Banker reviews later
   ↓
Borrower returns to portal
   ↓
Clicks "Refresh" → re-fetches data
   ↓
Sees updated:
   • Progress bar (e.g., 45% → 55%)
   • Pack confidence (e.g., 85% → 95%)
   • Request status (OPEN → COMPLETE)
```

## State Management

```typescript
// Hook state machine
type State =
  | { status: "idle"; data: null; error: null }        // Initial
  | { status: "loading"; data: null; error: null }     // Fetching
  | { status: "ready"; data: Response; error: null }   // Success
  | { status: "error"; data: null; error: string }     // Failed

// Page renders different UI based on state:
idle/loading  → Loading skeleton
error         → Error message + retry button
ready         → Full UI with data
```

## Component Props

```typescript
// PackSuggestionsCard
<PackSuggestionsCard 
  suggestions={[
    {
      pack_id: "uuid",
      pack_name: "SBA 7(a) Standard",
      confidence: 0.95,
      matched_doc_count: 3,
      missing_doc_count: 7,
      reason_codes: ["tax_return", "bank_statements"]
    }
  ]}
/>

// PortalProgressCard
<PortalProgressCard 
  progress={{
    progress_pct: 45,
    uploaded_count: 5,
    expected_count: 11,
    missing_critical_count: 3,
    stale_items_count: 0
  }}
/>

// PortalRequestsList
<PortalRequestsList 
  requests={[
    {
      id: "uuid",
      title: "2023 Tax Return",
      description: "Form 1120S",
      status: "OPEN",
      category: "financial",
      due_date: "2024-12-31"
    }
  ]}
/>

// PortalUploadCta
<PortalUploadCta token="ABC123" />
```

## Responsive Behavior

```
Mobile (< lg):
┌─────────────────┐
│ Progress        │
│ Suggestions     │
│ Upload CTA      │
│ Requests List   │
└─────────────────┘
(Stacked vertically)

Desktop (≥ lg):
┌──────────┬─────────────┐
│ Progress │             │
│ Suggest  │  Requests   │
│ Upload   │    List     │
└──────────┴─────────────┘
(Left: 5 cols, Right: 7 cols)
```

## Error Handling

```
Token missing
  → "Missing portal token" message
  → Show instructions

Token invalid/expired
  → "Couldn't load your portal" message
  → Show error + retry button

Network failure
  → "Couldn't load your portal" message
  → Show error + retry button

Views not created yet
  → Pack suggestions: empty state
  → Progress: shows 0%
  → Requests: shows whatever exists
```

## Future Extensions (Easy to Add)

```
Left Column additions:
├─── PortalProgressCard (existing)
├─── PackSuggestionsCard (existing)
├─── MissingItemsCard (next sprint) ← NEW
├─── RecentActivityCard ← NEW
└─── PortalUploadCta (existing)

Right Column additions:
├─── PortalRequestsList (existing)
└─── UploadHistoryCard ← NEW
```

## Type Safety

```
All components import from:
  @/lib/borrower/portalTypes

If API changes:
  1. Update portalTypes.ts
  2. TypeScript errors show exactly where to fix
  3. Update API route transformation
  4. Components auto-adjust (props are typed)
```

## Performance Optimizations (Future)

```typescript
// Add SWR for auto-refresh
import useSWR from 'swr';

const { data, error, mutate } = useSWR(
  token ? `/api/borrower/portal/${token}/requests` : null,
  fetcher,
  { refreshInterval: 30000 } // Poll every 30s
);

// Add React Query for caching
const { data } = useQuery({
  queryKey: ['portal', token],
  queryFn: () => fetchPortalData(token),
  staleTime: 60000, // 1 minute
});
```

## Testing Checklist

- [ ] Portal loads with valid token
- [ ] Portal shows error with invalid token
- [ ] Portal shows error with expired token
- [ ] Progress bar displays correctly (0-100%)
- [ ] Pack suggestions sort by confidence
- [ ] Requests list sorts by status/date
- [ ] Show/hide completed toggle works
- [ ] Refresh button re-fetches data
- [ ] Upload CTA routes to correct URL
- [ ] Mobile layout stacks vertically
- [ ] Desktop layout shows 2 columns
- [ ] Empty states display properly
- [ ] Loading state shows before data
- [ ] Error state shows retry button
