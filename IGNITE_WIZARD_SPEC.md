# Research Readiness Wizard — "Ignite" 🚀
# Full Implementation Spec for Claude Code

---

## What This Builds

A step-by-step intelligent wizard that surfaces every blocker preventing Buddy from
running committee-grade research — and clears them one at a time with minimal banker
effort. The centerpiece is AI-powered NAICS lookup: the banker describes the business
in plain English and Buddy picks the code. The wizard then fires research automatically
when all blockers are cleared.

**Visual style:** Dark, premium, modal — consistent with Buddy's cockpit UI. Each
step feels like a focused task, not a form. Progress is visible and satisfying.

---

## Part 1 — Two New API Routes

### Route A: `POST /api/deals/[dealId]/borrower/update`

**File: `src/app/api/deals/[dealId]/borrower/update/route.ts`**

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const BodySchema = z.object({
  naics_code: z.string().min(2).max(10).optional(),
  naics_description: z.string().min(2).max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  legal_name: z.string().min(2).max(200).optional(),
  website: z.string().max(300).optional(),
  banker_summary: z.string().max(2000).optional(),
});

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await req.json());
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Resolve borrower_id from deal
    const { data: deal } = await (sb as any)
      .from("deals")
      .select("borrower_id")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal?.borrower_id) {
      return NextResponse.json({ ok: false, error: "no_borrower_linked" }, { status: 400 });
    }

    // Only patch provided fields
    const patch: Record<string, string> = {};
    if (body.naics_code !== undefined) patch.naics_code = body.naics_code;
    if (body.naics_description !== undefined) patch.naics_description = body.naics_description;
    if (body.city !== undefined) patch.city = body.city;
    if (body.state !== undefined) patch.state = body.state;
    if (body.legal_name !== undefined) patch.legal_name = body.legal_name;
    if (body.website !== undefined) patch.website = body.website;

    if (Object.keys(patch).length === 0 && !body.banker_summary) {
      return NextResponse.json({ ok: false, error: "nothing_to_update" }, { status: 400 });
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await (sb as any)
        .from("borrowers")
        .update(patch)
        .eq("id", deal.borrower_id);

      if (error) {
        return NextResponse.json(
          { ok: false, error: "update_failed", detail: error.message },
          { status: 500 },
        );
      }
    }

    // banker_summary goes to deal_memo_overrides
    if (body.banker_summary !== undefined) {
      await (sb as any)
        .from("deal_memo_overrides")
        .upsert(
          { deal_id: dealId, bank_id: access.bankId, overrides: { banker_summary: body.banker_summary } },
          { onConflict: "deal_id,bank_id" },
        );
    }

    void writeEvent({
      dealId,
      kind: "deal.borrower.wizard_updated",
      actorUserId: access.userId,
      scope: "borrower",
      meta: { fields_updated: Object.keys(patch), has_banker_summary: !!body.banker_summary },
    });

    return NextResponse.json({ ok: true, updated: Object.keys(patch) });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
```

---

### Route B: `POST /api/deals/[dealId]/research/naics-suggest`

AI-powered NAICS lookup from plain-English business description. Uses the Anthropic API
(already wired in the codebase via `getAIProvider` or direct fetch). Returns top 3-5
candidates with confidence.

**File: `src/app/api/deals/[dealId]/research/naics-suggest/route.ts`**

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BodySchema = z.object({
  description: z.string().min(10).max(2000),
  company_name: z.string().max(200).optional(),
});

type NaicsSuggestion = {
  code: string;
  title: string;
  confidence: "high" | "medium" | "low";
  why: string;
};

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await req.json());
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "no_api_key" }, { status: 500 });
    }

    const prompt = `You are a commercial bank underwriter. Given the following description of a business,
return the 3 most likely NAICS codes for this business. Be precise — the code will be used to
trigger industry research for a loan underwriting system.

Business name: ${body.company_name ?? "Not provided"}
Description: ${body.description}

Return ONLY valid JSON in exactly this shape — no preamble, no markdown:
{
  "suggestions": [
    {
      "code": "531311",
      "title": "Residential Property Managers",
      "confidence": "high",
      "why": "One-sentence explanation of why this code fits"
    }
  ]
}

