# Multi-Entity Implementation — Quick Start

## 🚀 15-Minute Integration Path

### Step 1: Run Migration (2 min)
```sql
-- Paste into Supabase SQL Editor
-- File: docs/migrations/001_multi_entity_foundation.sql
```

### Step 2: Update UploadBox.tsx (10 min)

Add these imports at top:
```typescript
import { EntitySelector } from './EntitySelector';
import { EntityBadge } from './EntityBadge';
import { EntityAssignmentControl } from './EntityAssignmentControl';
import type { DealEntity } from '@/lib/entities/types';
```

Add state (around line 280):
```typescript
const [entities, setEntities] = useState<DealEntity[]>([]);
const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
```

Add entity loading effect:
```typescript
useEffect(() => {
  async function loadEntities() {
    try {
      const res = await fetch(`/api/deals/${dealId}/entities`);
      if (res.ok) {
        const data = await res.json();
        setEntities(data.entities || []);
      }
    } catch (e) {
      console.error('Failed to load entities:', e);
    }
  }
  loadEntities();
}, [dealId]);
```

Update packIndex building (modify existing useEffect around line 600):
```typescript
useEffect(() => {
  if (!jobs || jobs.length === 0) {
    setPackIndex(null);
    return;
  }

  const index = buildPackIndex({
    jobs,
    entityFilter: selectedEntityId, // NEW: Filter by entity
  });

  setPackIndex(index);
}, [jobs, selectedEntityId]); // Add selectedEntityId dependency
```

Add EntitySelector to left rail (before Pack Navigator):
```tsx
{/* Entity Selector - Add above Pack Navigator */}
{entities.length > 0 && (
  <EntitySelector
    entities={entities}
    selectedEntityId={selectedEntityId}
    onSelectEntity={setSelectedEntityId}
    className="mb-6"
  />
)}
```

Add entity badges in doc list (in GROUP view):
```tsx
{/* In document list rendering */}
{selectedEntityId === null && doc.entity_id && (
  <EntityBadge 
    entityName={entities.find(e => e.id === doc.entity_id)?.name}
    entityKind={entities.find(e => e.id === doc.entity_id)?.entity_kind}
    className="ml-2"
  />
)}
```

Add assignment control to preview panel:
```tsx
{/* In preview panel, after document details */}
{selectedJob && (
  <div className="mt-4 border-t pt-4">
    <h4 className="text-sm font-semibold mb-2">Entity Assignment</h4>
    <EntityAssignmentControl
      dealId={dealId}
      jobId={selectedJob.job_id}
      currentEntityId={selectedJob.entity_id}
      entities={entities}
      onAssigned={() => {
        fetchJobs(); // Reload jobs
      }}
    />
  </div>
)}
```

### Step 3: Test (3 min)

1. **Start dev server:**
   ```bash
   npm run dev
   ```

2. **Open deal page, verify:**
   - [ ] EntitySelector shows "Group (Combined)" + any existing entities
   - [ ] Clicking entity filters pack view
   - [ ] Upload pack → docs get auto-suggestions
   - [ ] Assigning entity updates immediately

---

## 📋 File Checklist

All files created and ready to use:

### Database
- [x] `docs/migrations/001_multi_entity_foundation.sql`

### API Routes
- [x] `src/app/api/deals/[dealId]/entities/route.ts`
- [x] `src/app/api/deals/[dealId]/entities/[entityId]/route.ts`
- [x] `src/app/api/deals/[dealId]/packs/items/[jobId]/assign-entity/route.ts`
- [x] `src/app/api/deals/[dealId]/packs/items/[jobId]/suggest-entity/route.ts`
- [x] `src/app/api/deals/[dealId]/spreads/combined/generate/route.ts`

### Core Logic
- [x] `src/lib/entities/types.ts`
- [x] `src/lib/entities/entityMatching.ts`
- [x] `src/lib/packs/requirements/evaluateByEntity.ts`
- [x] `src/lib/finance/combined/aggregate.ts`
- [x] `src/lib/deals/pack/buildPackIndex.ts` (updated)

### UI Components
- [x] `src/components/deals/EntitySelector.tsx`
- [x] `src/components/deals/EntityBadge.tsx`
- [x] `src/components/deals/EntityAssignmentControl.tsx`

