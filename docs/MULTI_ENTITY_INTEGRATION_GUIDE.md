# Multi-Entity Borrower Group — Integration Guide

## 🎯 Overview

This implementation adds **multi-entity support** to Buddy-The-Underwriter, enabling:

- ✅ **Multiple business entities** (OpCos, PropCos, HoldCos, Persons) per deal
- ✅ **Entity-level document assignment** with auto-suggestion
- ✅ **Entity-scoped pack views** (filter by entity or view GROUP)
- ✅ **Entity-aware requirements evaluation**
- ✅ **Combined financial spreads** across entities with intercompany detection

---

## 📦 What Was Delivered

### 1. **Database Schema** (`docs/migrations/001_multi_entity_foundation.sql`)
- `deal_entities` — Entity master table (OpCos, PropCos, etc.)
- `deal_packs` + `deal_pack_items` — Enhanced with `entity_id` column
- `entity_financial_periods` — Normalized financials per entity
- `deal_combined_spreads` — Aggregated multi-entity spreads
- Helper function: `ensure_group_entity()` — Auto-creates GROUP entity

### 2. **TypeScript Types** (`src/lib/entities/`)
- `types.ts` — DealEntity, EntityFinancialPeriod, CombinedSpread, PackItem
- `entityMatching.ts` — Auto-suggestion engine (EIN + name matching)

### 3. **API Routes**
- **Entity CRUD:**
  - `GET/POST /api/deals/[dealId]/entities`
  - `GET/PATCH/DELETE /api/deals/[dealId]/entities/[entityId]`
- **Entity Assignment:**
  - `POST /api/deals/[dealId]/packs/items/[jobId]/assign-entity`
  - `POST /api/deals/[dealId]/packs/items/[jobId]/suggest-entity`
- **Combined Spreads:**
  - `POST /api/deals/[dealId]/spreads/combined/generate`

### 4. **UI Components** (`src/components/deals/`)
- `EntitySelector.tsx` — Left rail entity switcher
- `EntityBadge.tsx` — Small entity pills in doc lists
- `EntityAssignmentControl.tsx` — Preview panel entity assignment

### 5. **Core Logic Updates**
- `buildPackIndex.ts` — Now supports `entityFilter` option
- `evaluateByEntity.ts` — Entity-aware requirements evaluation
- `aggregate.ts` — Combined spread aggregator with intercompany detection

---

## 🚀 Integration Steps

### Step 1: Run Database Migration

1. Open **Supabase SQL Editor**
2. Paste entire content of `docs/migrations/001_multi_entity_foundation.sql`
3. Execute (Role: **postgres**)
4. Verify tables created: `deal_entities`, `entity_financial_periods`, `deal_combined_spreads`

**Note:** For local development without Supabase, the API routes use file-based fallback (`.data/entities/`).

---

### Step 2: Update UploadBox to Load Entities

**File:** `src/components/deals/UploadBox.tsx`

Add state and fetch logic:

```typescript
import { EntitySelector } from './EntitySelector';
import { EntityBadge } from './EntityBadge';
import type { DealEntity } from '@/lib/entities/types';

// Add state (around line 280)
const [entities, setEntities] = useState<DealEntity[]>([]);
const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

// Add useEffect to load entities
useEffect(() => {
  async function loadEntities() {
    try {
      const res = await fetch(`/api/deals/${dealId}/entities`);
      if (res.ok) {
        const data = await res.json();
        setEntities(data.entities || []);
        
        // Default to GROUP entity
        const groupEntity = data.entities.find((e: any) => e.entity_kind === 'GROUP');
        if (groupEntity) {
          setSelectedEntityId(null); // null = GROUP view
        }
      }
    } catch (e) {
      console.error('Failed to load entities:', e);
    }
  }
  
  loadEntities();
}, [dealId]);
```

---

### Step 3: Add EntitySelector to Left Rail

**File:** `src/components/deals/UploadBox.tsx`

In the left column (before Pack Navigator):

```tsx
{/* Entity Selector */}
{entities.length > 0 && (
  <EntitySelector
    entities={entities}
    selectedEntityId={selectedEntityId}
    onSelectEntity={setSelectedEntityId}
    className="mb-6"
  />
)}
```

---

### Step 4: Update Pack Index Building with Entity Filter

