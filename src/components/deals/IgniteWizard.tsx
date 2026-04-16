"use client";

import React, { useCallback, useEffect, useState } from "react";
import { MemoQualitativeForm } from "@/components/creditMemo/MemoQualitativeForm";
import type { QualitativeOverrides } from "@/components/creditMemo/MemoQualitativeForm";

// ─── Types ────────────────────────────────────────────────────
type NaicsSuggestion = {
  naics_code: string;
  naics_description: string;
  confidence: number;
  rationale: string;
};

type Principal = {
  id: string;
  displayName: string;
  isMalformed: boolean;
  normalizedCandidate: string | null;
};

type WizardStep = {
  id: string;
  label: string;
  icon: string;
  status: "pending" | "active" | "done";
  required: boolean;
};

type RecoveryStatus = {
  deal: { id: string; name: string | null; borrowerName: string | null };
  blockers: Array<{ key: string; severity: string; label: string; detail: string }>;
  hasCriticalBlockers: boolean;
  shouldShowWizard: boolean;
  borrower: {
    legalName: string | null;
    naicsCode: string | null;
    naicsDescription: string | null;
    city: string | null;
    state: string | null;
    website: string | null;
  };
  principals: Principal[];
  overrides: Record<string, unknown>;
  trustGrade: string | null;
};

// ─── Step builder ─────────────────────────────────────────────
function buildSteps(status: RecoveryStatus): WizardStep[] {
  const steps: WizardStep[] = [];
  const keys = new Set(status.blockers.map(b => b.key));

  if (keys.has("missing_naics")) {
    steps.push({ id: "industry", label: "Industry", icon: "category", status: "pending", required: true });
  }
  if (keys.has("missing_geography")) {
    steps.push({ id: "location", label: "Location", icon: "location_on", status: "pending", required: true });
  }
  if (keys.has("placeholder_deal_name")) {
    steps.push({ id: "name", label: "Deal Name", icon: "edit", status: "pending", required: false });
  }
  if (keys.has("malformed_principal")) {
    steps.push({ id: "owners", label: "Owners", icon: "people", status: "pending", required: true });
  }
  // Business context and review are always included
  steps.push({ id: "context", label: "Business Context", icon: "description", status: "pending", required: false });
  steps.push({ id: "review", label: "Review", icon: "fact_check", status: "pending", required: true });
  steps.push({ id: "launch", label: "Continue Analysis", icon: "rocket_launch", status: "pending", required: true });

  return steps.map((s, i) => ({ ...s, status: i === 0 ? "active" : "pending" }));
}

