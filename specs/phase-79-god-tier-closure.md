# Phase 79 — God Tier Closure

**Status:** Spec ready for implementation
**Priority:** Critical — closes all remaining God Tier system items
**Authored:** 2026-04-15
**Scope:** 4 system items + 1 roadmap correction

---

## Pre-Implementation Facts (verified from codebase)

### Item A — Model Engine V2: ALREADY DONE (no code needed)
`src/lib/modelEngine/modeSelector.ts` line 34: `if (!ctx?.isOpsOverride) { return { mode: "v2_primary", reason: "enforced" }; }`

V2 is already enforced for all non-ops contexts since Phase 11. The roadmap entry "feature flag disabled" is stale. **This item requires only a roadmap update, zero code.**

### Item B — Omega Advisory: Infrastructure built, surface wiring missing
`src/lib/omega/invokeOmega.ts` is complete with kill switch, timeout, ledger, MCP transport. It reads `OMEGA_MCP_ENABLED` and `OMEGA_MCP_URL` from env. `OMEGA_MCP_ENABLED` is not set in Vercel → all calls return `{ ok: false, error: "disabled" }` silently. The underwrite state route already calls `buildTrustLayer` — that is the correct insertion point.

### Item C — Spread Completeness: No measurement function exists
No function computes `SPREAD_COMPLETENESS_PCT`. Pipeline Step 1 shows only `N spreads ready` with no percentage. `classicSpreadLoader.ts` shows 12 critical IS/BS fact keys needed for committee-grade output.

### Item D — Voice → Memo Auto-complete: Loop not wired
Voice dispatch confirms facts and calls `computeDealGaps`, but does not check spread completeness or trigger memo regeneration. The God Tier #67 scenario ("10-minute voice session → memo auto-completes") requires this final closure.

### Item E — Phase 79 BIE Calibration Panel: No new AI calls needed
`buddy_research_quality_gates` has all data. This is a pure query + display. No re-running any research.

---

## Implementation Order

1. **Part A** — Vercel env vars (2 minutes, no code)
2. **Part B** — `computeSpreadCompleteness.ts` — new file
3. **Part C** — Wire completeness into spread recompute
4. **Part D** — Omega advisory wiring into underwrite state
5. **Part E** — Voice → memo loop closure in dispatch route
6. **Part F** — BIE calibration panel in pipeline-state + new admin route
7. **Part G** — Roadmap update

---

## Part A — Vercel Environment Variables

Set these in Vercel production + preview:

```
OMEGA_MCP_ENABLED=1
OMEGA_MCP_URL=https://pulse-mcp-651478110010.us-central1.run.app
OMEGA_MCP_API_KEY=<BUDDY_INGEST_TOKEN value>
OMEGA_MCP_TIMEOUT_MS=4000
```

No code changes. After setting, `invokeOmega` will route to Pulse and ledger every call.

---

## Part B — New File: `src/lib/classicSpread/computeSpreadCompleteness.ts`

