# Phase: Underwriting Pipeline Rail

## Problem

The current AnalystWorkbench exposes a Trust Layer (3 disconnected tiles: Credit Memo, Committee Packet, Financial Validation) and three Workstream Cards (Spreads, Credit Memo, Risk & Structure). The banker sees state but has no idea:
- What step to take first
- What's blocking downstream steps
- What the correct sequence is

The result: bankers hit hidden prerequisite errors ("AI risk assessment required", "financial snapshot must be built first") with no UI guidance that those prerequisites exist.

## Solution

Replace `UnderwriteTrustLayer` with a single `UnderwritingPipelineRail` — a numbered, sequential pipeline that shows every step's real status and presents one action button at a time.

## What to preserve

- **Workstream Cards remain unchanged** — Spreads, Credit Memo, Risk & Structure cards stay. The Pipeline Rail is the *status + action* surface; the cards are the *execution* surface.
- `MemoFreshnessCard`, `PacketReadinessCard`, `FinancialValidationCard` — keep files, just stop rendering them in the workbench.
- All existing API routes — no backend changes beyond adding one new endpoint.

---

## New API — `GET /api/deals/[dealId]/underwrite/pipeline-state`

Returns the live status of every pipeline step derived from real DB queries.

**File:** `src/app/api/deals/[dealId]/underwrite/pipeline-state/route.ts`

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const maxDuration = 15;

export type PipelineStepStatus = "complete" | "ready" | "blocked" | "in_progress";

export type PipelineStep = {
  id: string;
  label: string;
  status: PipelineStepStatus;
  summary: string | null;    // e.g. "BB+ · 975 bps", "9 sections", "47 facts across 3 periods"
  blockers: string[];        // human-readable reasons why this step is blocked
  actionLabel: string | null;
  actionApi: string | null;  // POST endpoint to call when action is clicked
  actionMethod: "POST" | "GET";
  completedAt: string | null;
};

export type PipelineState = {
  ok: true;
  steps: PipelineStep[];
  currentStepId: string | null; // first non-complete step
};

