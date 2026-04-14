# Phase 65A — Omega Advisory Integration: Last-Mile Wiring

**Date:** April 14, 2026
**Status:** Spec — ready for implementation

## What this phase closes

The Omega infrastructure is fully built. The telemetry pipeline is live (1,061 events
draining as of today). What's missing is the return leg: Buddy calling Omega for
reasoning and rendering that reasoning in the banker-facing surface.

When complete, a banker opening a deal will see Omega's synthesized intelligence
alongside Buddy's canonical state — risk emphasis, confidence, advisory narrative,
what Omega is watching. Buddy records decisions. Omega does the thinking.

## What already exists — do NOT recreate

```
src/lib/omega/invokeOmega.ts          ✅ MCP transport, kill switch, timeout, ledger
src/lib/omega/readOmegaState.ts       ✅ State view reader
src/lib/omega/readOmegaTraces.ts      ✅ Trace reader
src/lib/omega/evaluateOmegaConfidence.ts ✅ Confidence evaluator
src/lib/omega/mapping.ts              ✅ Typed mapping accessors
src/lib/omega/uri.ts                  ✅ URI builders
src/core/omega/OmegaAdvisoryAdapter.ts ✅ Advisory adapter (calls Omega, never throws)
src/core/omega/formatOmegaAdvisory.ts ✅ Formats advisory for surface
src/core/omega/types.ts               ✅ OmegaAdvisoryState type
src/app/api/deals/[dealId]/state/route.ts ✅ Already imports and calls getOmegaAdvisoryState
```

The state route already returns `omega` and `omegaExplanation` in its response.
The problem is purely: (1) env vars not set, (2) Omega state view not returning
structured data Buddy can render, (3) surface not consuming the omega field.

---

## Pre-work: verify Omega state view response shape

Before writing any code, test what Omega's `underwriting_case` state view actually
returns for the Samaritus deal. Run this curl from the Cloud Workstation (replacing
API_KEY with OMEGA_MCP_API_KEY value from Vercel env vars):

```bash
curl -s -X POST \
  https://pulse-mcp-651478110010.us-central1.run.app/mcp \
  -H "Authorization: Bearer API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "test-1",
    "method": "omega://state/underwriting_case/ffcc9733-f866-47fc-83f9-7c08403cea71",
    "params": {}
  }' | jq .
```

Paste the full response in the AAR. The response shape determines what the adapter
needs to extract. If the method returns 404 or "method not found", then the Pulse
service needs an `underwriting_case` state view handler — document this in the AAR
as a Pulse-side gap and implement the fallback path (Step 2B below).

---

## STEP 1 — Enable Omega in Vercel

Set these env vars in Vercel → buddy-the-underwriter → Settings → Environment Variables:

| Variable | Value | Notes |
|---|---|---|
| `OMEGA_MCP_ENABLED` | `true` | Was `1` or unset — adapter checks `=== "true"` |
| `OMEGA_MCP_KILL_SWITCH` | `false` | Must not be `"true"` |
| `OMEGA_MCP_URL` | `https://pulse-mcp-651478110010.us-central1.run.app/mcp` | Must match PULSE_MCP_URL |
| `OMEGA_MCP_API_KEY` | (same value as PULSE_MCP_API_KEY) | Bearer token for Omega MCP |
| `OMEGA_MCP_TIMEOUT_MS` | `8000` | 8 seconds — adequate for warm Cloud Run instance |

**Note:** Check the current value of `OMEGA_MCP_ENABLED` — the adapter checks
`process.env.OMEGA_MCP_ENABLED === "true"` but the old code checked `=== "1"`.
Verify which check is active in `OmegaAdvisoryAdapter.ts` before setting the value.

After setting env vars, redeploy.

---

## STEP 2 — Harden OmegaAdvisoryAdapter response extraction

`src/core/omega/OmegaAdvisoryAdapter.ts` currently extracts:
- `state.data?.recommendation` → advisory
- `state.data?.signals` → riskEmphasis
- `conf.data?.score` → confidence

These field names must match what the Pulse state view actually returns (verified
in pre-work). Update the extraction to handle the actual response shape.

### 2A — Update field extraction based on pre-work response

Replace the extraction block (around line 58-65) with a robust extractor that
handles multiple possible field names from the Omega response:

