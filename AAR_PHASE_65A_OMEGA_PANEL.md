# Phase 65A AAR: Omega Advisory Panel Activation

**Date:** 2026-04-14
**Scope:** Wire Omega advisory panel into cockpit StoryPanel with ai_risk_runs fallback

---

## Step 0: Pre-work Curl Result

**Pulse state view:** Not available. No `OMEGA_MCP_URL` configured in any env file.

**ai_risk_runs fallback (Samaritus deal `ffcc9733`):**

```sql
SELECT id, grade, base_rate_bps, risk_premium_bps, result_json, created_at
FROM ai_risk_runs WHERE deal_id = 'ffcc9733-f866-47fc-83f9-7c08403cea71'
ORDER BY created_at DESC LIMIT 1;
```

**Result:**
- **id:** `29ef31f9-4cfc-4170-835f-00503cfe66e2`
- **grade:** BB+
- **base_rate_bps:** 525
- **risk_premium_bps:** 450
- **created_at:** 2026-03-14T23:02:00.575Z
- **result_json shape:**
  - `grade`: string
  - `factors[]`: `{ label, category, direction, rationale, confidence, contribution }`
  - `baseRateBps`: number
  - `riskPremiumBps`: number
  - `pricingExplain[]`: `{ bps, label, evidence[], rationale }`
- **4 factors:**
  1. Revenue Growth Trend (positive, confidence 0.9)
  2. Debt Service Capacity (negative, confidence 0.7)
  3. Data Transparency (neutral, confidence 0.5)
  4. Profitability (positive, confidence 0.85)

---

## Step 1: Env Var Configuration

**Critical finding:** `invokeOmega.ts` checks `OMEGA_MCP_ENABLED === "1"` but `OmegaAdvisoryAdapter.ts` checked `=== "true"`. These disagreed, meaning even with Pulse configured, the adapter would never reach Pulse calls.

**Fix:** Changed adapter to match `invokeOmega.ts` — both now check `=== "1"`.

**Vercel env vars to set:**
| Variable | Value | Notes |
|---|---|---|
| `OMEGA_MCP_ENABLED` | `1` | Must be `"1"` not `"true"` |
| `OMEGA_MCP_URL` | (Pulse endpoint URL) | Set when Pulse available |
| `OMEGA_MCP_API_KEY` | (Bearer token) | Set when Pulse available |
| `OMEGA_MCP_TIMEOUT_MS` | `8000` | Default is 5000 in invokeOmega |

---

## Step 2: Adapter + Fallback

**Architecture decision:** The Phase 65A guard (`phase65AStateGuard.test.ts:35`) enforces that `OmegaAdvisoryAdapter.ts` contains zero `supabaseAdmin` references. The adapter is a pure Pulse-only client.

**Fallback placement:** The `ai_risk_runs` DB read lives in the **state API route** (`/api/deals/[dealId]/state/route.ts`), which already has supabase access. When the adapter returns `stale: true`, the route reads the latest `ai_risk_runs` row and calls the exported `synthesizeAdvisoryFromRisk()` pure function.

**synthesizeAdvisoryFromRisk output for Samaritus:**
```
advisory: "Risk grade: BB+. Strengths: Revenue Growth Trend, Profitability. Watch: Debt Service Capacity."
confidence: 74  (average of [0.9, 0.7, 0.5, 0.85] × 100)
riskEmphasis: ["Debt Service Capacity"]
stale: false
```

---

## Step 3: Panel Wiring

**Component:** `OmegaAdvisoryPanel` at `src/components/deal/OmegaAdvisoryPanel.tsx`
**Wired into:** `StoryPanel` at `src/components/deals/cockpit/panels/StoryPanel.tsx`
**Position:** Section 0 (top of StoryPanel, above Buddy's Questions)
**Data flow:** `StoryPanel` fetches `/api/deals/${dealId}/state` → extracts `data.omega` → renders `<OmegaAdvisoryPanel omega={omega} />`
**Conditional:** Only renders when omega is non-null (hidden on fetch failure)

---

## Step 4: Type Verification

`OmegaExplanation` exists at `src/core/explanation/types.ts:21-27`:
```ts
export type OmegaExplanation = {
  advisorySummary: string;
  confidence: number;
  signals: string[];
  traceRef?: string;
  stale: boolean;
};
```
No changes needed.

---

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | PASS (clean) |
| Phase 65A guard tests (11) | ALL PASS |
| Omega advisory guard tests (22) | ALL PASS |
| Phase 65A canonical boundary tests (9) | ALL PASS |

---

## Path That Fires

**For Samaritus deal:** `ai_risk_runs` fallback path fires.

1. `getOmegaAdvisoryState()` returns `stale: true` (OMEGA_MCP_ENABLED is not "1" in local env)
2. State route reads `ai_risk_runs` for deal `ffcc9733` → finds BB+ risk run
3. `synthesizeAdvisoryFromRisk()` produces advisory text
4. StoryPanel renders OmegaAdvisoryPanel with blue border (not stale)

**Expected advisory text rendered:**
> Risk grade: BB+. Strengths: Revenue Growth Trend, Profitability. Watch: Debt Service Capacity.

**Risk emphasis badges rendered:**
- "Debt Service Capacity" (red pill badge)

---

## Screenshot

Dev server starts successfully but route compilation hangs due to pre-existing slug conflict (`attachmentId !== documentId`). This is a known issue unrelated to Phase 65A changes. The panel rendering cannot be screenshotted locally without resolving the slug conflict first.

**To verify on Vercel preview:** Deploy this branch and navigate to any deal cockpit → Story tab. The Omega Advisory section should appear at the top.

---

## Files Changed

1. `src/core/omega/OmegaAdvisoryAdapter.ts` — Fixed `"true"` → `"1"` check; exported `synthesizeAdvisoryFromRisk()` + types
2. `src/app/api/deals/[dealId]/state/route.ts` — Added ai_risk_runs fallback when omega is stale
3. `src/components/deals/cockpit/panels/StoryPanel.tsx` — Wired OmegaAdvisoryPanel as Section 0

---

## Deviation Log

| Spec instruction | Deviation | Rationale |
|---|---|---|
| "ai_risk_runs fallback in adapter" | Fallback in state route instead | Guard test enforces adapter has zero DB access. Pure `synthesizeAdvisoryFromRisk()` exported from adapter; DB read in route. |
| "Set OMEGA_MCP_ENABLED=true" | Must be `"1"` | `invokeOmega.ts:22` checks `=== "1"`, not `"true"`. Adapter aligned. |
| "Screenshot of panel" | Not captured | Pre-existing slug conflict prevents local dev server from serving pages. Verified via type check + all 42 guard tests passing. |
