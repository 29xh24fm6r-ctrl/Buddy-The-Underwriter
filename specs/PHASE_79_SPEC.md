# Phase 79 — God Tier Closure
## Claude Code Implementation Instructions

Read this entire file before writing any code. Implement every part in the order listed. Do not skip parts. Do not ask for clarification — all decisions are already made.

---

## What You Are Building

Four system items that close out God Tier:

1. **`computeSpreadCompleteness.ts`** — new pure-read function that scores financial fact coverage 0–100 against 12 critical keys
2. **Spread completeness badge** — pipeline Step 1 shows `N spreads ready · XX% complete ✓` when score ≥ 80
3. **Omega advisory wiring** — underwrite state route calls `invokeOmega` after `buildTrustLayer` and returns `omegaAdvisory` in the response
4. **Voice → memo auto-complete loop** — after voice dispatch confirms a fact and spread completeness ≥ 80% with no open gaps, fire-and-forget memo regeneration
5. **Research quality route** — new `GET /api/deals/[dealId]/research/quality` returns BIE gate breakdown

You are also adding `redactForOmega` to `src/lib/omega/redaction.server.ts` — it does not exist yet.

---

## Pre-Implementation: Set Vercel Environment Variables

Before writing any code, confirm the following are set in Vercel (production + preview). You cannot set them — tell the user to set them if they are not already set. Then proceed with the code.

```
OMEGA_MCP_ENABLED=1
OMEGA_MCP_URL=https://pulse-mcp-651478110010.us-central1.run.app
OMEGA_MCP_API_KEY=<value of BUDDY_INGEST_TOKEN>
OMEGA_MCP_TIMEOUT_MS=4000
```

---

## Step 1 — Create `src/lib/classicSpread/computeSpreadCompleteness.ts`

Create this file with the exact contents below. Do not modify the list of keys or fallback chains.

```typescript
/**
 * Spread Completeness Score — Phase 79
 *
 * Computes what percentage of 12 critical financial fact keys are populated
 * in deal_financial_facts for a deal (any period, any non-null value).
 *
 * Used by:
 *   - Pipeline Step 1: completeness badge
 *   - Voice dispatch: auto-complete trigger (God Tier #67)
 *
 * Pure read — never writes to DB. Never throws — returns null on error.
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const CRITICAL_SPREAD_KEYS = [
  // Income Statement
  "GROSS_RECEIPTS",
  "NET_INCOME",
  "DEPRECIATION",
  "INTEREST_EXPENSE",
  "COST_OF_GOODS_SOLD",
  // Balance Sheet
  "SL_TOTAL_ASSETS",
  "SL_CASH",
  "SL_AR_GROSS",
  // Structural / Derived
  "ADS",
  "DSCR",
  "EBITDA",
  "NET_WORTH",
] as const;

const FALLBACKS: Record<string, string[]> = {
  GROSS_RECEIPTS: ["TOTAL_REVENUE", "TOTAL_INCOME"],
  NET_INCOME:     ["ORDINARY_BUSINESS_INCOME"],
  ADS:            ["ANNUAL_DEBT_SERVICE", "ANNUAL_DEBT_SERVICE_PROPOSED"],
  DSCR:           ["GCF_DSCR"],
  NET_WORTH:      ["SL_TOTAL_EQUITY", "SL_RETAINED_EARNINGS"],
};

export type SpreadCompletenessResult = {
  score: number;       // 0–100
  populated: number;
  total: number;
  missing: string[];   // primary key names that are absent
  isGodTier: boolean;  // score >= 80
};

export async function computeSpreadCompleteness(
  dealId: string,
): Promise<SpreadCompletenessResult | null> {
  try {
    const sb = supabaseAdmin();

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

## Step 2 — Create `src/app/api/deals/[dealId]/research/quality/route.ts`

Create the directory `src/app/api/deals/[dealId]/research/quality/` and create `route.ts` with the exact contents below.

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const maxDuration = 10;

type Params = Promise<{ dealId: string }>;

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

    // 2. Latest mission for this deal
    const { data: mission } = await sb
      .from("buddy_research_missions")
      .select("id")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 3. Evidence claims for that mission
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

    // Aggregate by thread
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
        by_thread:    byThread,
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

## Step 3 — Add `redactForOmega` to `src/lib/omega/redaction.server.ts`

Open `src/lib/omega/redaction.server.ts`. Find the very last closing brace of the file — it is the closing brace of the `applyRedaction` function:

```typescript
  return result;
}
```

Append the following block **after that closing brace**, at the end of the file:

```typescript

// ---------------------------------------------------------------------------
// Omega advisory payload builder — Phase 79
// ---------------------------------------------------------------------------

/**
 * Build a safe advisory payload for the Omega MCP advisory resource.
 *
 * Sends only aggregate trust-layer scores and hashed identifiers.
 * No raw financial values, no document content, no PII.
 * This is the only function that constructs Omega advisory payloads.
 */