**File:** `src/components/deals/UploadBox.tsx`

Modify the `useEffect` that builds `packIndex`:

```typescript
// Update packIndex building (around line 600)
useEffect(() => {
  if (!jobs || jobs.length === 0) {
    setPackIndex(null);
    return;
  }

  const index = buildPackIndex({
    jobs,
    entityFilter: selectedEntityId, // null = GROUP view, string = specific entity
  });

  setPackIndex(index);
}, [jobs, selectedEntityId]); // Add selectedEntityId as dependency
```

---

### Step 5: Show Entity Badges in GROUP View

**File:** `src/components/deals/UploadBox.tsx`

In the document list (left column), add entity badges when in GROUP view:

```tsx
{/* In doc list item rendering */}
<div className="flex items-center justify-between">
  <span>{doc.title || doc.filename}</span>
  
  {/* Show entity badge in GROUP view */}
  {selectedEntityId === null && doc.entity_id && (
    <EntityBadge 
      entityName={entities.find(e => e.id === doc.entity_id)?.name}
      entityKind={entities.find(e => e.id === doc.entity_id)?.entity_kind}
    />
  )}
</div>
```

---

### Step 6: Add Entity Assignment to Preview Panel

**File:** `src/components/deals/UploadBox.tsx`

In the right preview panel (when a document is selected):

```tsx
import { EntityAssignmentControl } from './EntityAssignmentControl';

{/* In preview panel, after classification info */}
{selectedJob && (
  <div className="border-t pt-4">
    <h4 className="font-medium mb-2">Entity Assignment</h4>
    <EntityAssignmentControl
      dealId={dealId}
      jobId={selectedJob.job_id}
      currentEntityId={selectedJob.entity_id}
      entities={entities}
      onAssigned={() => {
        // Reload jobs to reflect assignment
        fetchJobs();
      }}
    />
  </div>
)}
```

---

### Step 7: Update Requirements Evaluation

**File:** `src/components/deals/UploadBox.tsx` or create new component

When displaying PackCoverageCard, pass entity context:

```tsx
import { evaluateEntityRequirements, evaluateGroupRequirements } from '@/lib/packs/requirements/evaluateByEntity';

// In your requirements evaluation logic:
const coverage = selectedEntityId === null
  ? evaluateGroupRequirements(jobs, entities, requirements)
  : evaluateEntityRequirements(
      packIndex,
      requirements,
      selectedEntityId,
      entities.find(e => e.id === selectedEntityId)?.name || '',
      entities.find(e => e.id === selectedEntityId)?.entity_kind || 'OPCO'
    );
```

---

### Step 8: (Optional) Add Entity Creation Modal

Create a simple form to add new entities:

