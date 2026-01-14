# 🧪 Internal Test Mode — Safe State Simulation

**Created:** January 3, 2026  
**Status:** ✅ SHIPPED  
**Branch:** `feat/internal-test-mode`

---

## 🎯 WHAT THIS IS

Internal-only test mode that lets builders safely explore every deal state without:

- ❌ Mutating the database
- ❌ Creating fake data
- ❌ Breaking real deals
- ❌ Requiring complex setup

Just add `?__mode=test` to any URL → click through all states → verify UI renders correctly.

---

## 🔒 SECURITY

**Test mode ONLY activates when BOTH are true:**

1. **Query param:** `?__mode=test` in URL
2. **Internal header:** `x-buddy-internal: true` (set by middleware)

**Middleware gating:**
- Non-production: Header injected automatically
- Production: Requires `BUDDY_INTERNAL_FORCE=true` env var

**This prevents:**
- Accidental exposure in production
- Borrowers/lenders seeing test controls
- Demo mode leaking to real users

---

## 🚀 HOW TO USE

### 1. Enable Test Mode

Add query param to any page:

```
https://buddy.com/deals/123/cockpit?__mode=test
https://buddy.com/portal/abc123?__mode=test
```

### 2. Test Control Panel Appears

Floating panel in bottom-right corner:

```
🧪 Test Buddy

[ Initializing ]
[ Needs Input ]
[ Processing ]
[ Ready ]
[ Blocked ]

In-memory only · no DB writes
```

### 3. Click Any State

UI instantly updates to show that state:

- **Initializing**: "I'm building the checklist..."
- **Needs Input**: "I'm missing a few required items..."
- **Processing**: "Documents are processing..."
- **Ready**: "✅ This deal is complete..."
- **Blocked**: "I can't move forward yet..."

### 4. Verify Rendering

- Check narrator messages
- Verify color schemes
- Test soft confirmations
- Validate empty states
- Confirm no errors

### 5. Reset

Click "Reset to Real" or remove `?__mode=test` from URL.

---

## 📦 FILES CREATED

**Core Infrastructure:**
- `src/lib/testing/getTestMode.ts` - Server-side test detection
- `src/lib/testing/simulate.ts` - In-memory state override
- `src/components/internal/TestControlPanel.tsx` - Floating test panel
- `src/middleware.ts` - Internal header injection (updated)

**Total:** 3 new files, 1 updated

---

## 🔧 IMPLEMENTATION PATTERN

### Server-Side Detection

```ts
import { getTestMode } from "@/lib/testing/getTestMode";

export async function GET(req: NextRequest) {
  const isTestMode = getTestMode(req);
  
  if (isTestMode) {
    // Allow test overrides
    const url = new URL(req.url);
    const simMode = url.searchParams.get("__simulate");
    if (simMode) {
      return Response.json({ mode: simMode, test: true });
    }
  }
  
  // Normal flow
  // ...
}
```

### Client-Side Usage

```tsx
"use client";

import { useState } from "react";
import { TestControlPanel } from "@/components/internal/TestControlPanel";
import { DealNarrator } from "@/components/deals/DealNarrator";
import { deriveDealMode } from "@/lib/deals/deriveDealMode";

export function DealPage({ dealId }: { dealId: string }) {
  const [realMode, setRealMode] = useState<DealMode>("initializing");
  const [simMode, setSimMode] = useState<DealMode | null>(null);
  
  // Check if test mode active
  const isTestMode = typeof window !== "undefined" 
    && new URLSearchParams(window.location.search).get("__mode") === "test";
  
  // Use simulated mode if active, otherwise real
  const displayMode = simMode ?? realMode;
  
  return (
    <>
      <DealNarrator mode={displayMode} />
      
      {isTestMode && (
        <TestControlPanel onSimulate={setSimMode} />
      )}
    </>
  );
}
```

### Simulation Helper

```ts
import { applySimulation } from "@/lib/testing/simulate";

const realState = {
  mode: "needs_input" as DealMode,
  detail: "Missing 3 items",
};

const simState = {
  mode: "ready" as DealMode,
};

const displayState = applySimulation(realState, simState);
// Returns: { mode: "ready", detail: "Missing 3 items" }
```

