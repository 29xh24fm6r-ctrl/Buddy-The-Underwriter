# Phase 79 — God Tier Closure
## Implementation Spec

**Status:** Ready for implementation
**Priority:** Critical — closes all remaining God Tier system items
**Authored:** 2026-04-15
**Scope:** 5 file changes + 2 new files + env vars

---

## Codebase Facts (verified before authoring)

**Model Engine V2:** Already enforced. `modeSelector.ts:34` — `if (!ctx?.isOpsOverride) return { mode: "v2_primary", reason: "enforced" }`. No code needed. Roadmap update only.

**Omega advisory:** `src/lib/omega/invokeOmega.ts` is complete — kill switch, MCP transport, ledger, timeout. Reads `OMEGA_MCP_ENABLED` from env. Not set in Vercel → all calls silently return `{ ok: false, error: "disabled" }`. `redaction.server.ts` exports `redactPayload(profileName, payload)` but does NOT export `redactForOmega`. `underwrite/state/route.ts` already calls `buildTrustLayer` — that is the insertion point.

**Spread completeness:** No measurement exists. `pipeline-state/route.ts` shows only `N spreads ready`. The recompute route (`spreads/recompute/route.ts`) is async — it enqueues a job and returns immediately; the actual computation runs via `deal_spread_jobs`. Correctapproach: compute completeness on-demand from `deal_financial_facts` (pure read, no persistence required).

**Voice auto-complete:** `dispatch/route.ts` resolves gaps and writes events but has no completeness check or memo trigger. `bankId` comes from request body (not `ensureDealBankAccess`). The route responds before the auto-complete check should fire — use fire-and-forget.

**Research quality route:** Does not exist. `buddy_research_quality_gates` and `buddy_research_evidence` tables exist with data from Phase 78. The evidence query must use two sequential reads (Supabase client does not support subquery syntax for `.eq()`).

---

## Implementation Order

1. **Part A** — Vercel env vars (no code, do first)
2. **Part B** — New file: `src/lib/classicSpread/computeSpreadCompleteness.ts`
3. **Part C** — New file: `src/app/api/deals/[dealId]/research/quality/route.ts`
4. **Part D** — Add `redactForOmega` to `src/lib/omega/redaction.server.ts`
5. **Part E** — Update `src/app/api/deals/[dealId]/underwrite/state/route.ts`
6. **Part F** — Update `src/app/api/deals/[dealId]/underwrite/pipeline-state/route.ts`
7. **Part G** — Update `src/app/api/deals/[dealId]/banker-session/dispatch/route.ts`

---

## Part A — Vercel Environment Variables

Set in Vercel → Settings → Environment Variables for **Production** and **Preview**:

| Variable | Value |
|----------|-------|
| `OMEGA_MCP_ENABLED` | `1` |
| `OMEGA_MCP_URL` | `https://pulse-mcp-651478110010.us-central1.run.app` |
| `OMEGA_MCP_API_KEY` | `<value of BUDDY_INGEST_TOKEN>` |
| `OMEGA_MCP_TIMEOUT_MS` | `4000` |

No code changes. After setting, `invokeOmega` routes to Pulse and ledgers every call.

---

## Part B — New File: `src/lib/classicSpread/computeSpreadCompleteness.ts`

**Complete file contents:**