```typescript
// Extract advisory text — try multiple field names in order of preference
const advisory =
  state.data?.recommendation ??
  state.data?.advisory ??
  state.data?.summary ??
  state.data?.narrative ??
  "";

// Extract risk signals — normalize to string array
const rawSignals = state.data?.signals ?? state.data?.risk_signals ?? state.data?.emphasis ?? [];
const riskEmphasis: string[] = Array.isArray(rawSignals)
  ? rawSignals.map((s: unknown) =>
      typeof s === "string" ? s : (s as any)?.label ?? (s as any)?.text ?? String(s)
    ).filter(Boolean)
  : [];

// Extract confidence — normalize to 0-100 range
const rawConfidence =
  conf?.data?.score ??
  conf?.data?.confidence ??
  state.data?.confidence ??
  -1;
// Normalize: if value is 0.0-1.0 range, convert to 0-100
const confidence = rawConfidence > 0 && rawConfidence <= 1.0
  ? Math.round(rawConfidence * 100)
  : rawConfidence;
```

### 2B — Fallback if Omega state view is not yet implemented on Pulse side

If the pre-work curl shows the state view method doesn't exist on Pulse, add a
Gemini-powered local fallback inside `OmegaAdvisoryAdapter.ts` so the feature
works immediately while the Pulse-side handler is built:

```typescript
// After the Promise.allSettled block, if !hasData:
if (!hasData) {
  // Local fallback: use existing ai_risk_runs data to synthesize advisory
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();
  const { data: aiRisk } = await (sb as any)
    .from("ai_risk_runs")
    .select("grade, base_rate_bps, risk_premium_bps, result_json, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (aiRisk?.result_json) {
    const factors = (aiRisk.result_json as any).factors ?? [];
    const negatives = factors
      .filter((f: any) => f.direction === "negative")
      .map((f: any) => f.label ?? f.rationale ?? "")
      .filter(Boolean)
      .slice(0, 5);
    const positives = factors
      .filter((f: any) => f.direction === "positive")
      .map((f: any) => f.label ?? "")
      .filter(Boolean)
      .slice(0, 3);

    const grade = aiRisk.grade ?? "?";
    const advisory = positives.length > 0
      ? `Risk grade ${grade}. Key strengths: ${positives.join("; ")}. Watch: ${negatives.join("; ")}.`
      : `Risk grade ${grade}. Key risk factors: ${negatives.join("; ")}.`;

    return {
      confidence: grade === "A" ? 85 : grade === "B" ? 70 : grade === "C" ? 50 : 35,
      advisory,
      riskEmphasis: negatives,
      traceRef: null,
      stale: false,
      staleReason: undefined,
    };
  }
}
```

This fallback reads from `ai_risk_runs` (already populated for Samaritus) so the
surface renders meaningful intelligence even before the Pulse state view handler
is implemented. The fallback is silent — the banker sees the same UI regardless
of which path served the data.

---

## STEP 3 — Surface Omega in the cockpit

The `state` route already returns `omega` and `omegaExplanation`. The cockpit needs
to consume these fields.

### 3A — Find where cockpit state is consumed

Check `src/app/(app)/deals/[dealId]/cockpit/page.tsx` or wherever
`/api/deals/[dealId]/state` is fetched. Look for where `explanation` and
`nextActions` from the state response are rendered. The `omega` field sits
alongside these in the same response.

### 3B — Add OmegaAdvisoryPanel component

Create `src/components/omega/OmegaAdvisoryPanel.tsx`:

