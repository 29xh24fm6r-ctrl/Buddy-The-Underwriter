# Deal Command Center — Quick Reference

## Routes

| Route | Component | Type | Description |
|-------|-----------|------|-------------|
| `/deals/:id` | Command Center | Overview | Landing page with priorities + snapshot |
| `/deals/:id/underwriting` | Underwriting | Stitch | Workspace embed (bounded) |
| `/deals/:id/documents` | Documents | Stub | Request list (ready for integration) |
| `/deals/:id/risk` | Risk & Pricing | Stub | B+ grade + SOFR+650 + covenants |
| `/deals/:id/memo` | Credit Memo | Stitch | Memo UI embed |
| `/deals/:id/audit` | Audit | Stub | Event ledger (ready for integration) |

## Stitch Export Slug Candidates

### Underwriting page tries (in order):
1. `deal-detail-workspace` ❌ (not found)
2. `underwriter-workspace` ❌ (not found)
3. `command-center-latest` ✅ (found)
4. `deals` ❌ (not found)

**→ Will load `command-center-latest`**

### Memo page tries (in order):
1. `memo` ❌ (not found)
2. `credit-memo` ❌ (not found)
3. `deal-memo` ❌ (not found)
4. `command-center-latest` ✅ (found)

**→ Will load `command-center-latest`**

## Available Stitch Exports

Found in `stitch_exports/`:
- ✅ `command-center-latest` (will be used as fallback)
- `deals-command-bridge`
- `deals-pipeline-command-center`
- `credit-memo-pdf-template`
- `deal-intake-console`
- `deal-output-credit-memo-spreads`
- `deal-summary`
- And 20+ more...

## Post-Merge TODOs

### High Priority
1. **Map exact Stitch slugs** — Update slug candidates once designs finalized:
   - Create dedicated underwriting workspace export
   - Create dedicated memo workspace export
   - Update `underwriting/page.tsx` and `memo/page.tsx` with correct slugs

2. **Wire real deal fetch** — In `DealShellLayout`:
   ```tsx
   // Replace mock:
   const sb = supabaseAdmin();
   const bankId = await getCurrentBankId();
   const { data: deal } = await sb
     .from('deals')
     .select('*')
     .eq('id', dealId)
     .eq('bank_id', bankId)
     .single();
   ```

3. **Connect action buttons** — In `DealHeroBar`:
   - "Request docs" → `POST /api/deals/:id/actions` (action: request-docs)
   - "Generate memo" → `POST /api/deals/:id/memo/generate`
   - "Approve" → `POST /api/deals/:id/actions` (action: approve)

### Medium Priority
4. **Documents integration** — Wire `documents/page.tsx` to upload system
5. **Risk model integration** — Wire `risk/page.tsx` to real risk-based pricing
6. **Audit ledger** — Connect `audit/page.tsx` to compliance system

### Low Priority
7. **Mobile optimization** — Test left rail collapse behavior
8. **Loading states** — Add Suspense boundaries for Stitch frames
9. **Error boundaries** — Graceful degradation for missing exports

## Testing Commands

```bash
# Start dev server
npm run dev

# Visit routes
open http://localhost:3000/deals
# Click any deal → should land on /deals/:id
# Click "Underwriting" in left rail → should load Stitch workspace

# Check TypeScript
npx tsc --noEmit

# Production build
npm run build
```

## Debug Mode

Add `?stitchDebug=1` to any route with StitchFrame to see debug overlay:
```
/deals/123/underwriting?stitchDebug=1
/deals/123/memo?stitchDebug=1
```

Shows:
- Title detection
- bodyHtml length
- srcDoc HTML escaping health
- Full srcDoc preview

## Architecture

**Route Group Pattern:**
```
/deals/[dealId]/(shell)/layout.tsx   ← Applies hero + rail to all subroutes
/deals/[dealId]/(shell)/page.tsx
/deals/[dealId]/(shell)/underwriting/page.tsx
/deals/[dealId]/(shell)/memo/page.tsx
/deals/[dealId]/(shell)/documents/page.tsx
/deals/[dealId]/(shell)/risk/page.tsx
/deals/[dealId]/(shell)/audit/page.tsx
```

**Component Hierarchy:**
```
DealShellLayout (server)
├── DealHeroBar (client)
│   ├── Back to Deals
│   ├── Deal info + status
│   └── Action buttons
├── DealLeftRail (client)
│   └── DEAL_NAV navigation items
└── Main content (children)
    └── StitchFrame (for workspace pages)
        └── iframe with postMessage bridge
```

**Navigation Config (Single Source of Truth):**
```typescript
// src/app/deals/[dealId]/_components/dealNav.ts
export const DEAL_NAV: DealNavItem[] = [
  { key: "overview", label: "Overview", href: (id) => `/deals/${id}`, icon: "dashboard" },
  { key: "underwriting", label: "Underwriting", href: (id) => `/deals/${id}/underwriting`, icon: "fact_check" },
  { key: "documents", label: "Documents", href: (id) => `/deals/${id}/documents`, icon: "folder_open" },
  { key: "risk", label: "Risk & Pricing", href: (id) => `/deals/${id}/risk`, icon: "bar_chart" },
  { key: "memo", label: "Credit Memo", href: (id) => `/deals/${id}/memo`, icon: "description" },
  { key: "audit", label: "Audit", href: (id) => `/deals/${id}/audit`, icon: "policy" },
];
```

## Files Modified

```
✅ Created src/app/deals/[dealId]/_components/dealNav.ts
✅ Created src/app/deals/[dealId]/_components/DealHeroBar.tsx
✅ Created src/app/deals/[dealId]/_components/DealLeftRail.tsx
✅ Created src/app/deals/[dealId]/(shell)/layout.tsx
✅ Created src/app/deals/[dealId]/(shell)/page.tsx
✅ Created src/app/deals/[dealId]/(shell)/underwriting/page.tsx
✅ Created src/app/deals/[dealId]/(shell)/memo/page.tsx
✅ Created src/app/deals/[dealId]/(shell)/documents/page.tsx
✅ Created src/app/deals/[dealId]/(shell)/risk/page.tsx
✅ Created src/app/deals/[dealId]/(shell)/audit/page.tsx
✅ Created src/components/stitch/getStitchExport.ts
✅ Created DEAL_COMMAND_CENTER_COMPLETE.md
```

Total: 12 new files

## Commit Message

```
Deal Command Center: hero bar + unified left rail + bounded Stitch workspaces + risk stub

✅ Complete implementation of Deal Command Center release bundle
```

---

**Status: ✅ SHIP READY**

All 5 release targets complete. Mocked data OK per spec. Stitch fallback working (`command-center-latest` found).