```typescript
/**
 * Spread Completeness Score
 *
 * Computes what percentage of 12 critical financial fact keys are populated
 * in deal_financial_facts for a deal (any period, any non-null value).
 *
 * Used by:
 *   - God Tier #66: pipeline Step 1 completeness badge
 *   - God Tier #67: voice dispatch auto-complete trigger
 *
 * Pure read — never writes. Never throws — returns null on error.
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The 12 critical keys. Presence of any non-null value for ANY period
 * counts as populated. Fallback chains handle extraction key variants.
 */
export const CRITICAL_SPREAD_KEYS = [
  // Income Statement
  "GROSS_RECEIPTS",       // Revenue (fallback: TOTAL_REVENUE, TOTAL_INCOME)
  "NET_INCOME",           // Bottom line (fallback: ORDINARY_BUSINESS_INCOME)
  "DEPRECIATION",         // D&A add-back
  "INTEREST_EXPENSE",     // Coverage ratios
  "COST_OF_GOODS_SOLD",   // Gross margin

  // Balance Sheet
  "SL_TOTAL_ASSETS",      // Anchor
  "SL_CASH",              // Liquidity
  "SL_AR_GROSS",          // Receivables

  // Structural / Derived (written by spread engine after computation)
  "ADS",                  // Annual Debt Service (fallback: ANNUAL_DEBT_SERVICE, ANNUAL_DEBT_SERVICE_PROPOSED)
  "DSCR",                 // Coverage ratio (fallback: GCF_DSCR)
  "EBITDA",               // Derived
  "NET_WORTH",            // Equity anchor (fallback: SL_TOTAL_EQUITY, SL_RETAINED_EARNINGS)
] as const;

// Fallback chains — checked if primary key is absent
const FALLBACKS: Record<string, string[]> = {
  GROSS_RECEIPTS:  ["TOTAL_REVENUE", "TOTAL_INCOME"],
  NET_INCOME:      ["ORDINARY_BUSINESS_INCOME"],
  ADS:             ["ANNUAL_DEBT_SERVICE", "ANNUAL_DEBT_SERVICE_PROPOSED"],
  DSCR:            ["GCF_DSCR"],
  NET_WORTH:       ["SL_TOTAL_EQUITY", "SL_RETAINED_EARNINGS"],
};

export type SpreadCompletenessResult = {
  /** 0–100 rounded integer */
  score: number;
  populated: number;
  total: number;
  /** Primary key names that are absent (with all fallbacks also absent) */
  missing: string[];
  /** true when score >= 80 — God Tier threshold */
  isGodTier: boolean;
};

/**
 * Compute spread completeness for a deal.
 * Returns null on DB error (non-fatal).
 */
export async function computeSpreadCompleteness(
  dealId: string,
): Promise<SpreadCompletenessResult | null> {
  try {
    const sb = supabaseAdmin();

    // Build the full set of keys to check (primary + all fallbacks)
    const allKeys = [...new Set(
      CRITICAL_SPREAD_KEYS.flatMap((k) => [k, ...(FALLBACKS[k] ?? [])]),
    )];

    const { data: facts, error } = await sb
      .from("deal_financial_facts")
      .select("fact_key")
      .eq("deal_id", dealId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected")
      .not("fact_value_num", "is", null)
      .in("fact_key", allKeys);

    if (error) {
      console.error("[computeSpreadCompleteness] query failed:", error.message);
      return null;
    }

    const present = new Set((facts ?? []).map((f) => f.fact_key));

    const missing: string[] = [];
    let populated = 0;

    for (const key of CRITICAL_SPREAD_KEYS) {
      const toCheck = [key, ...(FALLBACKS[key] ?? [])];
      if (toCheck.some((k) => present.has(k))) {
        populated++;
      } else {
        missing.push(key);
      }
    }

    const total = CRITICAL_SPREAD_KEYS.length;
    const score = Math.round((populated / total) * 100);

    return { score, populated, total, missing, isGodTier: score >= 80 };
  } catch (err) {
    console.error("[computeSpreadCompleteness] exception:", err);
    return null;
  }
}
```

---

## Part C — New File: `src/app/api/deals/[dealId]/research/quality/route.ts`

Create the directory `src/app/api/deals/[dealId]/research/quality/` and add:

**Complete file contents:**

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const maxDuration = 10;

type Params = Promise<{ dealId: string }>;

/**
 * GET /api/deals/[dealId]/research/quality
 *
 * Returns the latest BIE trust gate result and evidence summary for a deal.
 * No AI calls. Pure read from buddy_research_quality_gates + buddy_research_evidence.
 * Used by the AnalystWorkbench for the research quality panel.
 */
