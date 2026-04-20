# Phase 52 — Cockpit Redesign
## Claude Code Implementation Spec
**Status: READY FOR IMPLEMENTATION**
**Stack: Next.js, TypeScript, Tailwind, Supabase**
**Repo root: ~/Buddy-The-Underwriter**

---

## Context You Must Read First

Before touching any file, read these in order:
```
src/components/deals/DealCockpitClient.tsx          ← layout root
src/components/deals/cockpit/panels/SecondaryTabsPanel.tsx  ← tab system
src/components/deals/cockpit/columns/LeftColumn.tsx ← what moves
src/components/deals/DealIntakeCard.tsx             ← has the CSS bug
src/components/deals/DealHealthPanel.tsx            ← moves to Story tab
src/components/deals/BankerVoicePanel.tsx           ← moves to Story tab
src/app/(app)/deals/[dealId]/cockpit/page.tsx       ← server component
```

---

## What Is Being Built

The cockpit currently has:
- A 3-column grid (left = 4 stacked panels, center = checklist, right = readiness)
- Secondary tabs below (Setup / Portal / Underwriting / Spreads / Timeline)
- DealHealthPanel and BankerVoicePanel bolted below everything as afterthoughts

Target state:
- A single compact **Status Strip** replacing the 3-column grid
- Five clean **Workspace Tabs** (Setup / Story / Documents / Underwriting / Timeline)
- **Story tab** is new — this is where the banker tells the story of the deal
- DealHealthPanel and BankerVoicePanel move inside Story tab
- No orphaned panels anywhere

---

## Step 1 — Fix the Borrower Input CSS Bug

**File:** `src/components/deals/DealIntakeCard.tsx`

Find every `<input` and `<textarea` element. Add these classes to each one:
`text-white bg-neutral-950 placeholder:text-neutral-500`

These inputs already have correct React state — the bug is purely CSS. Text is invisible because it inherits a light color against a transparent background.

The three affected inputs are:
- Borrower Name input (has `placeholder="Optional"`)
- Borrower Email input (has `placeholder="Optional"`)  
- Borrower Phone input (has `placeholder="Optional"`)

Also fix the select element — add `text-neutral-100 bg-neutral-950` to the loan type `<select>`.

**Verify:** After this change, open the Setup tab and confirm you can see text as you type in the borrower fields.

---

## Step 2 — Build StatusChip Component

**Create:** `src/components/deals/cockpit/StatusChip.tsx`

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SafeBoundary } from "@/components/SafeBoundary";

type StatusChipProps = {
  icon: string;           // material symbol name
  label: string;          // e.g. "Documents"
  summary: string;        // e.g. "9/9 ✓" or "Ready"
  status: "ok" | "warn" | "error" | "neutral";
  defaultOpen?: boolean;
  chipKey: string;        // used for localStorage persistence
  dealId: string;
  children?: React.ReactNode; // expanded panel content
};

const STATUS_COLORS = {
  ok:      "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
  warn:    "border-amber-500/30 bg-amber-500/5 text-amber-300",
  error:   "border-rose-500/30 bg-rose-500/5 text-rose-300",
  neutral: "border-white/10 bg-white/5 text-white/60",
};

const SUMMARY_COLORS = {
  ok:      "text-emerald-400",
  warn:    "text-amber-400",
  error:   "text-rose-400",
  neutral: "text-white/40",
};