```typescript
/**
 * Spread Completeness Score
 *
 * Computes what percentage of the 12 critical financial fact keys are
 * populated in deal_financial_facts for this deal across at least one period.
 *
 * Used by:
 * - God Tier #66: spread completeness ≥80% check
 * - God Tier #67: voice dispatch auto-complete trigger
 * - Pipeline Step 1: detail badge
 *
 * Returns a score 0–100 and a breakdown of which keys are missing.
 * NEVER throws. Returns null on error.
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertDealFinancialFact } from "@/lib/financialFacts/upsertDealFinancialFact";

/**
 * Critical financial fact keys required for committee-grade spread.
 * These map to the rows that underwriters rely on — revenue, income,
 * balance sheet anchors, and coverage metrics.
 */
export const CRITICAL_SPREAD_KEYS = [
  // Income Statement (5 keys)
  "GROSS_RECEIPTS",           // Revenue — primary key; fallback handled by loader
  "NET_INCOME",               // Bottom line — fallback: ORDINARY_BUSINESS_INCOME
  "DEPRECIATION",             // D&A add-back required for DSCR
  "INTEREST_EXPENSE",         // Required for coverage ratios
  "COST_OF_GOODS_SOLD",       // Needed for gross margin

  // Balance Sheet (4 keys)
  "SL_TOTAL_ASSETS",          // Balance sheet anchor
  "SL_CASH",                  // Liquidity
  "SL_AR_GROSS",              // Receivables

  // Structural / Derived (3 keys)
  "ADS",                      // Annual Debt Service — written after spread compute
  "DSCR",                     // Coverage ratio — written after spread compute
  "EBITDA",                   // Derived — written after spread compute
] as const;

// Fallback chains — if primary key is missing, check these alternatives
const FALLBACK_CHAINS: Record<string, string[]> = {
  GROSS_RECEIPTS: ["TOTAL_REVENUE", "TOTAL_INCOME"],
  NET_INCOME: ["ORDINARY_BUSINESS_INCOME"],
  ADS: ["ANNUAL_DEBT_SERVICE", "ANNUAL_DEBT_SERVICE_PROPOSED"],
  DSCR: ["GCF_DSCR", "DSCR_GLOBAL"],
};

export type SpreadCompletenessResult = {
  score: number;           // 0–100
  populated: number;       // count of populated critical keys
  total: number;           // always 11
  missing: string[];       // which critical keys have no value
  isGodTier: boolean;      // score >= 80
};

/**
 * Compute spread completeness for a deal.
 * Reads from deal_financial_facts (non-superseded, non-rejected, non-null).
 * Returns null on DB error.
 */
export async function computeSpreadCompleteness(
  dealId: string,
): Promise<SpreadCompletenessResult | null> {
  try {
    const sb = supabaseAdmin();

    // Fetch all non-null, non-superseded facts for this deal
    const allKeys = CRITICAL_SPREAD_KEYS.flatMap((k) => [k, ...(FALLBACK_CHAINS[k] ?? [])]);
    const uniqueKeys = [...new Set(allKeys)];

    const { data: facts, error } = await sb
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num")
      .eq("deal_id", dealId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected")
      .not("fact_value_num", "is", null)
      .in("fact_key", uniqueKeys);

    if (error) {
      console.error("[computeSpreadCompleteness] query failed:", error.message);
      return null;
    }

    const presentKeys = new Set((facts ?? []).map((f) => f.fact_key));

    // Check each critical key (with fallback chain)
    const missing: string[] = [];
    let populated = 0;

    for (const key of CRITICAL_SPREAD_KEYS) {
      const toCheck = [key, ...(FALLBACK_CHAINS[key] ?? [])];
      const found = toCheck.some((k) => presentKeys.has(k));
      if (found) {
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

/**
 * Compute spread completeness and persist as SPREAD_COMPLETENESS_PCT fact.
 * Call this after every spread recompute.
 * Non-fatal — failure is logged but never throws.
 */
export async function persistSpreadCompleteness(
  dealId: string,
  bankId: string,
): Promise<SpreadCompletenessResult | null> {
  const result = await computeSpreadCompleteness(dealId);
  if (!result) return null;

  try {
    await upsertDealFinancialFact({
      dealId,
      bankId,
      factKey: "SPREAD_COMPLETENESS_PCT",
      factValueNum: result.score,
      factType: "COMPUTED",
      sourceType: "COMPUTED",
      confidence: 1.0,
      periodEnd: new Date().toISOString().slice(0, 10),
      meta: { populated: result.populated, total: result.total, missing: result.missing },
    });
  } catch (err) {
    console.error("[persistSpreadCompleteness] upsert failed:", err);
  }

  return result;
}
```

---

## Part C — Wire Completeness into Spread Recompute

### File: `src/app/api/deals/[dealId]/spreads/recompute/route.ts`

Find the line that returns the success response after spread recompute completes. Insert immediately before the return:

```typescript
// Persist spread completeness score (non-fatal)
try {
  const { persistSpreadCompleteness } = await import(
    "@/lib/classicSpread/computeSpreadCompleteness"
  );
  await persistSpreadCompleteness(dealId, access.bankId);
} catch (err) {
  console.warn("[spreads/recompute] completeness persist failed (non-fatal):", err);
}
```

### File: `src/app/api/deals/[dealId]/underwrite/pipeline-state/route.ts`

In `buildSpreadStep`, after computing `count` and `latestAt`, add completeness read:

```typescript
// Read SPREAD_COMPLETENESS_PCT from deal_financial_facts
const { data: completenessRow } = await sb
  .from("deal_financial_facts")
  .select("fact_value_num")
  .eq("deal_id", dealId)
  .eq("fact_key", "SPREAD_COMPLETENESS_PCT")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const completenessScore = completenessRow?.fact_value_num ?? null;
```

Update the `detail` string in the complete branch:

```typescript
// Before (existing):
detail = `${count} spread${count !== 1 ? "s" : ""} ready`;

// After:
detail = completenessScore !== null
  ? `${count} spread${count !== 1 ? "s" : ""} ready · ${Math.round(completenessScore)}% complete${completenessScore >= 80 ? " ✓" : ""}`
  : `${count} spread${count !== 1 ? "s" : ""} ready`;
```

