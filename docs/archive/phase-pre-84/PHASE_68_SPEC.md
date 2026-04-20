# Phase 68 — Surface Wiring Remediation
## Banker Decision Workflow: Demo Data Elimination + Omega Annotation

**Date:** April 2026  
**Status:** Spec — ready for implementation

---

## What the audit got right vs what the code review corrected

The external audit claimed "4 wired out of 32 surfaces." After reading the live
codebase, the actual state is:

| Surface | Audit said | Reality |
|---|---|---|
| Cockpit panels | not wired | WIRED — Phase 67, CockpitStateProvider |
| Underwrite | not wired | WIRED — Phase 57B, AnalystWorkbench |
| Committee | demo data | PARTIALLY WIRED — lifecycle guard OK, main content via StitchSurface (risk) |
| Pricing memo | not wired | WIRED — real snapshot/quote/PDF pipeline |

The state API is already complete. Do not rebuild it.

---

## What already exists — do not touch these files

```
src/app/api/deals/[dealId]/state/route.ts        ← returns state+omega+explanation+nextActions
src/core/state/BuddyCanonicalStateAdapter.ts     ← getBuddyCanonicalState()
src/core/state/types.ts                          ← BuddyCanonicalState type
src/core/omega/OmegaAdvisoryAdapter.ts           ← getOmegaAdvisoryState()
src/core/omega/types.ts                          ← OmegaAdvisoryState type
src/core/omega/formatOmegaAdvisory.ts            ← formatOmegaAdvisory()
src/core/actions/deriveNextActions.ts            ← deriveNextActions()
src/core/explanation/deriveBuddyExplanation.ts   ← deriveBuddyExplanation()
```

State API response shape (already live):
```typescript
{
  ok: true,
  state: BuddyCanonicalState,
  omega: OmegaAdvisoryState,
  explanation: { summary: string; blockerText?: string },
  omegaExplanation: { advisory: string } | null,
  nextActions: SystemAction[],
  primaryAction: SystemAction,
}
```

---

## Architecture Rule — Non-Negotiable

```
Buddy canonical state  →  source of truth (BuddyCanonicalState)
Omega advisory state   →  annotation only (OmegaAdvisoryState)
```

- Omega NEVER sets deal stage
- Omega NEVER decides approve/decline
- Omega NEVER mutates canonical state
- These are OCC SR 11-7 compliance boundaries, not preferences

---

## Step 0 — Pre-work (run before writing any code)

**1. Verify Pulse is flowing:**
```sql
SELECT event_code, created_at
FROM deal_pipeline_ledger
WHERE deal_id = 'ffcc9733-f866-47fc-83f9-7c08403cea71'
ORDER BY created_at DESC LIMIT 10;
```

**2. Find demo data strings:**
```bash
grep -r "Highland Capital\|Project Atlas\|Titan Equities" src/ \
  --include="*.tsx" --include="*.ts" -l
```

Log both results in the AAR. If demo strings are found outside the files being
replaced in this phase, flag them — do not silently remove without noting them.

---

## Step 1 — Create `OmegaAdvisoryBadge` component

**File:** `src/components/deals/shared/OmegaAdvisoryBadge.tsx`

Purely presentational. No writes. Reads `OmegaAdvisoryState` from props.

```typescript
"use client";

import type { OmegaAdvisoryState } from "@/core/omega/types";

interface Props {
  omega: OmegaAdvisoryState;
  compact?: boolean; // true = badge only, false = badge + advisory text + signals
}

export function OmegaAdvisoryBadge({ omega, compact = false }: Props) {
  if (omega.stale) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2.5 py-1 text-xs text-gray-500">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        Advisory unavailable
        {omega.staleReason && <span className="text-gray-400">· {omega.staleReason}</span>}
      </div>
    );
  }

  const score = omega.confidence; // 0–100, -1 = unavailable
  if (score < 0) return null;

  const colorClass =
    score >= 80 ? "bg-green-100 text-green-800 border-green-200"
    : score >= 60 ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-red-100 text-red-800 border-red-200";

  const dotClass =
    score >= 80 ? "bg-green-500"
    : score >= 60 ? "bg-amber-500"
    : "bg-red-500";

  return (
    <div className="space-y-2">
      <div className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${colorClass}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        Omega {score}
        <span className="font-normal opacity-70">confidence</span>
      </div>
      {!compact && omega.advisory && (
        <p className="text-xs leading-relaxed text-gray-600">{omega.advisory}</p>
      )}
      {!compact && omega.riskEmphasis.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {omega.riskEmphasis.map((s, i) => (
            <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Required tests** (`src/components/deals/shared/__tests__/OmegaAdvisoryBadge.test.tsx`):
- Renders stale state (no score shown, "Advisory unavailable")
- Renders green badge for score >= 80
- Renders amber badge for 60–79
- Renders red badge for < 60
- compact=true hides advisory and signals

---

## Step 2 — Create `CanonicalStateBanner` component

**File:** `src/components/deals/shared/CanonicalStateBanner.tsx`

Displays `primaryAction` from state API. Purely presentational.

```typescript
"use client";

import Link from "next/link";
import type { SystemAction } from "@/core/state/types";

interface Props {
  action: SystemAction;
  variant?: "strip" | "card";
}

export function CanonicalStateBanner({ action, variant = "strip" }: Props) {
  const isBlocked = action.intent === "blocked";
  const isComplete = action.intent === "complete";

  const colorClass = isBlocked
    ? "bg-amber-50 border-amber-200 text-amber-900"
    : isComplete
    ? "bg-green-50 border-green-200 text-green-900"
    : "bg-blue-50 border-blue-200 text-blue-900";

  const base = variant === "card"
    ? `rounded-xl border p-4 ${colorClass}`
    : `rounded-lg border px-4 py-2.5 ${colorClass}`;

  return (
    <div className={`flex items-center justify-between gap-4 ${base}`}>
      <div>
        <p className="text-sm font-medium">{action.label}</p>
        {action.description && (
          <p className="mt-0.5 text-xs opacity-75">{action.description}</p>
        )}
      </div>
      {action.href && !isBlocked && (
        <Link
          href={action.href}
          className="shrink-0 rounded-md bg-white/80 px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-white"
        >
          Go →
        </Link>
      )}
    </div>
  );
}
```