// ─── Main Component ───────────────────────────────────────────
export function IgniteWizard({
  dealId,
  onComplete,
  onClose,
}: {
  dealId: string;
  onComplete?: () => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [steps, setSteps] = useState<WizardStep[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "validating" | "running_research" | "generating_memo" | "done">("idle");

  // Per-step state
  const [businessDescription, setBusinessDescription] = useState("");
  const [naicsSuggestions, setNaicsSuggestions] = useState<NaicsSuggestion[]>([]);
  const [naicsLoading, setNaicsLoading] = useState(false);
  const [selectedNaics, setSelectedNaics] = useState<NaicsSuggestion | null>(null);
  const [manualNaicsCode, setManualNaicsCode] = useState("");
  const [manualNaicsDesc, setManualNaicsDesc] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [dealName, setDealName] = useState("");
  const [principalActions, setPrincipalActions] = useState<
    Record<string, { action: "rename" | "keep"; newName: string }>
  >({});
  const [overrides, setOverrides] = useState<QualitativeOverrides>({});

  // Track what was saved per-step for the Review summary
  const [savedSummary, setSavedSummary] = useState<{
    naics?: string;
    naicsDesc?: string;
    location?: string;
    ownersFixed?: number;
    hasContext?: boolean;
  }>({});

  useEffect(() => {
    fetch(`/api/deals/${dealId}/recovery/status`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setStatus(data);
          setSteps(buildSteps(data));
          setCity(data.borrower.city ?? "");
          setStateVal(data.borrower.state ?? "");
          setDealName(data.deal.name ?? "");
          setOverrides((data.overrides ?? {}) as QualitativeOverrides);
          const acts: Record<string, { action: "rename" | "keep"; newName: string }> = {};
          for (const p of data.principals) {
            acts[p.id] = {
              action: p.isMalformed && p.normalizedCandidate ? "rename" : "keep",
              newName: p.normalizedCandidate ?? p.displayName,
            };
          }
          setPrincipalActions(acts);
        } else {
          setError("Failed to load deal state");
        }
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  }, [dealId]);

  const currentStep = steps[stepIdx];
  const progress = steps.length > 0
    ? Math.round((steps.filter(s => s.status === "done").length / steps.length) * 100)
    : 0;

  const advance = useCallback(() => {
    setSteps(prev => prev.map((s, i) => {
      if (i === stepIdx) return { ...s, status: "done" };
      if (i === stepIdx + 1) return { ...s, status: "active" };
      return s;
    }));
    setStepIdx(i => i + 1);
    setError(null);
  }, [stepIdx]);

  const saveAndAdvance = useCallback(async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Save failed"); return; }
      advance();
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  }, [dealId, advance]);

  const lookupNaics = useCallback(async () => {
    if (businessDescription.trim().length < 15) { setError("Describe the business in a bit more detail"); return; }
    setNaicsLoading(true);
    setNaicsSuggestions([]);
    setSelectedNaics(null);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/recovery/naics-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_description: businessDescription,
          company_name: status?.borrower.legalName ?? status?.deal.borrowerName ?? undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setError("Couldn't look up industry — try again"); return; }
      setNaicsSuggestions(data.suggestions ?? []);
    } catch { setError("Network error"); }
    finally { setNaicsLoading(false); }
  }, [businessDescription, dealId, status]);

  const savePrincipals = useCallback(async () => {
    setSaving(true);
    try {
      const actions = Object.entries(principalActions).map(([id, v]) => ({
        id, action: v.action, new_name: v.action === "rename" ? v.newName : undefined,
      }));
      await fetch(`/api/deals/${dealId}/recovery/principals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions }),
      });
      const fixed = actions.filter(a => a.action === "rename").length;
      setSavedSummary(prev => ({ ...prev, ownersFixed: fixed }));
      advance();
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  }, [principalActions, dealId, advance]);

  const saveContext = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`/api/deals/${dealId}/borrower/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(overrides),
      });
      setSavedSummary(prev => ({
        ...prev,
        hasContext: typeof overrides.business_description === "string" && overrides.business_description.length > 20,
      }));
    } catch {}
    finally { setSaving(false); }
    advance();
  }, [overrides, dealId, advance]);

  // "Continue Analysis": validate → research → memo
  const continueAnalysis = useCallback(async () => {
    setPhase("validating");
    setError(null);
    try {
      // Step 1: server-side validation gate
      const validateRes = await fetch(`/api/deals/${dealId}/recovery/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const validateData = await validateRes.json();
      if (!validateData.ok) {
        const errs: string[] = validateData.validation_errors ?? [validateData.error ?? "Validation failed"];
        setError(errs.join(" · "));
        setPhase("idle");
        return;
      }

      // Step 2: fire research
      setPhase("running_research");
      const researchRes = await fetch(`/api/deals/${dealId}/research/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const researchData = await researchRes.json();
      if (!researchData.ok) {
        setError(researchData.error ?? "Research launch failed");
        setPhase("idle");
        return;
      }

      // Step 3: non-blocking memo regenerate
      setPhase("generating_memo");
      fetch(`/api/deals/${dealId}/credit-memo/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});

      setPhase("done");
      setSteps(prev => prev.map((s, i) => i === stepIdx ? { ...s, status: "done" } : s));
      setTimeout(() => { onComplete?.(); onClose(); }, 2500);
    } catch {
      setError("Failed to launch analysis");
      setPhase("idle");
    }
  }, [dealId, stepIdx, onComplete, onClose]);

  // ─── Render ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <div className="text-white/50 text-sm animate-pulse">Loading deal state...</div>
      </div>
    );
  }

  const malformedPrincipals = status?.principals.filter(p => p.isMalformed) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        className="bg-[#0f1117] border border-white/10 rounded-2xl w-full shadow-2xl flex overflow-hidden"
        style={{ maxWidth: 900, maxHeight: "calc(100vh - 2rem)", minHeight: 540 }}
      >
        {/* ── Left Rail ─────────────────────────────────────── */}
        <div className="w-52 bg-[#0a0c12] border-r border-white/[0.06] flex flex-col py-6 flex-shrink-0">
          <div className="px-5 mb-6">
            <div className="text-xs font-bold text-white/80 uppercase tracking-widest">🚀 Ignite</div>
            <div className="text-[10px] text-white/30 mt-0.5">Research Readiness</div>
          </div>
          <div className="flex-1 px-3 space-y-1">
            {steps.map((step, i) => {
              const isActive = i === stepIdx;
              const isDone = step.status === "done";
              return (
                <div key={step.id} className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all ${
                  isActive ? "bg-sky-500/15 border border-sky-500/30" : isDone ? "opacity-50" : "opacity-25"
                }`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                    isDone ? "bg-emerald-500 text-white" : isActive ? "bg-sky-500 text-white" : "bg-white/10 text-white/40"
                  }`}>
                    {isDone ? "✓" : isActive
                      ? <span className="material-symbols-outlined text-[12px]">{step.icon}</span>
                      : i + 1}
                  </div>
                  <div className={`text-xs font-medium ${isActive ? "text-white" : "text-white/50"}`}>
                    {step.label}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-5 mt-4">
            <div className="flex justify-between text-[10px] text-white/30 mb-1.5">
              <span>Progress</span><span>{progress}%</span>
            </div>
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-700"
                style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        {/* ── Content ───────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-8 py-5 border-b border-white/[0.06]">
            <div>
              <div className="text-base font-semibold text-white">{currentStep?.label ?? "Complete"}</div>
              <div className="text-xs text-white/40 mt-0.5">
                {status?.deal.borrowerName ?? status?.deal.name ?? dealId} ·
                Step {Math.min(stepIdx + 1, steps.length)} of {steps.length}
              </div>
            </div>
            <button onClick={onClose} className="text-white/30 hover:text-white/60 text-lg">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto px-8 py-6">
            {error && (
              <div className="mb-4 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            {/* ── Industry ───────────────────────────────────── */}
            {currentStep?.id === "industry" && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-medium text-white mb-1">Tell Buddy what this business does</div>
                  <div className="text-xs text-white/40 mb-3">
                    Write a sentence or two in plain English — Buddy finds the right industry code.
                  </div>
                  <textarea rows={4} value={businessDescription}
                    onChange={e => { setBusinessDescription(e.target.value); setNaicsSuggestions([]); setSelectedNaics(null); }}
                    placeholder="e.g. Luxury yacht charter and boat rental business serving corporate and leisure clients in the Hamptons, NY..."
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50 resize-none leading-relaxed"
                  />
                </div>
                <button onClick={lookupNaics}
                  disabled={naicsLoading || businessDescription.trim().length < 15}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    naicsLoading ? "bg-white/5 text-white/30 cursor-wait"
                    : businessDescription.trim().length < 15 ? "bg-white/5 text-white/20 cursor-not-allowed"
                    : "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20"
                  }`}
                >
                  {naicsLoading
                    ? <><span className="animate-spin material-symbols-outlined text-[16px]">progress_activity</span> Buddy is thinking...</>
                    : <><span className="material-symbols-outlined text-[16px]">auto_awesome</span> Find Industry Code</>}
                </button>

                {naicsSuggestions.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] text-white/30 uppercase tracking-widest font-semibold">
                      Buddy&apos;s suggestions — pick one
                    </div>
                    {naicsSuggestions.map(s => (
                      <button key={s.naics_code} onClick={() => setSelectedNaics(s)}
                        className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all ${
                          selectedNaics?.naics_code === s.naics_code
                            ? "border-sky-500/60 bg-sky-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm font-bold text-white">{s.naics_code}</span>
                            <span className="text-sm text-white/80">{s.naics_description}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-semibold ${s.confidence >= 0.7 ? "text-emerald-400" : s.confidence >= 0.4 ? "text-amber-400" : "text-white/30"}`}>
                              {Math.round(s.confidence * 100)}%
                            </span>
                            {selectedNaics?.naics_code === s.naics_code && (
                              <span className="text-sky-400 material-symbols-outlined text-[18px]">check_circle</span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-white/40 mt-1.5 leading-relaxed">{s.rationale}</div>
                      </button>
                    ))}
                    <button onClick={() => setSelectedNaics({ naics_code: "", naics_description: "", confidence: 0, rationale: "" })}
                      className="text-xs text-white/30 hover:text-white/50 mt-1 transition-colors">
                      Enter a code manually instead →
                    </button>
                  </div>
                )}

                {selectedNaics?.naics_code === "" && (
                  <div className="flex gap-3">
                    <input type="text" maxLength={6} placeholder="6-digit code" value={manualNaicsCode}
                      onChange={e => setManualNaicsCode(e.target.value)}
                      className="w-32 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50" />
                    <input type="text" placeholder="Industry description" value={manualNaicsDesc}
                      onChange={e => setManualNaicsDesc(e.target.value)}
                      className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50" />
                  </div>
                )}
              </div>
            )}

            {/* ── Location ───────────────────────────────────── */}
            {currentStep?.id === "location" && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-medium text-white mb-1">Where does this business operate?</div>
                  <div className="text-xs text-white/40 mb-4">Buddy needs a market location to run local economic and competitive research.</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-white/50 font-medium mb-1.5 block">City</label>
                      <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Sag Harbor"
                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50" />
                    </div>
                    <div>
                      <label className="text-xs text-white/50 font-medium mb-1.5 block">State</label>
                      <input type="text" value={stateVal} onChange={e => setStateVal(e.target.value.toUpperCase())} placeholder="NY" maxLength={2}
                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50 uppercase" />
                    </div>
                  </div>
                </div>
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 text-xs text-white/40 leading-relaxed">
                  <span className="text-white/60 font-medium">Why this matters: </span>
                  Without a market location, Buddy cannot analyze competitive dynamics, identify
                  local employment conditions, or benchmark real estate collateral markets.
                </div>
              </div>
            )}

            {/* ── Deal Name ──────────────────────────────────── */}
            {currentStep?.id === "name" && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-medium text-white mb-1">Give this deal a real name</div>
                  <div className="text-xs text-white/40 mb-4">Current name looks like a test artifact. Use the borrower name or a short descriptor.</div>
                  <input type="text" value={dealName} onChange={e => setDealName(e.target.value)}
                    placeholder="e.g. SAMARITUS MANAGEMENT LLC — $500K Equipment"
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50" />
                </div>
              </div>
            )}

            {/* ── Owners ─────────────────────────────────────── */}
            {currentStep?.id === "owners" && (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-white mb-1">One owner record needs cleanup</div>
                  <div className="text-xs text-white/40 mb-4">
                    Buddy detected imported data mixed in with the owner name. Confirm the correct name below.
                  </div>
                </div>
                {malformedPrincipals.map(p => (
                  <div key={p.id} className="border border-amber-500/20 bg-amber-500/5 rounded-xl p-4">
                    <div className="text-xs text-amber-400 font-semibold mb-2 uppercase tracking-wide">⚠ Malformed record</div>
                    <div className="text-xs text-white/30 font-mono mb-3 line-through">
                      {p.displayName.slice(0, 80)}{p.displayName.length > 80 ? "..." : ""}
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-white/50 font-medium block">Corrected name</label>
                      <input type="text"
                        value={principalActions[p.id]?.newName ?? p.normalizedCandidate ?? ""}
                        onChange={e => setPrincipalActions(prev => ({
                          ...prev, [p.id]: { action: "rename", newName: e.target.value }
                        }))}
                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50"
                      />
                      <button onClick={() => setPrincipalActions(prev => ({
                        ...prev, [p.id]: { action: "keep", newName: p.displayName }
                      }))} className="text-xs text-white/25 hover:text-white/40 transition-colors">
                        Keep original (not recommended)
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Business Context ───────────────────────────── */}
            {currentStep?.id === "context" && (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-white mb-1">Add context Buddy can&apos;t get from documents</div>
                  <div className="text-xs text-white/40 mb-4">
                    Optional but makes research dramatically better. No financial metrics — just what you know from conversations.
                  </div>
                </div>
                <MemoQualitativeForm
                  overrides={overrides}
                  onChange={(key, val) => setOverrides(prev => ({ ...prev, [key]: val }))}
                  principals={status?.principals
                    .filter(p => !p.isMalformed)
                    .map(p => ({ id: p.id, name: principalActions[p.id]?.newName ?? p.displayName })) ?? []}
                  theme="dark"
                />
              </div>
            )}

            {/* ── Review ──────────────────────────────────────── */}
            {currentStep?.id === "review" && (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-white mb-1">Looking good — here&apos;s what Buddy knows</div>
                  <div className="text-xs text-white/40 mb-4">
                    Review what was collected, then launch research.
                  </div>
                </div>
                <div className="space-y-2">
                  {/* Industry */}
                  {savedSummary.naics ? (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <span className="text-emerald-400 material-symbols-outlined text-[16px] mt-0.5">check_circle</span>
                      <div>
                        <div className="text-xs font-semibold text-white">Industry</div>
                        <div className="text-xs text-white/50">{savedSummary.naics} — {savedSummary.naicsDesc}</div>
                      </div>
                    </div>
                  ) : status?.borrower.naicsCode && status.borrower.naicsCode !== "999999" ? (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <span className="text-emerald-400 material-symbols-outlined text-[16px] mt-0.5">check_circle</span>
                      <div>
                        <div className="text-xs font-semibold text-white">Industry</div>
                        <div className="text-xs text-white/50">{status.borrower.naicsCode} — {status.borrower.naicsDescription ?? "Industry classified"}</div>
                      </div>
                    </div>
                  ) : null}

                  {/* Location */}
                  {(city || stateVal || status?.borrower.city || status?.borrower.state) && (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <span className="text-emerald-400 material-symbols-outlined text-[16px] mt-0.5">check_circle</span>
                      <div>
                        <div className="text-xs font-semibold text-white">Location</div>
                        <div className="text-xs text-white/50">
                          {city || status?.borrower.city}, {stateVal || status?.borrower.state}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Owners */}
                  {(savedSummary.ownersFixed ?? 0) > 0 && (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <span className="text-emerald-400 material-symbols-outlined text-[16px] mt-0.5">check_circle</span>
                      <div>
                        <div className="text-xs font-semibold text-white">Owner Records</div>
                        <div className="text-xs text-white/50">{savedSummary.ownersFixed} record{(savedSummary.ownersFixed ?? 0) > 1 ? "s" : ""} cleaned up</div>
                      </div>
                    </div>
                  )}

                  {/* Context */}
                  <div className={`flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border ${savedSummary.hasContext ? "border-white/[0.06]" : "border-white/[0.04]"}`}>
                    <span className={`material-symbols-outlined text-[16px] mt-0.5 ${savedSummary.hasContext ? "text-emerald-400" : "text-white/20"}`}>
                      {savedSummary.hasContext ? "check_circle" : "radio_button_unchecked"}
                    </span>
                    <div>
                      <div className={`text-xs font-semibold ${savedSummary.hasContext ? "text-white" : "text-white/40"}`}>Business Context</div>
                      <div className="text-xs text-white/40">
                        {savedSummary.hasContext ? "Business description added" : "Skipped — research will use documents only"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 text-xs text-white/40 leading-relaxed space-y-1">
                  <div className="text-white/60 font-medium mb-1.5">What Buddy will do next:</div>
                  <div>→ Confirm entity identity for {status?.borrower.legalName ?? "borrower"}</div>
                  <div>→ 6 parallel intelligence threads (borrower, management, competitive, market, industry, transaction)</div>
                  <div>→ Synthesis + 8 adversarial contradiction checks</div>
                  <div>→ Trust grade across 9 gates · Memo regenerated</div>
                  <div className="text-white/30 mt-2">~60–90 seconds. Results appear in the Intelligence tab.</div>
                </div>
              </div>
            )}

            {/* ── Launch ─────────────────────────────────────── */}
            {currentStep?.id === "launch" && (
              <div className="space-y-5">
                {phase === "done" ? (
                  <div className="text-center py-10">
                    <div className="text-5xl mb-4">🚀</div>
                    <div className="text-lg font-bold text-white mb-2">Research Launched!</div>
                    <div className="text-sm text-white/40">Check the Intelligence tab in about 60–90 seconds.</div>
                  </div>
                ) : (
                  <>
                    {phase === "validating" && (
                      <div className="flex items-center gap-2 text-sm text-white/50">
                        <span className="animate-spin material-symbols-outlined text-[16px]">progress_activity</span>
                        Validating readiness...
                      </div>
                    )}
                    {phase === "running_research" && (
                      <div className="flex items-center gap-2 text-sm text-sky-400">
                        <span className="animate-spin material-symbols-outlined text-[16px]">progress_activity</span>
                        Running research...
                      </div>
                    )}
                    {phase === "generating_memo" && (
                      <div className="flex items-center gap-2 text-sm text-violet-400">
                        <span className="animate-spin material-symbols-outlined text-[16px]">progress_activity</span>
                        Regenerating memo...
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Footer ──────────────────────────────────────────── */}
          {phase === "idle" && (
            <div className="flex items-center justify-between px-8 py-5 border-t border-white/[0.06]">
              <button
                onClick={() => {
                  if (stepIdx > 0) {
                    setSteps(prev => prev.map((s, i) => {
                      if (i === stepIdx) return { ...s, status: "pending" };
                      if (i === stepIdx - 1) return { ...s, status: "active" };
                      return s;
                    }));
                    setStepIdx(i => i - 1);
                  }
                }}
                disabled={stepIdx === 0}
                className="text-xs text-white/30 hover:text-white/60 disabled:opacity-0 transition-colors"
              >
                ← Back
              </button>
              <div className="flex items-center gap-3">
                {currentStep && !currentStep.required && !["launch", "review"].includes(currentStep.id) && (
                  <button onClick={advance} className="text-xs text-white/30 hover:text-white/50 px-3 py-2 transition-colors">
                    Skip for now
                  </button>
                )}

                {currentStep?.id === "industry" && (
                  <button
                    onClick={() => {
                      const code = selectedNaics?.naics_code === "" ? manualNaicsCode : selectedNaics?.naics_code;
                      const desc = selectedNaics?.naics_code === "" ? manualNaicsDesc : selectedNaics?.naics_description;
                      if (!code) { setError("Select or enter an industry code"); return; }
                      setSavedSummary(prev => ({ ...prev, naics: code, naicsDesc: desc ?? "" }));
                      saveAndAdvance({ naics_code: code, naics_description: desc ?? "",
                        banker_summary: businessDescription.length > 20 ? businessDescription : undefined });
                    }}
                    disabled={(!selectedNaics && !manualNaicsCode) || saving}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      (!selectedNaics && !manualNaicsCode) || saving
                        ? "bg-white/5 text-white/25 cursor-not-allowed"
                        : "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20"
                    }`}
                  >
                    {saving ? "Saving..." : "Confirm Industry →"}
                  </button>
                )}

                {currentStep?.id === "location" && (
                  <button
                    onClick={() => {
                      if (!city.trim() && !stateVal.trim()) { setError("Enter at least a city or state"); return; }
                      setSavedSummary(prev => ({ ...prev }));
                      saveAndAdvance({ city: city.trim(), state: stateVal.trim() });
                    }}
                    disabled={(!city.trim() && !stateVal.trim()) || saving}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      (!city.trim() && !stateVal.trim()) || saving
                        ? "bg-white/5 text-white/25 cursor-not-allowed"
                        : "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20"
                    }`}
                  >
                    {saving ? "Saving..." : "Confirm Location →"}
                  </button>
                )}

                {currentStep?.id === "name" && (
                  <button
                    onClick={() => {
                      if (dealName.trim().length < 3) { setError("Enter a meaningful deal name"); return; }
                      saveAndAdvance({ deal_name: dealName.trim() });
                    }}
                    disabled={dealName.trim().length < 3 || saving}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      dealName.trim().length < 3 || saving
                        ? "bg-white/5 text-white/25 cursor-not-allowed"
                        : "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20"
                    }`}
                  >
                    {saving ? "Saving..." : "Rename →"}
                  </button>
                )}

                {currentStep?.id === "owners" && (
                  <button onClick={savePrincipals} disabled={saving}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20 transition-all">
                    {saving ? "Saving..." : "Fix Owner Records →"}
                  </button>
                )}

                {currentStep?.id === "context" && (
                  <button onClick={saveContext} disabled={saving}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20 transition-all">
                    {saving ? "Saving..." : "Save & Continue →"}
                  </button>
                )}

                {currentStep?.id === "review" && (
                  <button onClick={advance}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20 transition-all">
                    Looks good — continue →
                  </button>
                )}

                {currentStep?.id === "launch" && phase === "idle" && (
                  <button onClick={continueAnalysis}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-sky-500 to-violet-500 hover:from-sky-400 hover:to-violet-400 text-white shadow-xl shadow-sky-500/25 transition-all">
                    <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
                    Continue Analysis
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