**Note:** `buildSpreadStep` currently doesn't have access to `sb` (it's a pure function receiving pre-fetched data). Add `completenessScore: number | null` to the function signature and pass the pre-fetched value from the parallel query block.

The parallel query block already runs 8 queries. Add a 9th:

```typescript
// 9. Spread completeness score
sb.from("deal_financial_facts")
  .select("fact_value_num")
  .eq("deal_id", dealId)
  .eq("fact_key", "SPREAD_COMPLETENESS_PCT")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle(),
```

Destructure as `completenessRes` and pass `completenessRes.data?.fact_value_num ?? null` to `buildSpreadStep`.

---

## Part D — Omega Advisory Wiring into Underwrite State

### File: `src/app/api/deals/[dealId]/underwrite/state/route.ts`

The route already builds a `trustLayer`. Omega advisory annotates the trust layer with confidence scores and risk emphasis — it does NOT override or mutate canonical state (OCC SR 11-7 boundary).

After the `trustLayer` is built, add:

```typescript
// Omega advisory annotation (non-fatal, annotates only — never overrides canonical state)
let omegaAdvisory: {
  confidence: number;
  risk_emphasis: string[];
  recommended_focus: string | null;
  advisory_grade: string | null;
} | null = null;

try {
  const { invokeOmega } = await import("@/lib/omega/invokeOmega");
  const { redactForOmega } = await import("@/lib/omega/redaction.server");

  const redacted = redactForOmega({
    dealId,
    bankId: deal.bank_id,
    trustLayer,
    lifecycleStage: deal.stage,
  });

  const result = await invokeOmega<{
    confidence: number;
    risk_emphasis: string[];
    recommended_focus: string | null;
    advisory_grade: string | null;
  }>({
    resource: "omega://advisory/deal-focus",
    correlationId: `state:${dealId}:${Date.now()}`,
    payload: redacted,
    timeoutMs: 3500, // tight timeout — never blocks the state route
  });

  if (result.ok) {
    omegaAdvisory = result.data;
  }
} catch {
  // Omega is non-fatal — if it's not connected, the route continues normally
}
```

Add `omegaAdvisory` to the return JSON:

```typescript
return NextResponse.json({
  ok: true,
  // ... existing fields ...
  omegaAdvisory,  // null if Omega unavailable or disabled
});
```

**OCC SR 11-7 compliance note:** `omegaAdvisory` is rendered as advisory annotation in the UI. It never writes to `deal_financial_facts`, never mutates lifecycle, and is always labeled as "Advisory" to the banker. Canonical values (DSCR, grade, stage) are unaffected.

### File: `src/lib/omega/redaction.server.ts`

Verify this file already exports `redactForOmega`. It exists at `src/lib/omega/redaction.server.ts` (8 files in `src/lib/omega/`). If the function signature doesn't accept `trustLayer`, add it as an optional param:

```typescript
export function redactForOmega(input: {
  dealId: string;
  bankId: string | null;
  trustLayer?: unknown;
  lifecycleStage?: string | null;
}): Record<string, unknown> {
  // existing implementation — add trustLayer serialization
  return {
    deal_id: input.dealId,
    bank_id: input.bankId,
    lifecycle_stage: input.lifecycleStage ?? null,
    // Redact trust layer — include only aggregate scores, never raw facts
    trust_summary: input.trustLayer
      ? {
          overall_confidence: (input.trustLayer as any)?.overallConfidence ?? null,
          flags: ((input.trustLayer as any)?.flags ?? []).map((f: any) => ({
            code: f.code,
            severity: f.severity,
          })),
        }
      : null,
  };
}
```

---

## Part E — Voice Dispatch → Memo Auto-complete Loop

### File: `src/app/api/deals/[dealId]/banker-session/dispatch/route.ts`

At the end of the successful fact confirmation block (after `resolveDealGap` and `computeDealGaps` fire), add:

```typescript
// God Tier #67: Check if voice session has unlocked memo auto-complete
// Only trigger if: (1) a fact was just confirmed, (2) spread completeness ≥80%,
// (3) no critical open gaps remain, (4) no memo was generated in last 5 minutes
try {
  const { computeSpreadCompleteness } = await import(
    "@/lib/classicSpread/computeSpreadCompleteness"
  );
  const completeness = await computeSpreadCompleteness(dealId);

  if (completeness?.isGodTier) {
    // Check for open critical gaps
    const { data: openGaps } = await sb
      .from("deal_gap_queue")
      .select("id")
      .eq("deal_id", dealId)
      .eq("status", "open")
      .eq("gap_type", "missing_fact")
      .limit(1);

    const hasOpenGaps = (openGaps ?? []).length > 0;

    if (!hasOpenGaps) {
      // Check if memo was generated recently (within 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentMemo } = await sb
        .from("canonical_memo_narratives")
        .select("id")
        .eq("deal_id", dealId)
        .gt("generated_at", fiveMinutesAgo)
        .limit(1)
        .maybeSingle();

      if (!recentMemo) {
        // Fire memo regeneration (fire-and-forget — voice session must complete first)
        const memoTriggerUrl = `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ""}/api/deals/${dealId}/credit-memo/generate`;
        
        // Get bank auth headers
        const authHeader = req.headers.get("authorization");
        
        fetch(memoTriggerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authHeader ? { authorization: authHeader } : {}),
            "x-auto-trigger": "voice-completion",
          },
          body: JSON.stringify({ trigger: "voice_session_complete", completeness_score: completeness.score }),
        }).catch((err) => {
          console.warn("[dispatch] memo auto-trigger failed (non-fatal):", err);
        });

        // Emit milestone event
        const { emitDealMilestone } = await import("@/lib/telemetry/emitDealMilestone");
        await emitDealMilestone({
          eventKey: "voice.memo_auto_complete_triggered",
          dealId,
          bankId: access.bankId,
          status: "ok",
          payload: { completeness_score: completeness.score, trigger: "voice_dispatch" },
          mirrorToObservability: true,
        }).catch(() => {});
      }
    }
  }
} catch (err) {
  // Auto-complete trigger is non-fatal — never block the dispatch response
  console.warn("[dispatch] auto-complete check failed (non-fatal):", err);
}
```

**Important:** This block must execute AFTER the dispatch response has been sent (fire-and-forget pattern), or be placed before the response if the latency impact is acceptable. Use the existing pattern in the dispatch route for fire-and-forget.

---

## Part F — BIE Research Quality Panel

No new AI calls. Pure query over existing `buddy_research_quality_gates` data.

### New File: `src/app/api/deals/[dealId]/research/quality/route.ts`

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const maxDuration = 10;

type Params = Promise<{ dealId: string }>;

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: 403 });

  const sb = supabaseAdmin();

  const [gateRes, evidenceRes] = await Promise.all([
    // Latest quality gate result
    sb.from("buddy_research_quality_gates")
      .select("*")
      .eq("deal_id", dealId)
      .order("evaluated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Evidence summary — count by thread_origin + claim_layer
    sb.from("buddy_research_evidence")
      .select("thread_origin, claim_layer, confidence, source_types")
      .eq("mission_id",
        // Subquery: get latest mission_id for this deal
        sb.from("buddy_research_missions")
          .select("id")
          .eq("deal_id", dealId)
          .order("created_at", { ascending: false })
          .limit(1)
      ),
  ]);

  const gate = gateRes.data;
  const evidence = evidenceRes.data ?? [];

  // Aggregate evidence by thread
  const threadCounts: Record<string, { total: number; fact: number; inference: number; narrative: number }> = {};
  for (const row of evidence) {
    const t = row.thread_origin ?? "unknown";
    if (!threadCounts[t]) threadCounts[t] = { total: 0, fact: 0, inference: 0, narrative: 0 };
    threadCounts[t].total++;
    if (row.claim_layer === "fact") threadCounts[t].fact++;
    if (row.claim_layer === "inference") threadCounts[t].inference++;
    if (row.claim_layer === "narrative") threadCounts[t].narrative++;
  }

  // Classify gate checks by status
  const checks = (gate?.gate_failures ?? []) as Array<{ gate_id: string; reason: string; severity: string }>;

  return NextResponse.json({
    ok: true,
    gate: gate ? {
      trust_grade: gate.trust_grade,
      gate_passed: gate.gate_passed,
      quality_score: gate.quality_score,
      evaluated_at: gate.evaluated_at,
      entity_lock_check: gate.entity_lock_check,
      entity_confidence: gate.entity_confidence,
      thread_coverage_check: gate.thread_coverage_check,
      threads_succeeded: gate.threads_succeeded,
      threads_failed: gate.threads_failed,
      source_diversity_check: gate.source_diversity_check,
      source_count: gate.source_count,
      management_validation_check: gate.management_validation_check,
      principals_confirmed: gate.principals_confirmed,
      principals_unconfirmed: gate.principals_unconfirmed,
      synthesis_check: gate.synthesis_check,
      contradictions_found: gate.contradictions_found,
      underwriting_questions_found: gate.underwriting_questions_found,
      failures: checks,
      thread_results: gate.thread_results,
    } : null,
    evidence_summary: {
      total_claims: evidence.length,
      by_thread: threadCounts,
    },
  });
}
```

### Surface in pipeline-state

In `buildResearchStep` in `pipeline-state/route.ts`, the `qualityGate` is already fetched and surfaced. Add `quality_score` to the detail string if below committee-grade:

```typescript
// Existing:
const grade = qualityGate.trust_grade === "committee_grade" ? "Committee-grade ✓"
  : qualityGate.trust_grade === "preliminary" ? "Preliminary"
  : qualityGate.trust_grade === "manual_review_required" ? "Manual review required"
  : "Research failed";