export function StatusChip({
  icon, label, summary, status, defaultOpen = false,
  chipKey, dealId, children,
}: StatusChipProps) {
  const storageKey = `chip:${dealId}:${chipKey}`;
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return defaultOpen;
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? stored === "1" : defaultOpen;
    } catch {
      return defaultOpen;
    }
  });

  const toggle = () => {
    if (!children) return;
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { }
  };

  return (
    <div className="flex-shrink-0">
      <button
        type="button"
        onClick={toggle}
        disabled={!children}
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
          STATUS_COLORS[status],
          children ? "cursor-pointer hover:opacity-80" : "cursor-default",
        )}
      >
        <span className="material-symbols-outlined text-[14px]">{icon}</span>
        <span className="text-white/70">{label}</span>
        <span className={cn("font-semibold", SUMMARY_COLORS[status])}>{summary}</span>
        {children && (
          <span className="material-symbols-outlined text-[12px] text-white/30">
            {open ? "expand_less" : "expand_more"}
          </span>
        )}
      </button>

      {open && children && (
        <div className="absolute z-20 mt-2 w-[480px] max-w-[90vw] rounded-2xl border border-white/10 bg-[#0d0d0f] shadow-2xl">
          <SafeBoundary>
            {children}
          </SafeBoundary>
        </div>
      )}
    </div>
  );
}
```

---

## Step 3 — Build StatusStrip Component

**Create:** `src/components/deals/cockpit/StatusStrip.tsx`

This replaces the entire 3-column grid. It reads live data from the cockpit context and the lifecycle state, and renders expandable chips.

```tsx
"use client";

import { cn } from "@/lib/utils";
import { SafeBoundary } from "@/components/SafeBoundary";
import { StatusChip } from "./StatusChip";
import { CoreDocumentsPanel } from "./panels/CoreDocumentsPanel";
import { YearAwareChecklistPanel } from "./panels/YearAwareChecklistPanel";
import { PipelinePanel } from "./panels/PipelinePanel";
import { ReadinessPanel } from "./panels/ReadinessPanel";
import { PrimaryCTAButton } from "./panels/PrimaryCTAButton";
import { useCockpitData } from "@/buddy/cockpit";
import type { LifecycleState } from "@/buddy/lifecycle/client";

type StatusStripProps = {
  dealId: string;
  isAdmin?: boolean;
  gatekeeperPrimaryRouting?: boolean;
  unifiedLifecycleState?: LifecycleState | null;
  onAdvance?: () => void;
};