Rules:
- Return exactly 3 suggestions, ordered best-first
- Use real 6-digit NAICS codes from the 2022 NAICS manual
- confidence: "high" = very clear match, "medium" = likely match, "low" = possible match
- why: one sentence max, plain English, explain the fit`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ ok: false, error: "ai_error" }, { status: 500 });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";

    let suggestions: NaicsSuggestion[] = [];
    try {
      const clean = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(clean);
      suggestions = parsed.suggestions ?? [];
    } catch {
      return NextResponse.json({ ok: false, error: "parse_error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, suggestions });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
```

---

## Part 2 — The Wizard Component

**File: `src/components/deals/IgniteWizard.tsx`**

This is the main deliverable. Build it as a full-screen modal with a dark theme.
The component fetches blockers from the flight-deck API and generates steps dynamically.

### Architecture

```
IgniteWizard (modal shell)
├── StepTracker (left rail: shows all steps with status)
├── ActiveStep (right: current step content)
│   ├── StepNaics (NAICS lookup with AI)
│   ├── StepGeography (city + state)
│   ├── StepBorrowerName (rename deal + fix legal name)
│   ├── StepBankerSummary (business description)
│   ├── StepOwnershipCleanup (fix malformed entities)
│   └── StepLaunchResearch (final confirmation + fire)
└── ProgressBar (bottom)
```

### Full Component Code

```tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type NaicsSuggestion = {
  code: string;
  title: string;
  confidence: "high" | "medium" | "low";
  why: string;
};

type WizardStep = {
  id: string;
  label: string;
  icon: string;
  description: string;
  status: "pending" | "active" | "done" | "skipped";
  required: boolean;
};

type FlightDeckData = {
  trustGrade: string | null;
  blockers: string[];
  borrower: {
    legal_name: string | null;
    naics_code: string | null;
    city: string | null;
    state: string | null;
  };
  research: {
    status: string | null;
    completed_at: string | null;
  };
};

// ─────────────────────────────────────────────────────────────
// Step definitions (shown in order)
// ─────────────────────────────────────────────────────────────

function buildSteps(deck: FlightDeckData): WizardStep[] {
  const steps: WizardStep[] = [];

  const needsNaics = !deck.borrower.naics_code || deck.borrower.naics_code === "999999";
  const needsGeo = !deck.borrower.city && !deck.borrower.state;
  const needsResearch = !deck.research.status || deck.research.status === "failed";

  if (needsNaics) {
    steps.push({
      id: "naics",
      label: "Industry",
      icon: "category",
      description: "Tell Buddy what this business does",
      status: "pending",
      required: true,
    });
  }

  if (needsGeo) {
    steps.push({
      id: "geography",
      label: "Location",
      icon: "location_on",
      description: "Where does this business operate?",
      status: "pending",
      required: true,
    });
  }

  if (!deck.borrower.legal_name || deck.borrower.legal_name.length < 3) {
    steps.push({
      id: "name",
      label: "Entity Name",
      icon: "business",
      description: "Confirm the borrower's legal name",
      status: "pending",
      required: true,
    });
  }

  // Always include banker context (soft — adds color to research)
  steps.push({
    id: "context",
    label: "Business Context",
    icon: "description",
    description: "Add any context Buddy can't get from documents",
    status: "pending",
    required: false,
  });

  // Launch step is always last
  steps.push({
    id: "launch",
    label: "Run Research",
    icon: "rocket_launch",
    description: "Fire Buddy's intelligence engine",
    status: "pending",
    required: true,
  });

  return steps;
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────

export function IgniteWizard({
  dealId,
  borrowerName,
  onComplete,
  onClose,
}: {
  dealId: string;
  borrowerName: string;
  onComplete?: () => void;
  onClose: () => void;
}) {
  const [deck, setDeck] = useState<FlightDeckData | null>(null);
  const [steps, setSteps] = useState<WizardStep[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [researchRunning, setResearchRunning] = useState(false);
  const [researchDone, setResearchDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step-specific state
  const [naicsDescription, setNaicsDescription] = useState("");
  const [naicsSuggestions, setNaicsSuggestions] = useState<NaicsSuggestion[]>([]);
  const [naicsLoading, setNaicsLoading] = useState(false);
  const [selectedNaics, setSelectedNaics] = useState<NaicsSuggestion | null>(null);

  const [city, setCity] = useState("");
  const [state, setState] = useState("");

  const [legalName, setLegalName] = useState("");

  const [bankerSummary, setBankerSummary] = useState("");

  // Fetch flight deck on open
  useEffect(() => {
    fetch(`/api/deals/${dealId}/research/flight-deck`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setDeck(data);
          const s = buildSteps(data);
          setSteps(s.map((step, i) => ({ ...step, status: i === 0 ? "active" : "pending" })));
          setCity(data.borrower.city ?? "");
          setState(data.borrower.state ?? "");
          setLegalName(data.borrower.legal_name ?? "");
        }
      })
      .catch(() => setError("Failed to load deal state"))
      .finally(() => setLoading(false));
  }, [dealId]);

  const currentStep = steps[currentIdx];
  const progress = steps.length > 0
    ? Math.round((steps.filter(s => s.status === "done").length / steps.length) * 100)
    : 0;

  // Mark current step done and advance
  const advance = useCallback(() => {
    setSteps(prev => prev.map((s, i) => {
      if (i === currentIdx) return { ...s, status: "done" };
      if (i === currentIdx + 1) return { ...s, status: "active" };
      return s;
    }));
    setCurrentIdx(i => i + 1);
    setError(null);
  }, [currentIdx]);

  // Save NAICS
  const saveNaics = useCallback(async () => {
    if (!selectedNaics) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naics_code: selectedNaics.code,
          naics_description: selectedNaics.title,
          banker_summary: naicsDescription.length > 20 ? naicsDescription : undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Save failed"); return; }
      advance();
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  }, [selectedNaics, naicsDescription, dealId, advance]);

  // Save geography
  const saveGeo = useCallback(async () => {
    if (!city.trim() && !state.trim()) { setError("Enter at least a city or state"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: city.trim(), state: state.trim() }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Save failed"); return; }
      advance();
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  }, [city, state, dealId, advance]);

  // Save legal name
  const saveName = useCallback(async () => {
    if (!legalName.trim() || legalName.trim().length < 3) { setError("Enter a valid legal name"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legal_name: legalName.trim() }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Save failed"); return; }
      advance();
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  }, [legalName, dealId, advance]);

  // Save banker context (optional — can skip)
  const saveContext = useCallback(async () => {
    if (bankerSummary.trim().length > 10) {
      setSaving(true);
      try {
        await fetch(`/api/deals/${dealId}/borrower/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ banker_summary: bankerSummary.trim() }),
        });
      } catch {}
      finally { setSaving(false); }
    }
    advance();
  }, [bankerSummary, dealId, advance]);

  // Launch research
  const launchResearch = useCallback(async () => {
    setResearchRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/research/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Research launch failed"); setResearchRunning(false); return; }
      setResearchDone(true);
      setSteps(prev => prev.map((s, i) => i === currentIdx ? { ...s, status: "done" } : s));
      setTimeout(() => { onComplete?.(); onClose(); }, 2000);
    } catch { setError("Failed to launch research"); setResearchRunning(false); }
  }, [dealId, currentIdx, onComplete, onClose]);

  // AI NAICS lookup
  const lookupNaics = useCallback(async () => {
    if (naicsDescription.trim().length < 15) { setError("Describe the business in a few more words"); return; }
    setNaicsLoading(true);
    setNaicsSuggestions([]);
    setSelectedNaics(null);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/research/naics-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: naicsDescription, company_name: borrowerName }),
      });
      const data = await res.json();
      if (!data.ok) { setError("Couldn't look up NAICS — try again"); return; }
      setNaicsSuggestions(data.suggestions ?? []);
    } catch { setError("Network error"); }
    finally { setNaicsLoading(false); }
  }, [naicsDescription, dealId, borrowerName]);

  // ─── Render ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="text-white/50 text-sm animate-pulse">Loading deal state...</div>
      </div>
    );
  }

  const confidenceColor = (c: NaicsSuggestion["confidence"]) =>
    c === "high" ? "text-emerald-400" : c === "medium" ? "text-amber-400" : "text-white/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        className="bg-[#0f1117] border border-white/10 rounded-2xl w-full shadow-2xl flex overflow-hidden"
        style={{ maxWidth: 860, maxHeight: "calc(100vh - 2rem)", minHeight: 520 }}
      >
        {/* ── Left Rail — Step Tracker ─────────────────────────── */}
        <div className="w-56 bg-[#0a0c12] border-r border-white/[0.06] flex flex-col py-6 flex-shrink-0">
          <div className="px-5 mb-6">
            <div className="text-xs font-bold text-white/80 uppercase tracking-widest">
              🚀 Ignite
            </div>
            <div className="text-[10px] text-white/30 mt-0.5 font-medium">
              Research Readiness
            </div>
          </div>

          {/* Steps */}
          <div className="flex-1 px-3 space-y-1">
            {steps.map((step, i) => {
              const isActive = i === currentIdx;
              const isDone = step.status === "done";
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all ${
                    isActive
                      ? "bg-sky-500/15 border border-sky-500/30"
                      : isDone
                        ? "opacity-60"
                        : "opacity-30"
                  }`}
                >
                  {/* Status indicator */}
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                    isDone
                      ? "bg-emerald-500 text-white"
                      : isActive
                        ? "bg-sky-500 text-white"
                        : "bg-white/10 text-white/40"
                  }`}>
                    {isDone ? "✓" : isActive
                      ? <span className="material-symbols-outlined text-[12px]">{step.icon}</span>
                      : i + 1}
                  </div>
                  <div>
                    <div className={`text-xs font-medium ${isActive ? "text-white" : "text-white/60"}`}>
                      {step.label}
                    </div>
                    {isActive && (
                      <div className="text-[10px] text-white/30 mt-0.5 leading-tight">
                        {step.description}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="px-5 mt-4">
            <div className="flex justify-between text-[10px] text-white/30 mb-1.5">
              <span>Progress</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {/* ── Main Step Content ─────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between px-8 py-5 border-b border-white/[0.06]">
            <div>
              <div className="text-base font-semibold text-white">
                {currentStep?.label ?? "Complete"}
              </div>
              <div className="text-xs text-white/40 mt-0.5">
                {borrowerName} · Step {Math.min(currentIdx + 1, steps.length)} of {steps.length}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white/30 hover:text-white/60 transition-colors text-lg"
            >
              ✕
            </button>
          </div>

          {/* Step body */}
          <div className="flex-1 overflow-y-auto px-8 py-6">

            {error && (
              <div className="mb-4 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {/* ── NAICS Step ─────────────────────────────────────── */}
            {currentStep?.id === "naics" && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-medium text-white mb-1">
                    Describe what this business does
                  </div>
                  <div className="text-xs text-white/40 mb-3">
                    Write a sentence or two in plain English — Buddy will find the right industry code.
                    The more specific, the better.
                  </div>
                  <textarea
                    rows={4}
                    value={naicsDescription}
                    onChange={e => { setNaicsDescription(e.target.value); setNaicsSuggestions([]); setSelectedNaics(null); }}
                    placeholder="e.g. Luxury yacht charter and boat rental business serving corporate and leisure clients in the Hamptons, NY. Operates a fleet of motor yachts and sailing vessels from a private marina."
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50 resize-none leading-relaxed"
                  />
                </div>

                <button
                  onClick={lookupNaics}
                  disabled={naicsLoading || naicsDescription.trim().length < 15}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    naicsLoading
                      ? "bg-white/5 text-white/30 cursor-wait"
                      : naicsDescription.trim().length < 15
                        ? "bg-white/5 text-white/20 cursor-not-allowed"
                        : "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20"
                  }`}
                >
                  {naicsLoading ? (
                    <>
                      <span className="animate-spin material-symbols-outlined text-[16px]">progress_activity</span>
                      Buddy is thinking...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                      Find Industry Code
                    </>
                  )}
                </button>

                {/* Suggestions */}
                {naicsSuggestions.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] text-white/30 uppercase tracking-widest font-semibold">
                      Buddy's Suggestions — pick one
                    </div>
                    {naicsSuggestions.map(s => (
                      <button
                        key={s.code}
                        onClick={() => setSelectedNaics(s)}
                        className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all ${
                          selectedNaics?.code === s.code
                            ? "border-sky-500/60 bg-sky-500/10"
                            : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm font-bold text-white">{s.code}</span>
                            <span className="text-sm text-white/80">{s.title}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-semibold uppercase ${confidenceColor(s.confidence)}`}>
                              {s.confidence}
                            </span>
                            {selectedNaics?.code === s.code && (
                              <span className="text-sky-400 text-[16px] material-symbols-outlined">check_circle</span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-white/40 mt-1.5 leading-relaxed">{s.why}</div>
                      </button>
                    ))}
                    {/* Manual entry option */}
                    <button
                      onClick={() => setSelectedNaics({ code: "manual", title: "Enter manually", confidence: "medium", why: "" })}
                      className="text-xs text-white/30 hover:text-white/50 mt-1 transition-colors"
                    >
                      Don't see the right one? Enter a code manually →
                    </button>
                  </div>
                )}

                {/* Manual entry */}
                {selectedNaics?.code === "manual" && (
                  <div className="flex gap-3">
                    <input
                      type="text"
                      placeholder="6-digit NAICS code"
                      className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50"
                      onChange={e => setSelectedNaics({ code: e.target.value, title: "Custom", confidence: "medium", why: "Manually entered" })}
                    />
                    <input
                      type="text"
                      placeholder="Industry description"
                      className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50"
                      onChange={e => setSelectedNaics(prev => prev ? { ...prev, title: e.target.value } : null)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── Geography Step ─────────────────────────────────── */}
            {currentStep?.id === "geography" && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-medium text-white mb-1">
                    Where does this business operate?
                  </div>
                  <div className="text-xs text-white/40 mb-4">
                    Buddy needs a market to run local economic and competitive research.
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-white/50 font-medium mb-1.5 block">City</label>
                      <input
                        type="text"
                        value={city}
                        onChange={e => setCity(e.target.value)}
                        placeholder="e.g. Sag Harbor"
                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-white/50 font-medium mb-1.5 block">State</label>
                      <input
                        type="text"
                        value={state}
                        onChange={e => setState(e.target.value)}
                        placeholder="e.g. NY"
                        maxLength={2}
                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50 uppercase"
                      />
                    </div>
                  </div>
                </div>
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                  <div className="text-xs text-white/40 leading-relaxed">
                    <span className="text-white/70 font-medium">Why this matters:</span> Buddy uses the
                    market location to analyze local economic conditions, identify direct competitors
                    in the same geography, assess real estate collateral markets, and benchmark
                    demand drivers. Without it, all market and competitive research returns empty.
                  </div>
                </div>
              </div>
            )}

            {/* ── Entity Name Step ───────────────────────────────── */}
            {currentStep?.id === "name" && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-medium text-white mb-1">
                    Confirm the borrower's legal entity name
                  </div>
                  <div className="text-xs text-white/40 mb-4">
                    This is what BIE will search for in public records, court filings, and
                    regulatory databases. Must be the exact legal registration name.
                  </div>
                  <input
                    type="text"
                    value={legalName}
                    onChange={e => setLegalName(e.target.value)}
                    placeholder="e.g. SAMARITUS MANAGEMENT LLC"
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50"
                  />
                </div>
              </div>
            )}

            {/* ── Banker Context Step ────────────────────────────── */}
            {currentStep?.id === "context" && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-medium text-white mb-1">
                    Add context Buddy can't get from documents
                  </div>
                  <div className="text-xs text-white/40 mb-4">
                    This is optional but makes research dramatically better. One paragraph about
                    what the business does, how it makes money, and why the loan makes sense.
                  </div>
                  <textarea
                    rows={6}
                    value={bankerSummary}
                    onChange={e => setBankerSummary(e.target.value)}
                    placeholder="e.g. Samaritus Management LLC operates Yacht Hampton, a luxury charter business in Sag Harbor, NY. The business has operated since 2017 serving affluent leisure and corporate clients with a modern fleet of 8 vessels. Revenue is approximately $1.4M annually, highly seasonal (May–Sept). The $500K equipment loan is to add a new Aquila 36 electric catamaran targeting the growing ESG-conscious corporate event market. The guarantor Michael Newmark has $7.7M net worth and $450K annual rental income from a separate real estate portfolio."
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50 resize-none leading-relaxed"
                  />
                  <div className="text-[10px] text-white/25 mt-1.5">
                    {bankerSummary.length} characters — more detail = better research
                  </div>
                </div>
              </div>
            )}

            {/* ── Launch Step ────────────────────────────────────── */}
            {currentStep?.id === "launch" && (
              <div className="space-y-5">
                {researchDone ? (
                  <div className="text-center py-8">
                    <div className="text-5xl mb-4">🚀</div>
                    <div className="text-lg font-bold text-white mb-1">Research Launched!</div>
                    <div className="text-sm text-white/40">
                      Buddy is running all 8 intelligence threads. Check the Intelligence tab in a moment.
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="bg-gradient-to-br from-sky-500/10 to-violet-500/10 border border-sky-500/20 rounded-2xl p-6">
                      <div className="text-sm font-bold text-white mb-3">
                        Ready to launch ✓
                      </div>
                      <div className="space-y-2">
                        {steps.filter(s => s.status === "done").map(s => (
                          <div key={s.id} className="flex items-center gap-2 text-xs text-white/60">
                            <span className="text-emerald-400 material-symbols-outlined text-[14px]">check_circle</span>
                            {s.label} completed
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                      <div className="text-xs text-white/50 leading-relaxed space-y-1.5">
                        <div><span className="text-white/70 font-medium">What happens next:</span></div>
                        <div>→ Entity lock thread confirms SAMARITUS MANAGEMENT LLC</div>
                        <div>→ 6 parallel intelligence threads run (borrower, management, competitive, market, industry, transaction)</div>
                        <div>→ Synthesis produces credit thesis + 8 adversarial contradiction checks</div>
                        <div>→ Trust grade computed across 9 gates</div>
                        <div>→ Results appear in the Intelligence tab (~60–90 seconds)</div>
                      </div>
                    </div>

                    {error && (
                      <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
                        {error}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

          </div>

          {/* ── Footer CTAs ───────────────────────────────────────── */}
          {!researchDone && (
            <div className="flex items-center justify-between px-8 py-5 border-t border-white/[0.06]">
              <button
                onClick={() => {
                  if (currentIdx > 0) {
                    setCurrentIdx(i => i - 1);
                    setSteps(prev => prev.map((s, i) => {
                      if (i === currentIdx) return { ...s, status: "pending" };
                      if (i === currentIdx - 1) return { ...s, status: "active" };
                      return s;
                    }));
                  }
                }}
                disabled={currentIdx === 0}
                className="text-xs text-white/30 hover:text-white/60 disabled:opacity-0 transition-colors"
              >
                ← Back
              </button>

              <div className="flex items-center gap-3">
                {/* Skip for optional steps */}
                {currentStep && !currentStep.required && currentStep.id !== "launch" && (
                  <button
                    onClick={advance}
                    className="text-xs text-white/30 hover:text-white/50 transition-colors px-3 py-2"
                  >
                    Skip for now
                  </button>
                )}

                {/* Primary CTA per step */}
                {currentStep?.id === "naics" && (
                  <button
                    onClick={saveNaics}
                    disabled={!selectedNaics || selectedNaics.code === "manual" || saving}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      !selectedNaics || saving
                        ? "bg-white/5 text-white/25 cursor-not-allowed"
                        : "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20"
                    }`}
                  >
                    {saving ? "Saving..." : "Confirm Industry →"}
                  </button>
                )}

                {currentStep?.id === "geography" && (
                  <button
                    onClick={saveGeo}
                    disabled={(!city.trim() && !state.trim()) || saving}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      (!city.trim() && !state.trim()) || saving
                        ? "bg-white/5 text-white/25 cursor-not-allowed"
                        : "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20"
                    }`}
                  >
                    {saving ? "Saving..." : "Confirm Location →"}
                  </button>
                )}

                {currentStep?.id === "name" && (
                  <button
                    onClick={saveName}
                    disabled={legalName.trim().length < 3 || saving}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      legalName.trim().length < 3 || saving
                        ? "bg-white/5 text-white/25 cursor-not-allowed"
                        : "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20"
                    }`}
                  >
                    {saving ? "Saving..." : "Confirm Name →"}
                  </button>
                )}

                {currentStep?.id === "context" && (
                  <button
                    onClick={saveContext}
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20 transition-all"
                  >
                    {saving ? "Saving..." : bankerSummary.trim().length > 10 ? "Save & Continue →" : "Continue →"}
                  </button>
                )}

                {currentStep?.id === "launch" && !researchDone && (
                  <button
                    onClick={launchResearch}
                    disabled={researchRunning}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all ${
                      researchRunning
                        ? "bg-white/5 text-white/30 cursor-wait"
                        : "bg-gradient-to-r from-sky-500 to-violet-500 hover:from-sky-400 hover:to-violet-400 text-white shadow-xl shadow-sky-500/25"
                    }`}
                  >
                    {researchRunning ? (
                      <>
                        <span className="animate-spin material-symbols-outlined text-[16px]">progress_activity</span>
                        Launching...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
                        Launch Research
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## Part 3 — Wire the Wizard into the Builder Page

The wizard should be accessible from two places:

### 3a — Add to the deal cockpit builder (wherever "Run Analysis" currently lives)

Find the builder page component — likely `src/app/(app)/deals/[dealId]/builder/page.tsx`
or `src/components/deals/DealCockpitClient.tsx`. Add an "Ignite" button that opens the wizard.

Import:
```typescript
import { IgniteWizard } from "@/components/deals/IgniteWizard";
```

Add state:
```typescript
const [igniteOpen, setIgniteOpen] = useState(false);
```

Add button (near "Run Analysis"):
```tsx
<button
  onClick={() => setIgniteOpen(true)}
  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500/20 to-violet-500/20 border border-sky-500/30 text-sky-400 hover:from-sky-500/30 hover:to-violet-500/30 text-xs font-semibold transition-all"
>
  <span className="material-symbols-outlined text-[14px]">rocket_launch</span>
  Ignite
</button>
```

Add wizard:
```tsx
{igniteOpen && (
  <IgniteWizard
    dealId={dealId}
    borrowerName={deal?.borrower_name ?? "Borrower"}
    onComplete={() => window.location.reload()}
    onClose={() => setIgniteOpen(false)}
  />
)}
```

### 3b — Also add to the credit memo page flight deck panel (BlockedMemoRecoveryPanel)

In `src/components/creditMemo/BlockedMemoRecoveryPanel.tsx`, replace or supplement the
existing "Run Research" link with:

```tsx
<button
  onClick={() => setIgniteOpen(true)}
  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-sky-500/25 hover:from-sky-400 hover:to-violet-400 transition-all"
>
  <span className="material-symbols-outlined text-[14px]">rocket_launch</span>
  Open Ignite Wizard
</button>
```

---

## Part 4 — TypeScript Check

After all files are written:
```bash
npx tsc --noEmit 2>&1 | grep -v "pdf/route.ts"
```

Zero new errors before committing.

---

## Commit Message

```
feat(ignite-wizard): Research readiness wizard with AI-powered NAICS lookup

Components:
- IgniteWizard — dark-themed multi-step modal, dynamically builds steps
  from flight-deck API blockers, step-by-step blocker clearance
- AI NAICS suggestion — describes business in plain English, Claude returns
  top 3 NAICS codes with confidence scores and plain-English reasoning

API:
- POST /api/deals/[dealId]/borrower/update — patches borrower fields
  (naics_code, naics_description, city, state, legal_name, banker_summary)
- POST /api/deals/[dealId]/research/naics-suggest — Claude-powered
  NAICS lookup from business description

Wiring:
- Ignite button added to deal cockpit builder
- Recovery panel links to Ignite wizard from memo page
```

---

## Implementation Order

1. `src/app/api/deals/[dealId]/borrower/update/route.ts` — new API
2. `src/app/api/deals/[dealId]/research/naics-suggest/route.ts` — new API
3. `src/components/deals/IgniteWizard.tsx` — main component
4. Wire Ignite button into builder page (find correct file first)
5. Wire recovery panel link
6. `npx tsc --noEmit` — zero errors
7. Commit

---

## Key Notes for Claude Code

**Finding the builder page:** The "Run Analysis" button is visible in the screenshot.
Search for `RunResearchButton` or `"Run Analysis"` in the codebase to find the file where
the Ignite button should be added.

**NAICS suggest API key:** Uses `process.env.ANTHROPIC_API_KEY` — already available in
the environment (same key used by `gemini3FlashProvider.ts` for memo generation). If the
env var name differs, check how it's referenced in other AI routes.

**Borrower update — field existence:** The `borrowers` table has `legal_name`, `naics_code`,
`naics_description`. Confirm `city` and `state` column names before patching — they may be
named differently. Run `SELECT column_name FROM information_schema.columns WHERE table_name = 'borrowers'`
if unsure.

**The wizard does NOT call `supabaseAdmin` directly** — all mutations go through the two
new API routes which handle auth via `ensureDealBankAccess`. The component is pure client-side.