detail = `${grade} · Quality: ${qualityGate.quality_score}/100`;

// No change needed — already correct from Phase 78.
```

The new `/research/quality` route gives the AnalystWorkbench a dedicated endpoint for the full gate breakdown, without adding complexity to pipeline-state.

---

## Part G — Roadmap Update

Update `BUDDY_PROJECT_ROADMAP.md`:

1. Change `Last Updated: March 30, 2026` → `Last Updated: April 15, 2026`

2. Update status line to include phases 66–78:
   ```
   Status: ... + Phase 78 (BIE Trust Layer) + Phase 79 (God Tier Closure)
   ```

3. In **Definition of Done — God Tier**, update status:
   ```
   63. 🔴 Ialacci bio retyped (one-time manual task — not a system item)
   64. 🔴 Reconciliation — Committee Approve signal (blocked on deal data, not code)
   65. ✅ Borrower Intake wired
   66. ✅ Spread completeness measured — SPREAD_COMPLETENESS_PCT written after every recompute (Phase 79)
   67. ✅ Voice → completeness check → memo auto-complete loop wired (Phase 79)
   ```

4. Add to progress tracker table:
   ```
   | Phase 78 | BIE Trust Layer — sourcePolicy, completionGate, claimLedger, 3 migrations | ✅ Complete | 39c7cb86 |
   | Phase 79 | God Tier Closure — spread completeness, Omega wiring, voice loop, BIE quality route | ✅ Complete | [SHA] |
   ```

5. In **Next Phases**, remove "Model Engine V2" — it's already enforced (Phase 11). Add:
   ```
   1. **Reconciliation** — deal-specific, not a system build item
   2. **Phase 79 eval harness** (formerly "golden-set") — aggregate BIE trust grade reporting
   3. **Corpus Expansion** — 10+ verified docs for bank confidence
   ```

---

## Verification Checklist

After implementation, verify:

- [ ] `OMEGA_MCP_ENABLED=1` set in Vercel — `invokeOmega` no longer returns `{ ok: false, error: "disabled" }`
- [ ] After spread recompute: `SPREAD_COMPLETENESS_PCT` row exists in `deal_financial_facts`
- [ ] Pipeline Step 1 shows `N spreads ready · XX% complete` (with ✓ if ≥80%)
- [ ] Underwrite state route returns `omegaAdvisory` field (may be null if Pulse unavailable)
- [ ] Voice dispatch route: after fact confirmation, auto-complete check runs (verify in logs)
- [ ] GET `/api/deals/[dealId]/research/quality` returns `{ ok: true, gate: {...}, evidence_summary: {...} }`
- [ ] `tsc --noEmit` clean

---

## What This Does NOT Include

- **Reconciliation signal** — This is blocked on deal-level data correctness (Samaritus `recon_status`), not on missing system code. The reconciliation engine is built and working.
- **Ialacci bio** — One-time manual data entry, not a system item.
- **Corpus expansion** — Data acquisition, not code.
- **Phase 79 golden-set eval harness** — This is now properly scoped as a reporting layer over existing `buddy_research_quality_gates` data. The new `/research/quality` route in this spec is the foundation. A dedicated UI panel for multi-deal aggregate views is a separate small spec.

---

## God Tier Completion State After Phase 79

| Item | Status |
|------|--------|
| Model Engine V2 primary everywhere | ✅ (Phase 11, confirmed) |
| Spread completeness ≥80% measured | ✅ (Phase 79) |
| Voice → memo auto-complete loop | ✅ (Phase 79) |
| Omega advisory annotations in underwrite state | ✅ (Phase 79) |
| BIE trust grade in pipeline Step 5 | ✅ (Phase 78) |
| Claim-level provenance for all research | ✅ (Phase 78) |
| Committee packet generation | ✅ (Phase 54–57) |
| Borrower Intake → Deal Builder | ✅ (Phase 53A) |
| Reconciliation engine built | ✅ (Phase 69–70) |
| Reconciliation signal cleared (Samaritus) | 🔴 Data item |
| Ialacci bio entered | 🔴 Data item |

The only remaining God Tier blockers are **data items on a specific deal**, not missing system code.
