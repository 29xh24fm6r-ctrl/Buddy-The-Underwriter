# Ledger Quick Reference Card

## Schema Truth

```
deal_events (table)     → WRITE ONLY
  ├─ deal_id
  ├─ kind
  └─ payload (jsonb)    ← All data here

audit_ledger (view)     → READ ONLY
  ├─ deal_id
  ├─ kind
  ├─ input_json         ← payload alias
  ├─ output_json
  └─ created_at
```

## Rules

| Action | Use | Never Use |
|--------|-----|-----------|
| Write event | `deal_events.payload` | `deal_events.metadata` ❌ |
| Read events | `audit_ledger` | `deal_events.select()` ❌ |
| Store data | `payload: {...}` | `metadata: {...}` ❌ |

## Code Patterns

### ✅ Write Event
```typescript
import { writeEvent } from "@/lib/ledger/writeEvent";

await writeEvent({
  dealId,
  kind: "my.event",
  actorUserId: userId,
  input: { data: "here" },
  meta: { context: "info" },
});
```

### ✅ Read Events
```typescript
const { data } = await supabaseAdmin()
  .from("audit_ledger")
  .select("*")
  .eq("deal_id", dealId);
```

### ❌ Never Do This
```typescript
// Wrong - metadata doesn't exist
await sb.from("deal_events").insert({
  deal_id: dealId,
  kind: "event",
  metadata: {},  // ❌ TypeScript error + DB error
});

// Wrong - don't read from deal_events directly
await sb.from("deal_events").select("*");  // ❌ Bypasses canonical interface
```

## Guardrails Installed

- 🔒 TypeScript types prevent metadata usage
- 🔒 Warning comments in all helpers
- 🔒 Zero direct deal_events reads
- 🔒 All writes use typed inserts

## Verify

```bash
# No metadata references
rg "metadata" src/lib/ledger/ src/lib/events/

# No direct reads
rg "\.from\(\"deal_events\"\)\.select" src --type ts

# TypeScript clean
npm run build
```

---
**Status:** 🔒 Locked and protected  
**Last update:** 2024-12-29