export function redactForOmega(input: {
  dealId: string;
  bankId: string | null;
  lifecycleStage?: string | null;
  trustLayer?: {
    memo?: { status: string; staleReasons?: string[] };
    packet?: { status: string; blockers?: string[]; warnings?: string[] };
    financialValidation?: {
      memoSafe: boolean;
      decisionSafe: boolean;
      blockers?: string[];
      warnings?: string[];
    };
  } | null;
}): Record<string, unknown> {
  return {
    deal_id:         hashId(input.dealId),
    bank_id:         input.bankId ? hashId(input.bankId) : null,
    lifecycle_stage: input.lifecycleStage ?? null,
    trust_summary:   input.trustLayer
      ? {
          memo_status:             input.trustLayer.memo?.status ?? null,
          memo_stale_count:        input.trustLayer.memo?.staleReasons?.length ?? 0,
          packet_status:           input.trustLayer.packet?.status ?? null,
          packet_blocker_count:    input.trustLayer.packet?.blockers?.length ?? 0,
          financial_memo_safe:     input.trustLayer.financialValidation?.memoSafe ?? null,
          financial_decision_safe: input.trustLayer.financialValidation?.decisionSafe ?? null,
          financial_blocker_count: input.trustLayer.financialValidation?.blockers?.length ?? 0,
        }
      : null,
  };
}
```

`hashId` is already defined in the same file — no new imports needed.

---

## Step 4 — Update `src/app/api/deals/[dealId]/underwrite/state/route.ts`

### 4a. Add the Omega advisory block

Open the file. Find this exact block:

```typescript
    // Trust layer — composed from canonical memo/packet/financial validation sources
    let trustLayer = null;
    try {
      trustLayer = await buildTrustLayer(dealId);
    } catch (err) {
      console.warn("[underwrite/state] trust layer failed — degrading safely:", err);
    }
```

Replace it with:

```typescript
    // Trust layer — composed from canonical memo/packet/financial validation sources
    let trustLayer = null;
    try {
      trustLayer = await buildTrustLayer(dealId);
    } catch (err) {
      console.warn("[underwrite/state] trust layer failed — degrading safely:", err);
    }

    // Omega advisory annotation — Phase 79
    // OCC SR 11-7 boundary: Omega NEVER mutates canonical state. Advisory only.
    let omegaAdvisory: {
      confidence: number;
      risk_emphasis: string[];
      recommended_focus: string | null;
      advisory_grade: string | null;
    } | null = null;

    try {
      const { invokeOmega } = await import("@/lib/omega/invokeOmega");
      const { redactForOmega } = await import("@/lib/omega/redaction.server");

      const omegaResult = await invokeOmega<{
        confidence: number;
        risk_emphasis: string[];
        recommended_focus: string | null;
        advisory_grade: string | null;
      }>({
        resource: "omega://advisory/deal-focus",
        correlationId: `state:${dealId}:${Date.now()}`,
        payload: redactForOmega({
          dealId,
          bankId: deal.bank_id,
          lifecycleStage: deal.stage,
          trustLayer: trustLayer as any,
        }),
        timeoutMs: 3500,
      });

      if (omegaResult.ok) {
        omegaAdvisory = omegaResult.data;
      }
    } catch {
      // Non-fatal — Omega unavailable does not block this route
    }