export function StatusStrip({
  dealId,
  isAdmin = false,
  gatekeeperPrimaryRouting = false,
  unifiedLifecycleState,
  onAdvance,
}: StatusStripProps) {
  const { lifecycleState } = useCockpitData();
  const state = lifecycleState ?? unifiedLifecycleState;
  const derived = state?.derived;

  // Document status
  const docPct = derived?.documentsReadinessPct ?? 0;
  const docStatus = docPct >= 100 ? "ok" : docPct > 0 ? "warn" : "neutral";
  const docSummary = docPct >= 100 ? "Complete ✓" : `${Math.round(docPct)}%`;

  // Checklist status
  const checklistPct = derived?.checklistPct ?? null;
  const checklistStatus = checklistPct != null && checklistPct >= 100 ? "ok"
    : checklistPct != null && checklistPct > 0 ? "warn" : "neutral";
  const checklistSummary = checklistPct != null ? (checklistPct >= 100 ? "100% ✓" : `${Math.round(checklistPct)}%`) : "—";

  // Pipeline
  const snapshotReady = derived?.financialSnapshotExists ?? false;
  const pipelineStatus = snapshotReady ? "ok" : "neutral";
  const pipelineSummary = snapshotReady ? "Snapshot ready" : "Pending";

  // Readiness
  const blockers = state?.blockers ?? [];
  const readinessStatus = blockers.length === 0 ? "ok" : "warn";
  const readinessSummary = blockers.length === 0
    ? (state?.stage ? state.stage.replace(/_/g, " ") : "Ready")
    : `${blockers.length} blocker${blockers.length !== 1 ? "s" : ""}`;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
      <div className="px-4 py-3 flex items-center gap-2 flex-wrap relative">
        {/* Status chips */}
        <SafeBoundary>
          <StatusChip
            icon="folder_open"
            label="Documents"
            summary={docSummary}
            status={docStatus}
            chipKey="docs"
            dealId={dealId}
          >
            <div className="p-4">
              <CoreDocumentsPanel dealId={dealId} gatekeeperPrimaryRouting={gatekeeperPrimaryRouting} />
            </div>
          </StatusChip>
        </SafeBoundary>

        <SafeBoundary>
          <StatusChip
            icon="checklist"
            label="Checklist"
            summary={checklistSummary}
            status={checklistStatus}
            chipKey="checklist"
            dealId={dealId}
          >
            <div className="p-4">
              <YearAwareChecklistPanel dealId={dealId} />
            </div>
          </StatusChip>
        </SafeBoundary>

        <SafeBoundary>
          <StatusChip
            icon="bolt"
            label="Pipeline"
            summary={pipelineSummary}
            status={pipelineStatus}
            chipKey="pipeline"
            dealId={dealId}
          >
            <div className="p-4">
              <PipelinePanel dealId={dealId} isAdmin={isAdmin} />
            </div>
          </StatusChip>
        </SafeBoundary>

        <SafeBoundary>
          <StatusChip
            icon="flag"
            label="Readiness"
            summary={readinessSummary}
            status={readinessStatus}
            chipKey="readiness"
            dealId={dealId}
          >
            <div className="p-4">
              <ReadinessPanel dealId={dealId} isAdmin={isAdmin} onAdvance={onAdvance} />
            </div>
          </StatusChip>
        </SafeBoundary>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Primary CTA */}
        <SafeBoundary>
          <PrimaryCTAButton dealId={dealId} isAdmin={isAdmin} />
        </SafeBoundary>
      </div>
    </div>
  );
}
```

---

## Step 4 — Build StoryPanel Component

**Create:** `src/components/deals/cockpit/panels/StoryPanel.tsx`

This is the most important new component. Read it carefully before implementing.

**Data sources:**
- BIE questions: `GET /api/deals/${dealId}/story/questions` — we need to create this route (see Step 4a)
- Gap queue: `GET /api/deals/${dealId}/gap-queue` — already exists
- Memo overrides: `GET /api/deals/${dealId}/memo-overrides` — need to check if exists, create if not (see Step 4b)

**Step 4a — Create the BIE questions API route**

**Create:** `src/app/api/deals/[dealId]/story/questions/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Returns Buddy's questions for the Story tab.
 * Sources:
 * 1. BIE Underwriting Questions — from buddy_research_narratives sections
 *    where title = "Underwriting Questions", version = 3
 * 2. Missing fact gaps — from deal_gap_queue where gap_type = 'missing_fact'
 */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const sb = supabaseAdmin();

    // Load latest BIE narrative (version 3)
    const { data: missionRow } = await sb
      .from("buddy_research_missions")
      .select("id")
      .eq("deal_id", dealId)
      .eq("bank_id", bankPick.bankId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let bieQuestions: string[] = [];

    if (missionRow?.id) {
      const { data: narrative } = await sb
        .from("buddy_research_narratives")
        .select("sections")
        .eq("mission_id", missionRow.id)
        .eq("version", 3)
        .maybeSingle();

      if (narrative?.sections && Array.isArray(narrative.sections)) {
        // sections is an array: [{ title, sentences: [{ text }] }]
        const uqSection = narrative.sections.find(
          (s: any) => s.title === "Underwriting Questions"
        );
        if (uqSection?.sentences) {
          // Each sentence.text contains newline-separated questions
          for (const sentence of uqSection.sentences) {
            const raw = String(sentence.text ?? "").trim();
            if (!raw) continue;
            // Split on newlines or numbered list patterns
            const lines = raw.split(/\n+/).map((l: string) => l.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
            bieQuestions.push(...lines);
          }
        }
      }
    }

    // Load missing fact gaps
    const { data: gaps } = await sb
      .from("deal_gap_queue")
      .select("id, fact_key, description, resolution_prompt")
      .eq("deal_id", dealId)
      .eq("bank_id", bankPick.bankId)
      .eq("status", "open")
      .eq("gap_type", "missing_fact")
      .order("priority", { ascending: false });

    const missingFacts = (gaps ?? []).map((g: any) => ({
      id: g.id,
      fact_key: g.fact_key,
      question: g.resolution_prompt ?? g.description,
      source: "missing_fact" as const,
    }));

    const questions = [
      ...missingFacts.map((f) => ({ ...f, source: "missing_fact" as const })),
      ...bieQuestions.map((q, i) => ({
        id: `bie_${i}`,
        fact_key: null,
        question: q,
        source: "bie" as const,
      })),
    ];

    return NextResponse.json({
      ok: true,
      questions,
      hasResearch: bieQuestions.length > 0,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
```

**Step 4b — Check if memo-overrides GET route exists**

Look for `src/app/api/deals/[dealId]/memo-overrides/route.ts`.

If it does NOT exist, create it:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const sb = supabaseAdmin();
    const { data } = await sb
      .from("deal_memo_overrides")
      .select("overrides")
      .eq("deal_id", dealId)
      .eq("bank_id", bankPick.bankId)
      .maybeSingle();

    return NextResponse.json({ ok: true, overrides: (data?.overrides ?? {}) });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const body = await req.json();
    const { key, value } = body as { key: string; value: string };

    if (!key) return NextResponse.json({ ok: false, error: "missing key" }, { status: 400 });

    const sb = supabaseAdmin();

    // Upsert — merge the single key into the overrides jsonb
    const { data: existing } = await sb
      .from("deal_memo_overrides")
      .select("id, overrides")
      .eq("deal_id", dealId)
      .eq("bank_id", bankPick.bankId)
      .maybeSingle();

    const merged = { ...(existing?.overrides ?? {}), [key]: value };

    if (existing?.id) {
      await sb
        .from("deal_memo_overrides")
        .update({ overrides: merged, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await sb.from("deal_memo_overrides").insert({
        deal_id: dealId,
        bank_id: bankPick.bankId,
        overrides: merged,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
```

**Step 4c — Build the StoryPanel itself**

**Create:** `src/components/deals/cockpit/panels/StoryPanel.tsx`

```tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { SafeBoundary } from "@/components/SafeBoundary";
import DealHealthPanel from "@/components/deals/DealHealthPanel";
import BankerVoicePanel from "@/components/deals/BankerVoicePanel";
import TranscriptUploadPanel from "@/components/deals/TranscriptUploadPanel";

// Guided story fields — maps label to override key and placeholder
const STORY_FIELDS = [
  {
    key: "use_of_proceeds",
    label: "Use of Proceeds",
    placeholder: "What exactly will the loan proceeds purchase or fund? Be specific — equipment make/model, property address, working capital purpose.",
  },
  {
    key: "principal_background",
    label: "Management Background",
    placeholder: "How long has the principal been in this specific industry? Any prior relevant businesses or exits?",
  },
  {
    key: "collateral_description",
    label: "Collateral",
    placeholder: "Property address, appraised value, who holds the appraisal, lien position, advance rate used.",
  },
  {
    key: "banking_relationship",
    label: "Banking Relationship",
    placeholder: "How long has this borrower banked here? Existing deposit accounts, prior loan history.",
  },
  {
    key: "key_strengths",
    label: "Deal Strengths",
    placeholder: "What makes this credit compelling? What would you tell the credit committee?",
  },
  {
    key: "key_weaknesses",
    label: "Deal Weaknesses & Mitigants",
    placeholder: "What concerns you most about this deal, and how is each risk mitigated?",
  },
] as const;

type Question = {
  id: string;
  fact_key: string | null;
  question: string;
  source: "missing_fact" | "bie";
};

type StoryPanelProps = {
  dealId: string;
};

export default function StoryPanel({ dealId }: StoryPanelProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [hasResearch, setHasResearch] = useState(false);

  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [overridesLoading, setOverridesLoading] = useState(true);

  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [showTranscript, setShowTranscript] = useState(false);

  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Load questions
  useEffect(() => {
    fetch(`/api/deals/${dealId}/story/questions`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setQuestions(data.questions ?? []);
          setHasResearch(data.hasResearch ?? false);
        }
      })
      .finally(() => setQuestionsLoading(false));
  }, [dealId]);

  // Load existing overrides
  useEffect(() => {
    fetch(`/api/deals/${dealId}/memo-overrides`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) setOverrides(data.overrides ?? {});
      })
      .finally(() => setOverridesLoading(false));
  }, [dealId]);

  // Debounced save for story fields
  const saveField = useCallback((key: string, value: string) => {
    if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key]);
    debounceRefs.current[key] = setTimeout(async () => {
      setSavingKey(key);
      try {
        await fetch(`/api/deals/${dealId}/memo-overrides`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        setOverrides(prev => ({ ...prev, [key]: value }));
      } finally {
        setSavingKey(null);
      }
    }, 800);
  }, [dealId]);

  // Save question answer
  const saveQuestionAnswer = useCallback((questionId: string, value: string) => {
    setQuestionAnswers(prev => ({ ...prev, [questionId]: value }));
    const key = `buddy_question_${questionId}`;
    if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key]);
    debounceRefs.current[key] = setTimeout(async () => {
      await fetch(`/api/deals/${dealId}/memo-overrides`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
    }, 800);
  }, [dealId]);

  const glassSection = "rounded-xl border border-white/8 bg-white/[0.02] p-4";
  const sectionLabel = "text-[10px] font-bold uppercase tracking-widest text-white/40 mb-3";

  return (
    <div className="space-y-4">

      {/* ── Section 1: Buddy's Questions ── */}
      <div className={glassSection}>
        <div className={sectionLabel}>Buddy's Questions</div>

        {questionsLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => (
              <div key={i} className="h-16 rounded-lg bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : questions.length === 0 ? (
          <div className="text-center py-6">
            {hasResearch ? (
              <p className="text-sm text-white/40">No open questions — all items addressed.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-white/40">
                  Run Research to generate Buddy's analysis and underwriting questions.
                </p>
                <a
                  href={`/credit-memo/${dealId}/canonical`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/60 hover:bg-white/10"
                >
                  <span className="material-symbols-outlined text-[14px]">science</span>
                  Go to Credit Memo to Run Research
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {questions.map((q) => {
              const savedAnswer = questionAnswers[q.id] ?? overrides[`buddy_question_${q.id}`] ?? "";
              return (
                <div
                  key={q.id}
                  className="rounded-lg border border-white/8 bg-black/20 p-3"
                >
                  <div className="flex items-start gap-2 mb-2">
                    <span className="material-symbols-outlined text-[16px] text-amber-400 mt-0.5 flex-shrink-0">
                      help
                    </span>
                    <p className="text-sm text-white/80 leading-relaxed">{q.question}</p>
                  </div>
                  <textarea
                    value={savedAnswer}
                    onChange={(e) => saveQuestionAnswer(q.id, e.target.value)}
                    placeholder="Type your answer..."
                    rows={2}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-white/20 resize-none"
                  />
                  {savedAnswer && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-400">
                      <span className="material-symbols-outlined text-[12px]">check_circle</span>
                      Saved
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Section 2: Deal Story Fields ── */}
      <div className={glassSection}>
        <div className={sectionLabel}>Deal Story</div>
        <p className="text-xs text-white/35 mb-4 -mt-1">
          This information feeds directly into the credit memo. Documents cannot provide it — only you can.
        </p>

        {overridesLoading ? (
          <div className="space-y-3">
            {STORY_FIELDS.map(f => (
              <div key={f.key} className="h-20 rounded-lg bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {STORY_FIELDS.map((field) => {
              const current = overrides[field.key] ?? "";
              const isSaving = savingKey === field.key;
              return (
                <div key={field.key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-white/60 uppercase tracking-wide">
                      {field.label}
                    </label>
                    {current && !isSaving && (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                        <span className="material-symbols-outlined text-[12px]">check_circle</span>
                        Saved
                      </span>
                    )}
                    {isSaving && (
                      <span className="text-[10px] text-white/30 animate-pulse">Saving...</span>
                    )}
                  </div>
                  <textarea
                    value={current}
                    onChange={(e) => {
                      const val = e.target.value;
                      setOverrides(prev => ({ ...prev, [field.key]: val }));
                      saveField(field.key, val);
                    }}
                    placeholder={field.placeholder}
                    rows={3}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 outline-none focus:border-white/20 resize-none leading-relaxed"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Section 3: Credit Interview ── */}
      <div className={glassSection}>
        <div className={sectionLabel}>Credit Interview</div>
        <p className="text-xs text-white/35 mb-4 -mt-1">
          Start a voice session — Buddy will ask about this deal based on what's missing. Or paste a call transcript.
        </p>

        {/* Deal Health — compact, shows what still needs work */}
        <div className="mb-4">
          <SafeBoundary>
            <DealHealthPanel dealId={dealId} />
          </SafeBoundary>
        </div>

        {/* Voice interview */}
        <SafeBoundary>
          <BankerVoicePanel dealId={dealId} />
        </SafeBoundary>

        {/* Transcript upload — collapsed by default */}
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowTranscript(v => !v)}
            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60"
          >
            <span className="material-symbols-outlined text-[14px]">
              {showTranscript ? "expand_less" : "expand_more"}
            </span>
            Or paste a call transcript
          </button>

          {showTranscript && (
            <div className="mt-3">
              <SafeBoundary>
                <TranscriptUploadPanel dealId={dealId} />
              </SafeBoundary>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## Step 5 — Build DocumentsTabPanel

**Create:** `src/components/deals/cockpit/panels/DocumentsTabPanel.tsx`

```tsx
"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import DealFilesCard from "@/components/deals/DealFilesCard";
import { CoreDocumentsPanel } from "./CoreDocumentsPanel";
import { ArtifactPipelinePanel } from "./ArtifactPipelinePanel";

type Props = {
  dealId: string;
  isAdmin?: boolean;
  gatekeeperPrimaryRouting?: boolean;
};

export function DocumentsTabPanel({ dealId, isAdmin = false, gatekeeperPrimaryRouting = false }: Props) {
  return (
    <div className="space-y-4">
      <SafeBoundary>
        <DealFilesCard dealId={dealId} />
      </SafeBoundary>
      <SafeBoundary>
        <CoreDocumentsPanel dealId={dealId} gatekeeperPrimaryRouting={gatekeeperPrimaryRouting} />
      </SafeBoundary>
      <SafeBoundary>
        <ArtifactPipelinePanel dealId={dealId} />
      </SafeBoundary>
    </div>
  );
}
```

---

## Step 6 — Update SecondaryTabsPanel

**File:** `src/components/deals/cockpit/panels/SecondaryTabsPanel.tsx`

Replace the entire file with the following. Key changes:
- New tab list: `setup | story | documents | underwriting | timeline | (admin)`
- Removed: `portal` tab, `spreads` tab
- Added: `StoryPanel` import and usage
- Added: `DocumentsTabPanel` import and usage
- Setup tab: removed AI Doc Recognition button from here (it's now in Documents tab)
- Portal content: moved into Setup tab as a collapsible "Borrower Portal" section
- Default tab changes: `story` if deal is ignited, `setup` if not

**The new TABS constant:**
```tsx
const TABS = [
  { key: "setup",        label: "Setup",        icon: "settings" },
  { key: "story",        label: "Story",        icon: "auto_stories" },
  { key: "documents",    label: "Documents",    icon: "folder_open" },
  { key: "underwriting", label: "Underwriting", icon: "analytics" },
  { key: "timeline",     label: "Timeline",     icon: "timeline" },
] as const;
```

**The new defaultTab logic:**
```tsx
const defaultTab: TabKey = (() => {
  if (urlTab && VALID_TAB_KEYS.has(urlTab)) return urlTab;
  if (!intakeGateEnabled) {
    // If deal is ignited (has an intake phase), default to story
    return intakePhase ? "story" : "setup";
  }
  if (intakePhase === "CLASSIFIED_PENDING_CONFIRMATION") return "intake";
  return intakePhase ? "story" : "setup";
})();
```

**The story tab content block:**
```tsx
{activeTab === "story" && (
  <>
    <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Deal Story</h3>
    <SafeBoundary>
      <StoryPanel dealId={dealId} />
    </SafeBoundary>
  </>
)}
```

**The documents tab content block:**
```tsx
{activeTab === "documents" && (
  <>
    <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Documents</h3>
    <SafeBoundary>
      <DocumentsTabPanel
        dealId={dealId}
        isAdmin={isAdmin}
        gatekeeperPrimaryRouting={gatekeeperPrimaryRouting}
      />
    </SafeBoundary>
  </>
)}
```

**The setup tab — simplified to three sections:**

Section 1: Loan Details — keep `DealIntakeCard` and `LoanRequestsSection`, nothing else.

Section 2: Borrower — keep `BorrowerAttachmentCard`.

Section 3: Borrower Portal — collapsed by default using a `<details>` or a toggle button. Contains `BorrowerRequestComposerCard` + `BorrowerUploadLinksCard`. Label it "Borrower Portal" with a `link` icon.

Remove from Setup: `UploadAuditCard` (admin only — move to Admin tab if needed).

**The underwriting tab** — add a "View Spreads" link button at the bottom:
```tsx
<a
  href={`/deals/${dealId}/spreads`}
  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/60 hover:bg-white/10 w-full justify-center mt-2"
>
  <span className="material-symbols-outlined text-[14px]">table_chart</span>
  View Classic Spreads
</a>
```

**Remove Portal tab entirely.** Remove the `portal` key from TABS and VALID_TAB_KEYS. Remove the portal tab content block.

**Remove Spreads tab entirely.** The `handleTabChange` function currently navigates to spreads when tab === "spreads" — remove this and replace with the link in Underwriting.

**Add the new `gatekeeperPrimaryRouting` prop** to the `Props` type and pass it down to `DocumentsTabPanel`.

---

## Step 7 — Update DealCockpitClient

**File:** `src/components/deals/DealCockpitClient.tsx`

Replace the 3-column grid section with `StatusStrip`. The current grid is:
```tsx
<div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
  <div id="cockpit-documents" className="lg:col-span-4 order-3 lg:order-1">
    <LeftColumn ... />
  </div>
  <div className="lg:col-span-4 order-2 lg:order-2">
    <CenterColumn ... />
  </div>
  <div className="lg:col-span-4 order-1 lg:order-3">
    <RightColumn ... />
  </div>
</div>
```

Replace it with:
```tsx
<SafeBoundary>
  <StatusStrip
    dealId={dealId}
    isAdmin={isAdmin}
    gatekeeperPrimaryRouting={gatekeeperPrimaryRouting}
    unifiedLifecycleState={unifiedLifecycleState}
    onAdvance={() => router.refresh()}
  />
</SafeBoundary>
```

Add the import:
```tsx
import { StatusStrip } from "@/components/deals/cockpit/StatusStrip";
```

Remove these imports (they're now inside StatusStrip):
```
import { LeftColumn } from "@/components/deals/cockpit/columns/LeftColumn";
import { CenterColumn } from "@/components/deals/cockpit/columns/CenterColumn";
import { RightColumn } from "@/components/deals/cockpit/columns/RightColumn";
```

Pass `gatekeeperPrimaryRouting` to `SecondaryTabsPanel`:
```tsx
<SecondaryTabsPanel
  ...existing props...
  gatekeeperPrimaryRouting={gatekeeperPrimaryRouting}
/>
```

---

## Step 8 — Update cockpit/page.tsx

**File:** `src/app/(app)/deals/[dealId]/cockpit/page.tsx`

Remove these two sections from the bottom of the returned JSX:
```tsx
<div className="container mx-auto px-6 mt-4 space-y-4">
  <DealHealthPanel dealId={dealId} />
  <BankerVoicePanel dealId={dealId} />
</div>
```

Remove these imports:
```tsx
import DealHealthPanel from "@/components/deals/DealHealthPanel";
import BankerVoicePanel from "@/components/deals/BankerVoicePanel";
```

They now live inside `StoryPanel`. Do not delete the component files — only the usage in `page.tsx`.

---

## Step 9 — tsc Check

Run from repo root:
```bash
npx tsc --noEmit
```

Fix any type errors. Common issues to watch for:
- `gatekeeperPrimaryRouting` prop not in `SecondaryTabsPanel` Props type — add it
- `TranscriptUploadPanel` import path — verify it exports a default
- `useCockpitData` hook — verify it exports `lifecycleState`; if the context doesn't expose this, use `unifiedLifecycleState` passed as prop instead

---

## Step 10 — Verify

Open the cockpit for deal `ffcc9733-f866-47fc-83f9-7c08403cea71`.

Check:
1. ✅ No 3-column grid — replaced by Status Strip row of chips
2. ✅ Five tabs visible: Setup / Story / Documents / Underwriting / Timeline
3. ✅ Story tab opens by default
4. ✅ Story tab shows Buddy's questions (3 BIE underwriting questions for Samaritus)
5. ✅ Story tab shows 6 guided fields (Use of Proceeds, Management Background, etc.)
6. ✅ Story tab shows DealHealthPanel and BankerVoicePanel
7. ✅ Setup tab: borrower name/email/phone inputs are visible when typing
8. ✅ Documents tab: shows DealFilesCard + CoreDocumentsPanel + ArtifactPipelinePanel
9. ✅ No DealHealthPanel or BankerVoicePanel dangling below the cockpit
10. ✅ No Portal tab in the tab bar

---

## API Routes Summary

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/deals/[dealId]/story/questions` | GET | BIE underwriting questions + missing fact gaps |
| `/api/deals/[dealId]/memo-overrides` | GET | Load existing story field values |
| `/api/deals/[dealId]/memo-overrides` | PATCH | Save a single story field value |

The PATCH route accepts `{ key: string, value: string }` and merges into the `overrides` jsonb.

---

## Notes on Existing Components

**Do not modify:**
- `DealHealthPanel.tsx` — reused as-is inside StoryPanel
- `BankerVoicePanel.tsx` — reused as-is inside StoryPanel
- `TranscriptUploadPanel.tsx` — reused as-is inside StoryPanel
- Any panel inside `cockpit/panels/` — reused as-is inside StatusStrip chips
- `LoanRequestsSection` — reused as-is in Setup tab

**Do not delete:**
- `LeftColumn.tsx`, `CenterColumn.tsx`, `RightColumn.tsx` — no longer used by cockpit but keep for safety
- `DealHealthPanel.tsx`, `BankerVoicePanel.tsx` — moved, not deleted

---

## Known Data Shape (verified against live DB)

**`buddy_research_narratives.sections`** is a JSONB array:
```json
[
  { "title": "Underwriting Questions", "sentences": [{ "text": "Question 1\nQuestion 2\nQuestion 3", "citations": [] }] },
  { "title": "Credit Thesis", "sentences": [...] },
  ...
]
```

The `text` field of each Underwriting Questions sentence contains newline-separated questions. Split on `\n+` and strip leading `1. `, `2. ` etc. to get clean questions.

**`deal_memo_overrides.overrides`** is a JSONB object (flat key-value):
```json
{
  "business_description": "...",
  "collateral_description": "...",
  "revenue_mix": "...",
  "seasonality": "..."
}
```

The PATCH route must merge (not replace) when upserting.