```tsx
// src/components/deals/EntityCreateModal.tsx
export function EntityCreateModal({ dealId, onCreated }: { dealId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'OPCO' | 'PROPCO' | 'HOLDCO' | 'PERSON'>('OPCO');
  const [ein, setEin] = useState('');
  
  const handleSubmit = async () => {
    const res = await fetch(`/api/deals/${dealId}/entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, entity_kind: kind, ein }),
    });
    
    if (res.ok) {
      onCreated();
    }
  };
  
  return (
    <div className="p-4 bg-white rounded-lg shadow-lg">
      <h3 className="font-bold mb-4">Create Entity</h3>
      <input 
        type="text" 
        placeholder="Entity Name" 
        value={name} 
        onChange={e => setName(e.target.value)}
        className="w-full px-3 py-2 border rounded mb-2"
      />
      <select value={kind} onChange={e => setKind(e.target.value as any)} className="w-full px-3 py-2 border rounded mb-2">
        <option value="OPCO">Operating Company</option>
        <option value="PROPCO">Property Company</option>
        <option value="HOLDCO">Holding Company</option>
        <option value="PERSON">Individual/Person</option>
      </select>
      <input 
        type="text" 
        placeholder="EIN (optional)" 
        value={ein} 
        onChange={e => setEin(e.target.value)}
        className="w-full px-3 py-2 border rounded mb-4"
      />
      <button 
        onClick={handleSubmit}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Create Entity
      </button>
    </div>
  );
}
```

Wire it up in `EntitySelector.tsx` (replace the `alert` with modal trigger).

---

## 🧪 Testing Checklist

### Phase 1: Basic Entity Management
- [ ] Run migration in Supabase
- [ ] Create deal, verify GROUP entity auto-created
- [ ] Create 2-3 business entities (OpCo A, OpCo B, PropCo)
- [ ] Switch between entities in EntitySelector

### Phase 2: Document Assignment
- [ ] Upload bulk pack (mixed docs from multiple businesses)
- [ ] In GROUP view, verify all docs visible
- [ ] Click a doc → see entity assignment control
- [ ] Verify auto-suggestion appears (if EIN/name detected)
- [ ] Manually assign doc to entity
- [ ] Switch to that entity's view → verify doc appears

### Phase 3: Requirements Evaluation
- [ ] In entity view, verify coverage shows only that entity's docs
- [ ] In GROUP view, verify coverage shows all docs
- [ ] Check entity-specific missing docs warnings

### Phase 4: Combined Spreads
- [ ] Generate combined spread via API:
  ```bash
  curl -X POST http://localhost:3000/api/deals/DEAL_ID/spreads/combined/generate \
    -H "Content-Type: application/json" \
    -d '{
      "entity_ids": ["ENTITY_1_ID", "ENTITY_2_ID"],
      "fiscal_year": 2023,
      "period_type": "ANNUAL"
    }'
  ```
- [ ] Verify combined statement returned
- [ ] Check flags for intercompany warnings

---

## 📊 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      UPLOAD BULK PACK                        │
│  (14 PDFs: Acme HVAC + Acme Plumbing + Personal Returns)   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              OCR + CLASSIFICATION PIPELINE                   │
│  Extract: Doc Type, Tax Year, EIN, Company Names           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              ENTITY AUTO-SUGGESTION ENGINE                   │
│  Match EIN / Fuzzy Name → Suggest Entity                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                    User Reviews
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              ENTITY ASSIGNMENT (Manual Confirm)              │
│  Set deal_pack_items.entity_id                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              ENTITY-SCOPED PACK VIEW                         │
│  buildPackIndex({ entityFilter: "acme-hvac-id" })          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         ENTITY-AWARE REQUIREMENTS EVALUATION                 │
│  Coverage per entity + GROUP rollup                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         COMBINED SPREAD GENERATION (Optional)                │
│  Aggregate entity_financial_periods → Combined P&L/BS/CF    │
│  Detect intercompany accounts, flag warnings                │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Configuration Notes

### Environment Variables

If using Supabase (production):

```bash
# .env.local
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key # For server-side operations
```

### File-Based Development (Current)

No configuration needed. APIs auto-create `.data/entities/[dealId]/` directories.

---

## 🎨 UI/UX Best Practices

### Entity Colors
- **GROUP**: Gray (neutral, represents all)
- **OPCO**: Blue (operations)
- **PROPCO**: Green (real estate)
- **HOLDCO**: Purple (holding structure)
- **PERSON**: Orange (individual)

### Entity Selector Placement
- **Left rail, top** (above Pack Navigator)
- Always visible, sticky header
- Clearly shows active selection

### Entity Badges
- **Compact**: Max 120px width, truncate long names
- **Visible in GROUP view only** (redundant in entity-specific view)
- **Clickable** (optional): Jump to entity view

### Entity Assignment UX
- **Auto-suggestion banner**: Dismiss after accept/reject
- **Confidence score**: Show % to build trust
- **One-click accept**: Minimize friction
- **Reasons display**: "EIN match: 12-3456789"

---

## 🚧 Known Limitations & Future Enhancements

### Current Limitations
1. **No Supabase client integration** (file-based fallback only)
2. **No entity deletion cascade UI** (backend handles it, but no confirmation)
3. **No intercompany elimination** (only detection/flagging)
4. **No audit log** for entity assignments

### Planned Enhancements (Phase 2)
- [ ] Intercompany elimination toggles
- [ ] Entity ownership graph visualization
- [ ] Bulk entity assignment (assign all docs from one upload)
- [ ] Entity templates (pre-fill common structures)
- [ ] Multi-entity memo generation
- [ ] Entity-level analytics dashboard

---

## 📚 Key Files Reference

```
docs/migrations/
  └── 001_multi_entity_foundation.sql ............. DB schema