export async function GET(_req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();

    // 1. Latest quality gate for this deal
    const { data: gate } = await sb
      .from("buddy_research_quality_gates")
      .select("*")
      .eq("deal_id", dealId)
      .order("evaluated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 2. Latest mission_id for this deal (needed to join evidence)
    const { data: mission } = await sb
      .from("buddy_research_missions")
      .select("id")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 3. Evidence claims for that mission (if any)
    let evidence: Array<{
      thread_origin: string | null;
      claim_layer: string | null;
      confidence: number | null;
    }> = [];

    if (mission?.id) {
      const { data: ev } = await sb
        .from("buddy_research_evidence")
        .select("thread_origin, claim_layer, confidence")
        .eq("mission_id", mission.id);
      evidence = ev ?? [];
    }

    // Aggregate evidence counts by thread
    type ThreadCount = { total: number; fact: number; inference: number; narrative: number };
    const byThread: Record<string, ThreadCount> = {};

    for (const row of evidence) {
      const t = row.thread_origin ?? "unknown";
      if (!byThread[t]) byThread[t] = { total: 0, fact: 0, inference: 0, narrative: 0 };
      byThread[t].total++;
      if (row.claim_layer === "fact")      byThread[t].fact++;
      if (row.claim_layer === "inference") byThread[t].inference++;
      if (row.claim_layer === "narrative") byThread[t].narrative++;
    }

    return NextResponse.json({
      ok: true,
      gate: gate
        ? {
            trust_grade:                  gate.trust_grade,
            gate_passed:                  gate.gate_passed,
            quality_score:                gate.quality_score,
            evaluated_at:                 gate.evaluated_at,
            entity_lock_check:            gate.entity_lock_check,
            entity_confidence:            gate.entity_confidence,
            thread_coverage_check:        gate.thread_coverage_check,
            threads_succeeded:            gate.threads_succeeded,
            threads_failed:               gate.threads_failed,
            source_diversity_check:       gate.source_diversity_check,
            source_count:                 gate.source_count,
            management_validation_check:  gate.management_validation_check,
            principals_confirmed:         gate.principals_confirmed,
            principals_unconfirmed:       gate.principals_unconfirmed,
            synthesis_check:              gate.synthesis_check,
            contradictions_found:         gate.contradictions_found,
            underwriting_questions_found: gate.underwriting_questions_found,
            gate_failures:                gate.gate_failures ?? [],
            thread_results:               gate.thread_results ?? {},
          }
        : null,
      evidence_summary: {
        total_claims: evidence.length,
        by_thread: byThread,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unexpected_error" },
      { status: 500 },
    );
  }
}
```

---

## Part D — Add `redactForOmega` to `src/lib/omega/redaction.server.ts`

### Exact insertion point

Find this line near the bottom of the file:
```typescript
  return result;
}
```
(the closing brace of `applyRedaction`)

After that closing brace, append the following **before the end of the file**:

```typescript

// ---------------------------------------------------------------------------
// Omega advisory payload builder (deny-by-default, aggregate only)
// ---------------------------------------------------------------------------

/**
 * Build a safe advisory payload for Omega.
 *
 * Strips all raw financial values, document content, and PII.
 * Sends only aggregate trust-layer scores and lifecycle metadata.
 * This is the ONLY function that should construct Omega advisory payloads.
 */
export function redactForOmega(input: {
  dealId: string;
  bankId: string | null;
  lifecycleStage?: string | null;
  trustLayer?: {
    memo?: { status: string; staleReasons?: string[] };
    packet?: { status: string; blockers?: string[]; warnings?: string[] };
    financialValidation?: { memoSafe: boolean; decisionSafe: boolean; blockers?: string[]; warnings?: string[] };
  } | null;
}): Record<string, unknown> {
  return {
    deal_id:          hashId(input.dealId),       // hashed — never raw UUID to Omega
    bank_id:          input.bankId ? hashId(input.bankId) : null,
    lifecycle_stage:  input.lifecycleStage ?? null,
    trust_summary:    input.trustLayer
      ? {
          memo_status:         input.trustLayer.memo?.status ?? null,
          memo_stale_reasons:  input.trustLayer.memo?.staleReasons?.length ?? 0,
          packet_status:       input.trustLayer.packet?.status ?? null,
          packet_blockers:     input.trustLayer.packet?.blockers?.length ?? 0,
          financial_memo_safe: input.trustLayer.financialValidation?.memoSafe ?? null,
          financial_decision_safe: input.trustLayer.financialValidation?.decisionSafe ?? null,
          financial_blockers:  input.trustLayer.financialValidation?.blockers?.length ?? 0,
        }
      : null,
  };
}
```

---

## Part E — Update `src/app/api/deals/[dealId]/underwrite/state/route.ts`

### Change 1: Add import at top (after existing imports)

Find this existing import block:
```typescript
import { buildTrustLayer } from "@/lib/underwrite/buildTrustLayer";
import { reconcileDeal } from "@/lib/reconciliation/dealReconciliator";
```

No change to imports — Omega is dynamically imported inside the route to keep it non-fatal.

### Change 2: Insert Omega advisory block after trust layer

Find this existing block:
```typescript
    // Trust layer — composed from canonical memo/packet/financial validation sources
    let trustLayer = null;
    try {
      trustLayer = await buildTrustLayer(dealId);
    } catch (err) {
      console.warn("[underwrite/state] trust layer failed — degrading safely:", err);
    }
```

**Replace it with:**

```typescript
    // Trust layer — composed from canonical memo/packet/financial validation sources
    let trustLayer = null;
    try {
      trustLayer = await buildTrustLayer(dealId);
    } catch (err) {
      console.warn("[underwrite/state] trust layer failed — degrading safely:", err);
    }

    // Omega advisory annotation — annotates trust layer, NEVER mutates canonical state
    // OCC SR 11-7: Omega is advisory only. It never writes facts, lifecycle, or grade.
    let omegaAdvisory: {
      confidence: number;
      risk_emphasis: string[];
      recommended_focus: string | null;
      advisory_grade: string | null;
    } | null = null;

    try {
      const { invokeOmega } = await import("@/lib/omega/invokeOmega");
      const { redactForOmega } = await import("@/lib/omega/redaction.server");

      const payload = redactForOmega({
        dealId,
        bankId: deal.bank_id,
        lifecycleStage: deal.stage,
        trustLayer: trustLayer as any,
      });

      const omegaResult = await invokeOmega<{
        confidence: number;
        risk_emphasis: string[];
        recommended_focus: string | null;
        advisory_grade: string | null;
      }>({
        resource: "omega://advisory/deal-focus",
        correlationId: `state:${dealId}:${Date.now()}`,
        payload,
        timeoutMs: 3500,
      });

      if (omegaResult.ok) {
        omegaAdvisory = omegaResult.data;
      }
    } catch {
      // Omega is non-fatal — never blocks the state route
    }
```

### Change 3: Add `omegaAdvisory` to the return JSON

Find the return statement:
```typescript
    return NextResponse.json({
      ok: true,
      deal: {
```

**Replace with:**

```typescript
    return NextResponse.json({
      ok: true,
      omegaAdvisory,          // null when Omega is disabled or unavailable
      deal: {
```

---

## Part F — Update `src/app/api/deals/[dealId]/underwrite/pipeline-state/route.ts`

### Change 1: Add completeness query to the parallel block

Find this in the `Promise.all` array (the last query before the closing `]`):

```typescript
      // 7. Phase 78: Research quality gate
      sb.from("buddy_research_quality_gates")
        .select("trust_grade, quality_score")
        .eq("deal_id", dealId)
        .order("evaluated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
```

**Replace with:**

```typescript
      // 7. Phase 78: Research quality gate
      sb.from("buddy_research_quality_gates")
        .select("trust_grade, quality_score")
        .eq("deal_id", dealId)
        .order("evaluated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 8. Phase 79: Spread completeness score
      sb.from("deal_financial_facts")
        .select("fact_key")
        .eq("deal_id", dealId)
        .eq("is_superseded", false)
        .neq("resolution_status", "rejected")
        .not("fact_value_num", "is", null)
        .in("fact_key", [
          "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME",
          "NET_INCOME", "ORDINARY_BUSINESS_INCOME",
          "DEPRECIATION", "INTEREST_EXPENSE", "COST_OF_GOODS_SOLD",
          "SL_TOTAL_ASSETS", "SL_CASH", "SL_AR_GROSS",
          "ADS", "ANNUAL_DEBT_SERVICE", "ANNUAL_DEBT_SERVICE_PROPOSED",
          "DSCR", "GCF_DSCR",
          "EBITDA",
          "NET_WORTH", "SL_TOTAL_EQUITY", "SL_RETAINED_EARNINGS",
        ]),
    ]);
```

### Change 2: Destructure the new result

Find:
```typescript
    const readySpreads = spreadsRes.data ?? [];
    const snapshot = snapshotRes.data;
    const riskRun = riskRunRes.data;
    const memo = memoRes.data;
    const research = researchRes.data;
    const packetEvent = packetEventRes.data;
    const decisionSnapshot = decisionSnapshotRes.data;
    const qualityGate = qualityGateRes.data as { trust_grade: string; quality_score: number } | null;
```

**Replace with:**

```typescript
    const readySpreads = spreadsRes.data ?? [];
    const snapshot = snapshotRes.data;
    const riskRun = riskRunRes.data;
    const memo = memoRes.data;
    const research = researchRes.data;
    const packetEvent = packetEventRes.data;
    const decisionSnapshot = decisionSnapshotRes.data;
    const qualityGate = qualityGateRes.data as { trust_grade: string; quality_score: number } | null;

    // Compute spread completeness score from the fact keys returned
    const spreadFactKeys = new Set(
      (completenessFactsRes.data ?? []).map((f: { fact_key: string }) => f.fact_key),
    );
    const CRITICAL_PRIMARY = [
      "GROSS_RECEIPTS", "NET_INCOME", "DEPRECIATION",
      "INTEREST_EXPENSE", "COST_OF_GOODS_SOLD",
      "SL_TOTAL_ASSETS", "SL_CASH", "SL_AR_GROSS",
      "ADS", "DSCR", "EBITDA", "NET_WORTH",
    ] as const;
    const CRITICAL_FALLBACKS: Record<string, string[]> = {
      GROSS_RECEIPTS: ["TOTAL_REVENUE", "TOTAL_INCOME"],
      NET_INCOME:     ["ORDINARY_BUSINESS_INCOME"],
      ADS:            ["ANNUAL_DEBT_SERVICE", "ANNUAL_DEBT_SERVICE_PROPOSED"],
      DSCR:           ["GCF_DSCR"],
      NET_WORTH:      ["SL_TOTAL_EQUITY", "SL_RETAINED_EARNINGS"],
    };
    let spreadCompletenessScore: number | null = null;
    if ((completenessFactsRes.data ?? []).length >= 0) {
      let populated = 0;
      for (const key of CRITICAL_PRIMARY) {
        const toCheck = [key, ...(CRITICAL_FALLBACKS[key] ?? [])];
        if (toCheck.some((k) => spreadFactKeys.has(k))) populated++;
      }
      spreadCompletenessScore = Math.round((populated / CRITICAL_PRIMARY.length) * 100);
    }
```

**Note:** also add `completenessFactsRes` to the destructure at the top of the `Promise.all`. The existing destructure looks like:

```typescript
    const [
      spreadsRes,
      snapshotRes,
      riskRunRes,
      memoRes,
      researchRes,
      packetEventRes,
      decisionSnapshotRes,
      qualityGateRes,
    ] = await Promise.all([
```

**Replace with:**

```typescript
    const [
      spreadsRes,
      snapshotRes,
      riskRunRes,
      memoRes,
      researchRes,
      packetEventRes,
      decisionSnapshotRes,
      qualityGateRes,
      completenessFactsRes,
    ] = await Promise.all([
```

### Change 3: Update `buildSpreadStep` to accept and show completeness

Find:
```typescript
    const steps: PipelineStep[] = [
      buildSpreadStep(dealId, readySpreads),
```

**Replace with:**

```typescript
    const steps: PipelineStep[] = [
      buildSpreadStep(dealId, readySpreads, spreadCompletenessScore),
```

Find the `buildSpreadStep` function signature:
```typescript
function buildSpreadStep(
  dealId: string,
  readySpreads: Array<{ spread_type: string; status: string; updated_at: string | null }>,
): PipelineStep {
```

**Replace with:**

```typescript
function buildSpreadStep(
  dealId: string,
  readySpreads: Array<{ spread_type: string; status: string; updated_at: string | null }>,
  completenessScore: number | null,
): PipelineStep {
```

Find inside `buildSpreadStep`:
```typescript
  if (count > 0) {
    status = "complete";
    detail = `${count} spread${count !== 1 ? "s" : ""} ready`;
```

**Replace with:**

```typescript
  if (count > 0) {
    status = "complete";
    if (completenessScore !== null) {
      const pct = Math.round(completenessScore);
      detail = `${count} spread${count !== 1 ? "s" : ""} ready · ${pct}% complete${pct >= 80 ? " ✓" : ""}`;
    } else {
      detail = `${count} spread${count !== 1 ? "s" : ""} ready`;
    }
```

---

## Part G — Update `src/app/api/deals/[dealId]/banker-session/dispatch/route.ts`

### Change: Add auto-complete check after successful gap resolution

Find this existing block (near the end of the `if (gapId && value && factKey)` branch):

```typescript
      const result = await resolveDealGap({
        action: "provide_value",
        gapId,
        factType: "FINANCIAL",
        factKey,
        value: resolvedValue,
        userId,
        dealId,
        bankId,
      });

      return NextResponse.json({
        ok: result.ok,
        message: result.ok
          ? `Confirmed: ${factKey} = ${value}`
          : "Recorded for review",
        intent,
      });
```

**Replace with:**

```typescript
      const result = await resolveDealGap({
        action: "provide_value",
        gapId,
        factType: "FINANCIAL",
        factKey,
        value: resolvedValue,
        userId,
        dealId,
        bankId,
      });

      // God Tier #67 — after a fact is confirmed, check if we can auto-trigger memo
      // Fire-and-forget: never delay the dispatch response
      if (result.ok) {
        Promise.resolve().then(async () => {
          try {
            const { computeSpreadCompleteness } = await import(
              "@/lib/classicSpread/computeSpreadCompleteness"
            );
            const completeness = await computeSpreadCompleteness(dealId);
            if (!completeness?.isGodTier) return;

            // No open missing-fact gaps
            const { data: openGaps } = await sb
              .from("deal_gap_queue")
              .select("id")
              .eq("deal_id", dealId)
              .eq("status", "open")
              .eq("gap_type", "missing_fact")
              .limit(1);
            if ((openGaps ?? []).length > 0) return;

            // No memo generated in the last 5 minutes
            const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            const { data: recentMemo } = await sb
              .from("canonical_memo_narratives")
              .select("id")
              .eq("deal_id", dealId)
              .gt("generated_at", fiveMinAgo)
              .limit(1)
              .maybeSingle();
            if (recentMemo) return;

            // Trigger memo regeneration
            const baseUrl = process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}`
              : process.env.NEXT_PUBLIC_APP_URL ?? "";
            if (!baseUrl) return;

            await fetch(`${baseUrl}/api/deals/${dealId}/credit-memo/generate`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-auto-trigger": "voice-completion",
                // Carry internal trust — gateway secret already verified at top of route
                "x-gateway-secret": process.env.BUDDY_GATEWAY_SECRET ?? "",
              },
              body: JSON.stringify({
                trigger: "voice_session_complete",
                completeness_score: completeness.score,
              }),
            }).catch(() => {});

            // Emit telemetry milestone
            const { emitDealMilestone } = await import("@/lib/telemetry/emitDealMilestone");
            await emitDealMilestone({
              eventKey: "voice.memo_auto_complete_triggered",
              dealId,
              bankId: bankId ?? "",
              status: "ok",
              payload: {
                completeness_score: completeness.score,
                trigger: "voice_dispatch",
                fact_key: factKey,
              },
              mirrorToObservability: true,
            }).catch(() => {});
          } catch {
            // Always non-fatal — never let auto-complete block dispatch
          }
        }).catch(() => {});
      }

      return NextResponse.json({
        ok: result.ok,
        message: result.ok
          ? `Confirmed: ${factKey} = ${value}`
          : "Recorded for review",
        intent,
      });
```

---

## Verification Checklist

After implementation, verify each item:

- [ ] **Env vars:** GET `/api/deals/[dealId]/underwrite/state` — `omegaAdvisory` field appears (not missing key). May be `null` if Pulse endpoint doesn't yet handle `omega://advisory/deal-focus` — that is expected; the field must exist.
- [ ] **Spread completeness:** Pipeline Step 1 detail shows `· XX% complete` after a deal has `deal_financial_facts` rows. Use the Samaritus test deal (`ffcc9733`).
- [ ] **Pipeline step structure:** `pipeline-state` route response has 6 steps, Step 1 has `detail` containing `· XX% complete`.
- [ ] **Research quality route:** `GET /api/deals/ffcc9733/research/quality` returns `{ ok: true, gate: {...}, evidence_summary: {...} }`.
- [ ] **Voice auto-complete:** After a `POST` to `dispatch` with a valid `gapId + factKey + value`, logs show `[voice.memo_auto_complete_triggered]` OR silence (if completeness < 80% — expected). No errors.
- [ ] **TypeScript:** `tsc --noEmit` clean on all 5 changed files.
- [ ] **`redactForOmega` export:** `src/lib/omega/redaction.server.ts` exports `redactForOmega` — confirm via `grep -n "redactForOmega" src/lib/omega/redaction.server.ts`.

---

## What This Spec Does NOT Cover

- **Roadmap update** — Do this manually via git CLI (too large for GitHub API from browser).
- **Reconciliation signal** — No code gap. Blocked on Samaritus deal data (`recon_status` NULL), not on missing system code.
- **Ialacci bio** — One-time data entry, not a system item.
- **Omega `omega://advisory/deal-focus` handler in Pulse** — Pulse must register this resource. The Buddy side is wired. If Pulse doesn't handle it, `invokeOmega` returns `{ ok: false }` and `omegaAdvisory` is `null` — fully graceful.
- **Corpus expansion** — Data acquisition, not code.

---

## God Tier System Completion State After Phase 79

| System Item | Status |
|-------------|--------|
| Model Engine V2 primary everywhere | ✅ Phase 11 (confirmed) |
| Spread completeness ≥80% measured in pipeline | ✅ Phase 79 |
| Voice → completeness → memo auto-complete | ✅ Phase 79 |
| Omega advisory annotations in underwrite state | ✅ Phase 79 |
| BIE research quality endpoint | ✅ Phase 79 |
| BIE trust grade in pipeline Step 5 | ✅ Phase 78 |
| Claim-level provenance for all research | ✅ Phase 78 |
| Committee packet generation | ✅ Phase 54–57 |
| Borrower Intake → Deal Builder | ✅ Phase 53A |
| Reconciliation engine | ✅ Phase 69–70 |
| Reconciliation signal cleared (Samaritus) | 🔴 Data item |
| Ialacci bio | 🔴 Data item |

**The only remaining God Tier blockers are data items on a specific deal, not missing system code.**