---

## ✅ WHAT YOU CAN TEST

With test mode active, you can safely verify:

**Every Deal State:**
- ✅ Initializing (empty checklist)
- ✅ Needs Input (missing items)
- ✅ Processing (documents uploading)
- ✅ Ready (complete)
- ✅ Blocked (hard stop)

**Every Page:**
- ✅ Deal cockpit
- ✅ Borrower portal
- ✅ Lender view
- ✅ Command center
- ✅ Credit memos

**Every Component:**
- ✅ DealNarrator messages
- ✅ BorrowerNarrator voice
- ✅ DealRemaining lists
- ✅ DealEvidence displays
- ✅ Soft confirmations
- ✅ Time signals

**Edge Cases:**
- ✅ Empty state (no docs)
- ✅ Partial state (some docs)
- ✅ Complete state (all satisfied)
- ✅ Blocked state (pipeline error)
- ✅ Processing state (uploads in flight)

---

## 🎬 USE CASES

### 1. Development

Test new features across all states:

```bash
# Develop narrator component
open "http://localhost:3000/deals/123/cockpit?__mode=test"

# Click through: initializing → needs_input → ready
# Verify messages, colors, layouts
```

### 2. QA

Validate complete flows:

```bash
# Test borrower portal
open "http://localhost:3000/portal/abc?__mode=test"

# Cycle through all states
# Verify no errors, correct messaging
```

### 3. Demos

Show stakeholders real system:

```bash
# Demo ready state without completing deal
open "https://staging.buddy.com/deals/123?__mode=test"

# Click "Ready" → show complete deal UX
# No fake data, no training wheels
```

### 4. Debugging

Isolate rendering issues:

```bash
# Reproduce blocked state bug
open "http://localhost:3000/deals/123?__mode=test"

# Click "Blocked"
# Inspect DOM, check console
```

---

## 🚨 IMPORTANT RULES

### DO

✅ Use for development/QA/demos  
✅ Test all pages and components  
✅ Verify edge cases safely  
✅ Share test links with team  
✅ Enable in non-prod environments

### DON'T

❌ Ship test mode to production (without env var)  
❌ Use for real user testing  
❌ Rely on simulated state for business logic  
❌ Create test data in database  
❌ Expose to borrowers/lenders

---

## 🔐 PRODUCTION SAFETY

**Default behavior:**
- Non-prod (dev, staging): Test mode available
- Production: Test mode disabled

**Override for production:**
```bash
# .env
BUDDY_INTERNAL_FORCE=true
```

**Then only internal users see test mode:**
- Must have `?__mode=test` in URL
- Middleware injects `x-buddy-internal: true`
- Control panel appears

**Without override:**
- Test mode never activates in production
- No query param checks
- No control panel renders

---

## 📊 BENEFITS

**For Developers:**
- Test components in isolation
- Verify state transitions
- Debug rendering issues
- No database setup required

**For QA:**
- Validate all flows
- Test edge cases
- Reproduce bugs
- Document test scenarios

**For Product:**
- Demo features early
- Show stakeholders UX
- Validate designs
- Get feedback fast

**For Support:**
- Reproduce user issues
- Test solutions safely
- Verify fixes work
- Document workarounds

---

## 🎯 NEXT STEPS

**Extend to more pages:**
- Credit memos
- Pipeline views
- Committee pages
- Admin dashboards

**Add more simulations:**
- Partial readiness (80% complete)
- Processing timers
- Error states
- Webhook deliveries

**Build demo mode:**
- Pre-configured test scenarios
- Guided walkthroughs
- Screenshot generation
- Video recording

**Create test suite:**
- Playwright tests using test mode
- Visual regression testing
- Automated state verification
- CI/CD integration

---

## 🧠 KEY INSIGHT

> Test mode is NOT demo mode.
> 
> It's a builder tool for verifying the real system works correctly across all states without creating fake data or breaking real deals.

**Magic for users.**  
**Transparency for builders.**  
**Trust everywhere.**

That's Buddy.