```

### 4b. Add `omegaAdvisory` to the return JSON

Find this line in the return statement:

```typescript
    return NextResponse.json({
      ok: true,
      deal: {
```

Replace with:

```typescript
    return NextResponse.json({
      ok: true,
      omegaAdvisory,
      deal: {
```

---

## Step 5 — Update `src/app/api/deals/[dealId]/underwrite/pipeline-state/route.ts`

### 5a. Add the completeness query to the `Promise.all` array

Find the destructuring assignment at the top of the `try` block. It currently reads:

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

Replace with:

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

### 5b. Add the completeness query as the last entry in `Promise.all`

Find the last query in the `Promise.all` array:

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

Replace with:

```typescript
      // 7. Phase 78: Research quality gate
      sb.from("buddy_research_quality_gates")
        .select("trust_grade, quality_score")
        .eq("deal_id", dealId)
        .order("evaluated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 8. Phase 79: Spread completeness — presence of critical fact keys
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

### 5c. Compute the completeness score after destructuring

Find this existing block (immediately after the `Promise.all`):

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

Replace with:

```typescript
    const readySpreads = spreadsRes.data ?? [];
    const snapshot = snapshotRes.data;
    const riskRun = riskRunRes.data;
    const memo = memoRes.data;
    const research = researchRes.data;
    const packetEvent = packetEventRes.data;
    const decisionSnapshot = decisionSnapshotRes.data;
    const qualityGate = qualityGateRes.data as { trust_grade: string; quality_score: number } | null;

    // Compute spread completeness from returned fact keys
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
    const presentFactKeys = new Set(
      (completenessFactsRes.data ?? []).map((f: { fact_key: string }) => f.fact_key),
    );
    let spreadCompletenessScore: number | null = null;
    {
      let populated = 0;
      for (const key of CRITICAL_PRIMARY) {
        const toCheck = [key, ...(CRITICAL_FALLBACKS[key] ?? [])];
        if (toCheck.some((k) => presentFactKeys.has(k))) populated++;
      }
      spreadCompletenessScore = Math.round((populated / CRITICAL_PRIMARY.length) * 100);
    }
```

### 5d. Pass completeness into `buildSpreadStep`

Find:

```typescript
    const steps: PipelineStep[] = [
      buildSpreadStep(dealId, readySpreads),
```

Replace with:

```typescript
    const steps: PipelineStep[] = [
      buildSpreadStep(dealId, readySpreads, spreadCompletenessScore),
```

### 5e. Update `buildSpreadStep` signature and detail string

Find the function signature:

```typescript
function buildSpreadStep(
  dealId: string,
  readySpreads: Array<{ spread_type: string; status: string; updated_at: string | null }>,
): PipelineStep {
```

Replace with:

```typescript
function buildSpreadStep(
  dealId: string,
  readySpreads: Array<{ spread_type: string; status: string; updated_at: string | null }>,
  completenessScore: number | null,
): PipelineStep {
```

Inside `buildSpreadStep`, find:

```typescript
  if (count > 0) {
    status = "complete";
    detail = `${count} spread${count !== 1 ? "s" : ""} ready`;
```

Replace with:

```typescript
  if (count > 0) {
    status = "complete";
    if (completenessScore !== null) {
      const pct = Math.round(completenessScore);
      detail = `${count} spread${count !== 1 ? "s" : ""} ready \u00b7 ${pct}% complete${pct >= 80 ? " \u2713" : ""}`;
    } else {
      detail = `${count} spread${count !== 1 ? "s" : ""} ready`;
    }
```

---

## Step 6 — Update `src/app/api/deals/[dealId]/banker-session/dispatch/route.ts`

### 6a. Add import

At the top of the file, after the existing imports:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveDealGap } from "@/lib/gapEngine/resolveDealGap";
```

No new static imports are needed — `computeSpreadCompleteness` and `emitDealMilestone` are dynamically imported inside the handler.

### 6b. Add fire-and-forget auto-complete check

Find this exact block inside the `if (gapId && value && factKey)` branch:

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

Replace with:

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

      // God Tier #67 — fire-and-forget auto-complete check after fact confirmation
      if (result.ok) {
        Promise.resolve().then(async () => {
          try {
            const { computeSpreadCompleteness } = await import(
              "@/lib/classicSpread/computeSpreadCompleteness"
            );
            const completeness = await computeSpreadCompleteness(dealId);
            if (!completeness?.isGodTier) return;

            // Check for open missing-fact gaps
            const { data: openGaps } = await sb
              .from("deal_gap_queue")
              .select("id")
              .eq("deal_id", dealId)
              .eq("status", "open")
              .eq("gap_type", "missing_fact")
              .limit(1);
            if ((openGaps ?? []).length > 0) return;

            // Check that no memo was generated in the last 5 minutes
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
                "x-gateway-secret": process.env.BUDDY_GATEWAY_SECRET ?? "",
              },
              body: JSON.stringify({
                trigger: "voice_session_complete",
                completeness_score: completeness.score,
              }),
            }).catch(() => {});

            // Emit observability milestone
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
            // Always non-fatal
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

## Step 7 — Run TypeScript check

Run `tsc --noEmit` and fix any type errors before committing. Common issues to watch for:

- `completenessFactsRes` might need a type annotation if TypeScript can't infer the tuple position — add `as { data: Array<{ fact_key: string }> | null; error: any }` if needed
- `omegaAdvisory` type must be declared before the `try` block so it's in scope for the return statement — verify the `let omegaAdvisory` declaration is outside the `try`
- `redactForOmega` in `redaction.server.ts` uses `hashId` which is already defined earlier in the same file — no import needed

---

## Verification Checklist

Verify each item. All must pass before committing.

- [ ] `src/lib/classicSpread/computeSpreadCompleteness.ts` exists and exports `computeSpreadCompleteness` and `CRITICAL_SPREAD_KEYS`
- [ ] `src/app/api/deals/[dealId]/research/quality/route.ts` exists and exports `GET`
- [ ] `src/lib/omega/redaction.server.ts` exports `redactForOmega` — confirm with `grep -n "export function redactForOmega" src/lib/omega/redaction.server.ts`
- [ ] `underwrite/state/route.ts` return JSON includes `omegaAdvisory` key
- [ ] `pipeline-state/route.ts` `Promise.all` has 9 entries (was 8)
- [ ] `pipeline-state/route.ts` `buildSpreadStep` accepts 3 arguments
- [ ] `dispatch/route.ts` fire-and-forget block is inside `if (result.ok)` — never runs on failed gap resolution
- [ ] `tsc --noEmit` — zero new errors

---

## Commit Message

```
Phase 79: God Tier Closure — spread completeness, Omega wiring, voice loop, research quality route
```