```typescript
"use client";

import type { OmegaAdvisoryState } from "@/core/omega/types";
import type { OmegaExplanation } from "@/core/explanation/types";

interface Props {
  omega: OmegaAdvisoryState;
  omegaExplanation: OmegaExplanation;
}

export function OmegaAdvisoryPanel({ omega, omegaExplanation }: Props) {
  // Don't render if stale with no data at all
  if (omega.stale && !omegaExplanation.advisorySummary) return null;

  const confidenceColor =
    omegaExplanation.confidence >= 70 ? "text-emerald-400" :
    omegaExplanation.confidence >= 40 ? "text-amber-400" :
    omegaExplanation.confidence >= 0  ? "text-red-400" :
    "text-white/30";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
            Omega Advisory
          </span>
        </div>
        {omegaExplanation.confidence >= 0 && (
          <span className={`text-xs font-mono ${confidenceColor}`}>
            {omegaExplanation.confidence}% confidence
          </span>
        )}
        {omega.stale && (
          <span className="text-xs text-white/30 italic">stale</span>
        )}
      </div>

      {/* Advisory summary */}
      {omegaExplanation.advisorySummary && (
        <p className="text-sm text-white/70 leading-relaxed">
          {omegaExplanation.advisorySummary}
        </p>
      )}

      {/* Risk signals */}
      {omegaExplanation.signals && omegaExplanation.signals.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-white/30">Watching</p>
          <ul className="space-y-1">
            {omegaExplanation.signals.slice(0, 5).map((signal, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-white/60">
                <span className="mt-1 h-1 w-1 rounded-full bg-amber-400 flex-shrink-0" />
                {signal}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

### 3C — Wire OmegaAdvisoryPanel into StoryPanel or DealHealthPanel

The canonical location is `StoryPanel.tsx` (Phase 57C rule: DealHealthPanel belongs
in StoryPanel, never directly in cockpit/page.tsx). Add the panel below
`DealHealthPanel`:

In `src/components/story/StoryPanel.tsx` (or wherever it lives), add:

```typescript
// Import at top:
import { OmegaAdvisoryPanel } from "@/components/omega/OmegaAdvisoryPanel";

// In the render, after DealHealthPanel, if omega data is available:
{stateData?.omega && stateData?.omegaExplanation && (
  <OmegaAdvisoryPanel
    omega={stateData.omega}
    omegaExplanation={stateData.omegaExplanation}
  />
)}
```

**Important:** `stateData` here refers to whatever the cockpit calls the result
of `GET /api/deals/[dealId]/state`. Check the actual variable name in the file
before wiring.

---

## STEP 4 — Verify OmegaExplanation type exists

The `formatOmegaAdvisory.ts` returns `OmegaExplanation`. Check that this type
is exported from `@/core/explanation/types`. If not, add it:

```typescript
// src/core/explanation/types.ts — add if missing:
export type OmegaExplanation = {
  advisorySummary: string;
  confidence: number;
  signals: string[];
  traceRef?: string;
  stale: boolean;
};
```

---

## Acceptance Criteria

### Step 1 — Env vars
- [ ] `OMEGA_MCP_ENABLED` set to `"true"` in Vercel production
- [ ] `OMEGA_MCP_URL` set and matches `PULSE_MCP_URL`
- [ ] `OMEGA_MCP_API_KEY` set
- [ ] Redeployed and READY

### Step 2 — Adapter
- [ ] Pre-work curl result pasted in AAR with exact response shape
- [ ] Field extraction updated to match actual Pulse response keys
- [ ] Local fallback implemented (reads `ai_risk_runs` for deals without Pulse state)
- [ ] `getOmegaAdvisoryState("ffcc9733-...")` returns `stale: false` and non-empty `advisory`
- [ ] `tsc --noEmit` clean

### Step 3 — Surface
- [ ] `OmegaAdvisoryPanel.tsx` created
- [ ] Panel renders in StoryPanel when `omega.stale === false`
- [ ] Panel renders "Advisory intelligence currently unavailable" when `omega.stale === true`
- [ ] Panel does NOT render empty (no blank white box)
- [ ] Samaritus deal (`ffcc9733`) cockpit shows Omega advisory panel in browser

### Step 4 — Type
- [ ] `OmegaExplanation` type exists and exports cleanly
- [ ] `tsc --noEmit` clean across all files

---

## AAR format

1. Pre-work curl result (full JSON response from Omega state view)
2. `OMEGA_MCP_ENABLED` old value and new value
3. Which path fired on Samaritus: Omega state view (live) or local fallback (`ai_risk_runs`)
4. Screenshot of OmegaAdvisoryPanel rendered in Samaritus cockpit
5. `advisory` text that rendered
6. `confidence` value that rendered
7. `riskEmphasis` signals that rendered
8. `tsc --noEmit` result
9. Deviations from spec with rationale

---

## Build rules added this phase

- `OMEGA_MCP_ENABLED` must be `"true"` (string, not `"1"`) — `OmegaAdvisoryAdapter` checks strict equality
- Omega advisory is always rendered below `DealHealthPanel` in `StoryPanel` — never in `cockpit/page.tsx` directly
- `OmegaAdvisoryPanel` never renders blank — if stale with no data, return null
- The local fallback (`ai_risk_runs`) is a bridge, not a permanent substitute — the Pulse state view handler is the target
- Omega confidence is always 0-100 range on the surface — normalize at adapter layer, never at render layer
