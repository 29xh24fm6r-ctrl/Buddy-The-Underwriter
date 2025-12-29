# Canonical Ledger Quick Reference

## Event Emission Pattern

```typescript
import { writeEvent } from "@/lib/ledger/writeEvent";

await writeEvent({
  dealId: "uuid",
  kind: "checklist.seeded",
  actorUserId: userId,
  input: { preset: "SBA_7A", count: 12 },
  meta: { extra: "context" },
});
```

## Route Error Handling Pattern

```typescript
export async function POST(req, ctx) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    
    const { dealId } = await ctx.params;
    
    // ... business logic ...
    
    await writeEvent({ dealId, kind: "...", actorUserId: userId, input: {...}, meta: {...} });
    
    return NextResponse.json({ ok: true, event_emitted: true });
  } catch (error: any) {
    console.error("[route-name]", error);
    return NextResponse.json({ ok: false, error: "User-friendly message" });
  }
}
```

## Event Kinds

| Kind | Route | Input Fields |
|------|-------|--------------|
| `checklist.seeded` | `/checklist/seed` | `{preset, checklist_keys, count_inserted}` |
| `checklist.item.upserted` | `/checklist/upsert` | `{checklistKey, title, required}` |
| `checklist.status.set` | `/checklist/set-status` | `{checklistKey, status}` |
| `underwrite.started` | `/underwrite/start` | `{checklist_complete, required_items}` |
| `intake.updated` | `/intake/set` | `{loanType, borrowerName, autoSeed}` |

## UI Components

**EventsFeed.tsx:**
```tsx
import { EventsFeed } from "./EventsFeed";

<EventsFeed dealId={dealId} />
```

**ChecklistPanel.tsx:**
```tsx
import { ChecklistPanel } from "./ChecklistPanel";

<ChecklistPanel dealId={dealId} />
```

## Testing Commands

```bash
# Test event emission
curl -X POST http://localhost:3000/api/deals/{dealId}/checklist/seed \
  -H "Content-Type: application/json" \
  -d '{"preset": "SBA_7A"}'

# Fetch events
curl http://localhost:3000/api/deals/{dealId}/events?limit=10

# Fetch checklist
curl http://localhost:3000/api/deals/{dealId}/checklist
```

## Error Response Format

**Success:**
```json
{
  "ok": true,
  "event_emitted": true,
  "...data"
}
```

**Error (DB/Logic):**
```json
{
  "ok": false,
  "error": "Failed to seed checklist"
}
```

**Unauthorized:**
```json
{
  "ok": false,
  "error": "Unauthorized"
}
```
Status: 401

## File Locations

- **Helpers:** `src/lib/ledger/writeEvent.ts`, `src/lib/ledger/present.ts`
- **Routes:** `src/app/api/deals/[dealId]/checklist/*`, `src/app/api/deals/[dealId]/underwrite/start`, `src/app/api/deals/[dealId]/intake/set`
- **UI:** `src/app/(app)/deals/[dealId]/command/EventsFeed.tsx`, `ChecklistPanel.tsx`, `ActionRail.tsx`
- **Types:** `src/types/db.d.ts` (AuditLedgerRow)