src/lib/entities/
  ├── types.ts ...................................... Entity types
  └── entityMatching.ts ............................. Auto-suggestion

src/lib/packs/requirements/
  └── evaluateByEntity.ts ........................... Entity-aware coverage

src/lib/finance/combined/
  └── aggregate.ts .................................. Combined spreads

src/app/api/deals/[dealId]/
  ├── entities/route.ts ............................. Entity CRUD
  ├── entities/[entityId]/route.ts .................. Single entity ops
  ├── packs/items/[jobId]/assign-entity/route.ts .... Assignment
  ├── packs/items/[jobId]/suggest-entity/route.ts ... Auto-suggest
  └── spreads/combined/generate/route.ts ............ Combined spreads

src/components/deals/
  ├── EntitySelector.tsx ............................ Left rail selector
  ├── EntityBadge.tsx ............................... Doc list pills
  └── EntityAssignmentControl.tsx ................... Preview panel control

src/lib/deals/pack/
  └── buildPackIndex.ts ............................. Updated with entity filter
```

---

## 🎓 Example Workflow

### Scenario: Client with 3 businesses

**Setup:**
1. Create entities:
   - Acme HVAC Inc. (OPCO) — EIN: 12-3456789
   - Acme Plumbing LLC (OPCO) — EIN: 98-7654321
   - Newmark Family Trust (PERSON)

**Upload:**
2. Bulk upload 14 PDFs:
   - 4 tax returns (Acme HVAC 2022-2023)
   - 4 tax returns (Acme Plumbing 2022-2023)
   - 2 personal returns (Newmark 2022-2023)
   - 2 PFS documents
   - 2 business financials

**Auto-Assignment:**
3. OCR extracts EINs → Auto-suggests:
   - "Form 1120S with EIN 12-3456789" → Acme HVAC Inc. (100% confidence)
   - "Form 1120S with EIN 98-7654321" → Acme Plumbing LLC (100% confidence)

**Manual Review:**
4. Underwriter reviews suggestions:
   - Accepts all auto-suggestions (one click each)
   - Manually assigns PFS to Newmark Family Trust

**Entity Views:**
5. Switch to "Acme HVAC Inc." view:
   - See only HVAC tax returns + allocated financials
   - Coverage shows: ✅ 2022 + ✅ 2023 business returns

6. Switch to GROUP view:
   - See all 14 docs with entity badges
   - Coverage shows comprehensive requirements across all entities

**Combined Spread:**
7. Generate combined P&L for 2023:
   - Aggregate Acme HVAC + Acme Plumbing
   - Flag: "Intercompany accounts detected in Acme HVAC (due from Acme Plumbing)"
   - Display combined revenue: $2.5M

---

## ✅ Success Criteria

You know it's working when:

1. **Entity Selector** shows GROUP + all business entities
2. **Clicking an entity** filters pack view to that entity's docs only
3. **Entity badges** appear on docs in GROUP view
4. **Auto-suggestion** appears when selecting unassigned doc
5. **Assignment** updates immediately (doc disappears from other entities)
6. **Coverage checklist** shows entity-specific gaps
7. **Combined spread** aggregates multiple entities with flags

---

## 🆘 Troubleshooting

### "No entities showing up"
- Check API: `GET /api/deals/DEAL_ID/entities`
- Verify file created: `.data/entities/DEAL_ID/GROUP_ENTITY_ID.json`
- Check browser console for errors

### "Entity assignment not saving"
- Check API: `POST /api/deals/DEAL_ID/packs/items/JOB_ID/assign-entity`
- Verify job file updated: `/tmp/buddy_ocr_jobs/DEAL_ID/JOB_ID.json`
- Check `entity_id` field added

### "Pack view not filtering"
- Verify `buildPackIndex` receives `entityFilter` option
- Check `jobs` array includes `entity_id` field
- Console log `packJobs` after filtering

### "Auto-suggestion not appearing"
- Check OCR result has `content` or `pages` with text
- Verify `extractEntitySignals` extracts EINs
- Check entities have `ein` field populated

---

## 📞 Support

For questions or issues:
1. Check this guide first
2. Review code comments in key files
3. Test with example workflow above
4. Open GitHub issue with:
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser console logs
   - API response examples

---

**Happy Multi-Entity Underwriting! 🎉**