### Documentation
- [x] `docs/MULTI_ENTITY_INTEGRATION_GUIDE.md` (comprehensive)
- [x] `docs/QUICK_START.md` (this file)

---

## 🎯 What You Get

### For Underwriters
- **Entity Switcher:** Toggle between OpCos, PropCos, Persons, or GROUP view
- **Smart Assignment:** Auto-suggests entity based on EIN/company name in docs
- **Filtered Views:** See only relevant docs for selected entity
- **Entity Badges:** Visual indicators showing which entity owns each doc

### For Developers
- **Type-Safe:** Full TypeScript types for entities, periods, spreads
- **Database-Ready:** Supabase migration with RLS policies
- **File-Based Fallback:** Works without database during development
- **Extensible:** Easy to add entity templates, bulk actions, analytics

---

## 🔗 API Examples

### Create Entity
```bash
curl -X POST http://localhost:3000/api/deals/DEAL_ID/entities \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme HVAC Inc.",
    "entity_kind": "OPCO",
    "ein": "12-3456789",
    "legal_name": "Acme HVAC Incorporated"
  }'
```

### Assign Document to Entity
```bash
curl -X POST http://localhost:3000/api/deals/DEAL_ID/packs/items/JOB_ID/assign-entity \
  -H "Content-Type: application/json" \
  -d '{
    "entity_id": "ENTITY_UUID"
  }'
```

### Get Entity Suggestions
```bash
curl -X POST http://localhost:3000/api/deals/DEAL_ID/packs/items/JOB_ID/suggest-entity \
  -H "Content-Type: application/json"
```

### Generate Combined Spread
```bash
curl -X POST http://localhost:3000/api/deals/DEAL_ID/spreads/combined/generate \
  -H "Content-Type: application/json" \
  -d '{
    "entity_ids": ["ENTITY_1_ID", "ENTITY_2_ID"],
    "fiscal_year": 2023,
    "period_type": "ANNUAL"
  }'
```

---

## 💡 Pro Tips

1. **EIN Format Matters:** Ensure EINs are stored as `XX-XXXXXXX` for auto-matching
2. **GROUP Entity:** Always exists, represents combined view of all entities
3. **Entity Filter:** `null` = GROUP view, `string` = specific entity
4. **Lazy Loading:** Entities load on mount, suggestions load on doc select
5. **File-Based Dev:** No Supabase needed—APIs use `.data/entities/` folder

---

## 🎓 Example: Real-World Multi-Entity Deal

**Client:** ABC Holdings (3 businesses)

**Entities Created:**
1. ABC Manufacturing LLC (OPCO) — EIN: 45-1234567
2. ABC Real Estate Holdings (PROPCO) — EIN: 45-9876543
3. Smith Family Trust (PERSON)

**Upload:** 18 PDFs
- 6 tax returns (ABC Manufacturing 2021-2023)
- 6 tax returns (ABC Real Estate 2021-2023)
- 3 personal returns (Smith 2021-2023)
- 2 PFS documents
- 1 credit memo

**Auto-Assignments:**
- All ABC Manufacturing docs → matched by EIN (100% confidence)
- All ABC Real Estate docs → matched by EIN (100% confidence)
- Personal returns → matched by name "Smith" (70% confidence)

**Underwriter Workflow:**
1. Reviews suggestions → accepts all
2. Manually assigns PFS to Smith Family Trust
3. Switches to "ABC Manufacturing" view → verifies 2021-2023 coverage
4. Switches to "ABC Real Estate" view → notes missing 2021 financials
5. Switches to GROUP view → sees all 18 docs with entity badges
6. Generates combined spread for all entities

**Result:** Complete multi-entity underwriting in 5 minutes

---

## ✅ Verification Checklist

Before deploying:

- [ ] Migration runs without errors
- [ ] GROUP entity auto-creates on first load
- [ ] EntitySelector renders with all entities
- [ ] Clicking entity filters pack view correctly
- [ ] Entity badges show in GROUP view
- [ ] Auto-suggestion appears for unassigned docs
- [ ] Assignment saves and updates UI
- [ ] Coverage checklist respects entity filter
- [ ] Combined spread API returns aggregated data

---

**Ready to handle complex multi-entity deals! 🚀**