type Params = Promise<{ dealId: string }>;

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: 403 });

  const sb = supabaseAdmin();

  // Load all pipeline inputs in parallel — one round trip
  const [factsRes, riskRes, researchRes, narrativeRes, packetEventRes] = await Promise.all([
    // Step 1: Financial facts extracted from documents
    sb.from("deal_financial_facts")
      .select("id, fact_period_end")
      .eq("deal_id", dealId)
      .not("fact_value_num", "is", null),

    // Step 2: AI risk assessment
    sb.from("ai_risk_runs")
      .select("id, grade, base_rate_bps, risk_premium_bps, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Step 3: Research mission
    sb.from("buddy_research_missions")
      .select("id, status, completed_at")
      .eq("deal_id", dealId)
      .eq("status", "complete")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Step 4: Credit memo
    sb.from("canonical_memo_narratives")
      .select("id, generated_at")
      .eq("deal_id", dealId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Step 5: Committee packet event
    sb.from("deal_events")
      .select("created_at")
      .eq("deal_id", dealId)
      .eq("kind", "deal.committee.packet.generated")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const facts = factsRes.data ?? [];
  const riskRun = riskRes.data ?? null;
  const researchMission = researchRes.data ?? null;
  const memoNarrative = narrativeRes.data ?? null;
  const packetEvent = packetEventRes.data ?? null;

  // Derive period summary for facts
  const periods = new Set(facts.map((f: any) => f.fact_period_end).filter(Boolean));
  const factSummary = facts.length > 0
    ? `${facts.length} facts across ${periods.size} period${periods.size !== 1 ? "s" : ""}`
    : null;

  // Derive risk summary
  const riskSummary = riskRun
    ? `${riskRun.grade} · ${(riskRun.base_rate_bps + riskRun.risk_premium_bps).toLocaleString()} bps`
    : null;

  // Step 1: Financial Data
  const step1: PipelineStep = {
    id: "financial_data",
    label: "Financial Data",
    status: facts.length > 0 ? "complete" : "in_progress",
    summary: factSummary ?? "Awaiting document processing",
    blockers: [],
    actionLabel: facts.length === 0 ? null : null, // auto-populated, no manual action
    actionApi: null,
    actionMethod: "POST",
    completedAt: null,
  };

  // Step 2: Risk Assessment
  const step2: PipelineStep = {
    id: "risk_assessment",
    label: "Risk Assessment",
    status: riskRun ? "complete" : (facts.length > 0 ? "ready" : "blocked"),
    summary: riskSummary,
    blockers: facts.length === 0 ? ["Financial data must be extracted before running risk assessment"] : [],
    actionLabel: riskRun ? null : "Run Risk Assessment",
    actionApi: riskRun ? null : `/api/deals/${dealId}/ai-risk`,
    actionMethod: "POST",
    completedAt: riskRun?.created_at ?? null,
  };

  // Step 3: Research
  const step3: PipelineStep = {
    id: "research",
    label: "Research",
    status: researchMission ? "complete" : (riskRun ? "ready" : "blocked"),
    summary: researchMission ? "Research complete" : null,
    blockers: !riskRun ? ["Risk assessment must complete before running research"] : [],
    actionLabel: researchMission ? null : "Run Research",
    actionApi: researchMission ? null : `/api/deals/${dealId}/research/run`,
    actionMethod: "POST",
    completedAt: researchMission?.completed_at ?? null,
  };

  // Step 4: Credit Memo
  const memoReady = !!riskRun && !!researchMission;
  const step4Blockers: string[] = [];
  if (!riskRun) step4Blockers.push("Risk assessment required");
  if (!researchMission) step4Blockers.push("Research required");

  const step4: PipelineStep = {
    id: "credit_memo",
    label: "Credit Memo",
    status: memoNarrative ? "complete" : (memoReady ? "ready" : "blocked"),
    summary: memoNarrative ? `Generated ${new Date(memoNarrative.generated_at).toLocaleDateString()}` : null,
    blockers: step4Blockers,
    actionLabel: memoNarrative ? "Regenerate" : "Generate Credit Memo",
    actionApi: `/api/deals/${dealId}/credit-memo/generate`,
    actionMethod: "POST",
    completedAt: memoNarrative?.generated_at ?? null,
  };

  // Step 5: Committee Packet
  const step5: PipelineStep = {
    id: "committee_packet",
    label: "Committee Packet",
    status: packetEvent ? "complete" : (memoNarrative ? "ready" : "blocked"),
    summary: packetEvent ? `Generated ${new Date((packetEvent as any).created_at).toLocaleDateString()}` : null,
    blockers: !memoNarrative ? ["Credit memo must be generated first"] : [],
    actionLabel: packetEvent ? "Regenerate Packet" : "Generate Packet",
    actionApi: `/api/deals/${dealId}/committee/packet/generate`,
    actionMethod: "POST",
    completedAt: (packetEvent as any)?.created_at ?? null,
  };

  const steps: PipelineStep[] = [step1, step2, step3, step4, step5];

  // First non-complete step is the "current" step
  const currentStep = steps.find(s => s.status !== "complete");

  return NextResponse.json({
    ok: true,
    steps,
    currentStepId: currentStep?.id ?? null,
  } satisfies PipelineState);
}
```

**Pre-flight:** Before implementing, check that these API routes exist for the action buttons:
- `POST /api/deals/[dealId]/ai-risk` — or find the correct AI risk route path
- `POST /api/deals/[dealId]/research/run` — or find the correct research route path
- `POST /api/deals/[dealId]/committee/packet/generate` — or find the correct packet route path

Run: `find src/app/api/deals -name "route.ts" | xargs grep -l "ai.risk\|ai_risk\|risk_run" | head -5`
and: `find src/app/api/deals -name "route.ts" | xargs grep -l "research\|buddy_research" | head -5`

Adjust the `actionApi` paths in the route based on what you find. If a route doesn't exist, set `actionApi: null` and `actionLabel: null` for that step — don't create new routes.

---

## New Component — `UnderwritingPipelineRail`

**File:** `src/components/underwrite/UnderwritingPipelineRail.tsx`

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import type { PipelineStep, PipelineState } from "@/app/api/deals/[dealId]/underwrite/pipeline-state/route";

interface Props {
  dealId: string;
  onMemoGenerated?: () => void;  // callback to refresh workbench after memo generation
}

const STATUS_CONFIG = {
  complete: {
    dot: "bg-emerald-400",
    label: "text-emerald-300",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
    badgeText: "Complete",
    icon: "check_circle",
    iconColor: "text-emerald-400",
  },
  ready: {
    dot: "bg-blue-400",
    label: "text-white",
    badge: "bg-blue-500/15 text-blue-300 border-blue-500/25",
    badgeText: "Ready",
    icon: "radio_button_unchecked",
    iconColor: "text-blue-400",
  },
  in_progress: {
    dot: "bg-amber-400 animate-pulse",
    label: "text-amber-200",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/25",
    badgeText: "In Progress",
    icon: "pending",
    iconColor: "text-amber-400",
  },
  blocked: {
    dot: "bg-white/20",
    label: "text-white/40",
    badge: "bg-white/5 text-white/30 border-white/10",
    badgeText: "Blocked",
    icon: "block",
    iconColor: "text-white/25",
  },
} as const;

function StepRow({
  step,
  stepNumber,
  isCurrentStep,
  onAction,
  acting,
}: {
  step: PipelineStep;
  stepNumber: number;
  isCurrentStep: boolean;
  onAction: (step: PipelineStep) => void;
  acting: boolean;
}) {
  const cfg = STATUS_CONFIG[step.status];
  const isBlocked = step.status === "blocked";
  const isComplete = step.status === "complete";

  return (
    <div
      className={[
        "flex items-start gap-4 px-4 py-3 rounded-xl border transition-colors",
        isCurrentStep
          ? "border-blue-500/30 bg-blue-500/5"
          : isComplete
          ? "border-emerald-500/15 bg-emerald-500/5"
          : isBlocked
          ? "border-white/5 bg-white/[0.015]"
          : "border-white/10 bg-white/[0.02]",
      ].join(" ")}
    >
      {/* Step number + status dot */}
      <div className="flex-shrink-0 flex flex-col items-center gap-1 pt-0.5">
        <div className={[
          "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold",
          isComplete ? "bg-emerald-500/20 text-emerald-300" : isBlocked ? "bg-white/5 text-white/25" : "bg-blue-500/20 text-blue-300",
        ].join(" ")}>
          {isComplete
            ? <span className="material-symbols-outlined text-[14px] text-emerald-400">check</span>
            : stepNumber}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-semibold ${cfg.label}`}>{step.label}</span>
          {step.summary && (
            <span className={`text-xs ${isComplete ? "text-emerald-300/70" : "text-white/50"}`}>
              {step.summary}
            </span>
          )}
        </div>

        {/* Blockers */}
        {step.blockers.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {step.blockers.map((b, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-white/30">
                <span className="material-symbols-outlined text-[12px] text-white/20">lock</span>
                {b}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action button */}
      {step.actionLabel && step.actionApi && (
        <button
          onClick={() => onAction(step)}
          disabled={acting || isBlocked}
          className={[
            "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-40",
            isCurrentStep
              ? "bg-blue-600 hover:bg-blue-700 text-white"
              : "border border-white/15 text-white/70 hover:text-white hover:border-white/30",
          ].join(" ")}
        >
          {acting && (
            <span className="animate-spin material-symbols-outlined text-[14px]">progress_activity</span>
          )}
          {step.actionLabel}
        </button>
      )}
    </div>
  );
}

export default function UnderwritingPipelineRail({ dealId, onMemoGenerated }: Props) {
  const [pipelineState, setPipelineState] = useState<PipelineState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actingStepId, setActingStepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPipeline = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/underwrite/pipeline-state`);
      const data = await res.json();
      if (data.ok) setPipelineState(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { fetchPipeline(); }, [fetchPipeline]);

  const handleAction = async (step: PipelineStep) => {
    if (!step.actionApi || actingStepId) return;
    setActingStepId(step.id);
    setError(null);

    try {
      const res = await fetch(step.actionApi, { method: step.actionMethod });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error ?? `${step.label} failed — check console`);
      } else {
        // Refresh pipeline state after successful action
        await fetchPipeline();
        // Notify workbench to refresh if memo was generated
        if (step.id === "credit_memo" && onMemoGenerated) {
          onMemoGenerated();
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setActingStepId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-3 w-24 bg-white/5 rounded animate-pulse" />
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-14 bg-white/[0.02] rounded-xl border border-white/5 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!pipelineState) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
          Underwriting Pipeline
        </h3>
        <button
          onClick={fetchPipeline}
          className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
          {error}
          <button onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      <div className="space-y-1.5">
        {pipelineState.steps.map((step, i) => (
          <StepRow
            key={step.id}
            step={step}
            stepNumber={i + 1}
            isCurrentStep={step.id === pipelineState.currentStepId}
            onAction={handleAction}
            acting={actingStepId === step.id}
          />
        ))}
      </div>
    </div>
  );
}
```

---

## Wire into AnalystWorkbench

**File:** `src/components/underwrite/AnalystWorkbench.tsx`

**Two changes:**

**1. Add import:**
```typescript
import UnderwritingPipelineRail from "./UnderwritingPipelineRail";
```

**2. Replace the Trust Layer block:**
```tsx
// BEFORE:
{state.trustLayer && (
  <UnderwriteTrustLayer
    dealId={dealId}
    trustLayer={state.trustLayer}
    onRegenerateMemo={handleRegenerateMemo}
    onGeneratePacket={handleGeneratePacket}
    regeneratingMemo={regeneratingMemo}
    generatingPacket={generatingPacket}
  />
)}

// AFTER:
<UnderwritingPipelineRail
  dealId={dealId}
  onMemoGenerated={fetchState}
/>
```

Remove the `handleRegenerateMemo`, `handleGeneratePacket`, `regeneratingMemo`, and `generatingPacket` state and handlers from the component — they're now owned by the Pipeline Rail.

Keep the `state.trustLayer` type on `WorkbenchState` for now to avoid breaking the API contract — just stop rendering it.

---

## Verification

After implementation:
- [ ] `GET /api/deals/[id]/underwrite/pipeline-state` returns 5 steps with correct statuses for Samaritus
- [ ] Step 1 (Financial Data) shows "complete" with facts count for Samaritus
- [ ] Step 2 (Risk Assessment) shows "complete" with "BB+ · 975 bps"
- [ ] Step 3 (Research) shows "complete"
- [ ] Step 4 (Credit Memo) shows "ready" with action button "Generate Credit Memo"
- [ ] Step 5 (Committee Packet) shows "blocked" — waiting on memo
- [ ] Clicking "Generate Credit Memo" in the rail POSTs to the generate endpoint and refreshes
- [ ] After memo generates, step 4 shows "complete" and step 5 shows "ready"
- [ ] Full Underwrite deal behavior unchanged from prior sessions
- [ ] `tsc --noEmit` passes clean

## What this achieves

A banker landing on the underwrite tab now sees:

```
Underwriting Pipeline

✓  1  Financial Data      47 facts across 3 periods
✓  2  Risk Assessment     BB+ · 975 bps
✓  3  Research            Research complete
→  4  Credit Memo                           [Generate Credit Memo]
⊘  5  Committee Packet    ↳ Credit memo must be generated first
```

No hidden prerequisites. No 500 errors from missing upstream data. One action at a time.
