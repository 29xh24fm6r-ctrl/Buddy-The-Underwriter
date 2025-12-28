# aiJson API Migration Guide

## Old API (Deprecated)
```typescript
await aiJson({
  system: "...",
  prompt: "...",  // ❌ WRONG
  schema: {...}   // ❌ WRONG
});
```

## New API (Current)
```typescript
await aiJson({
  scope: "category",
  action: "specific-action",
  system: "...",
  user: "...",    // ✅ CORRECT (was "prompt")
  jsonSchemaHint: JSON.stringify({...})  // ✅ CORRECT (was "schema")
});
```

## Required Changes

### 1. Add `scope` and `action` fields
- **scope**: Category (e.g., "governance", "underwriting", "committee")
- **action**: Specific operation (e.g., "generate-minutes", "counterfactual", "policy-drift")

### 2. Rename `prompt` → `user`
- Old: `prompt: "..."`
- New: `user: "..."`

### 3. Rename `schema` → `jsonSchemaHint` + stringify
- Old: `schema: { type: "object", ... }`
- New: `jsonSchemaHint: JSON.stringify({ type: "object", ... })`

### 4. Handle result properly
```typescript
const result = await aiJson({...});

// Old way:
const data = result.field;  // ❌ WRONG

// New way:
if (!result.ok) {
  // Handle error
  console.error(result.error);
  return;
}

const data = result.result.field;  // ✅ CORRECT
```

## Files to Fix

Remaining files with old API:
1. `src/app/api/deals/[dealId]/decision/[snapshotId]/counterfactual/route.ts`
2. `src/lib/nightly/livingPolicy.ts`
3. `src/lib/reports/generateBoardPack.ts`
4. `src/app/api/deals/[dealId]/memo/section/route.ts`
5. `src/app/api/screens/[id]/route.ts`
6. `src/app/s/[id]/ScreenViewClient.tsx`
7. `src/lib/screens/templates.ts`

## Example Fix

### Before:
```typescript
const result = await aiJson({
  system: "Generate board report",
  prompt: `Generate from: ${data}`,
  schema: {
    type: "object",
    properties: {
      content: { type: "string" }
    }
  }
});

const content = result.content;  // ❌
```

### After:
```typescript
const result = await aiJson({
  scope: "governance",
  action: "generate-board-pack",
  system: "Generate board report",
  user: `Generate from: ${data}`,
  jsonSchemaHint: JSON.stringify({
    type: "object",
    properties: {
      content: { type: "string" }
    }
  })
});

if (!result.ok) {
  throw new Error(`Failed: ${result.error}`);
}

const content = result.result.content;  // ✅
```
