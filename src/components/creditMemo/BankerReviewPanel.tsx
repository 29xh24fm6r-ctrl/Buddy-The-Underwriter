"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemoQualitativeForm } from "@/components/creditMemo/MemoQualitativeForm";
import type { QualitativeOverrides } from "@/components/creditMemo/MemoQualitativeForm";
import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";
import type { QualitativeAssessment } from "@/lib/creditMemo/canonical/buildQualitativeAssessment";
import type { CovenantPackage } from "@/lib/covenants/covenantTypes";

type Props = {
  dealId: string;
  memo: CanonicalCreditMemoV1;
};

type TabKey = "profile" | "qualitative" | "covenants" | "checklist";

type QualitativeOverride = { score: number; reason: string };
type CovenantAdjustment = { covenantId: string; action: "keep" | "modify" | "remove"; note: string };

type OverridesBag = Record<string, unknown> & {
  committee_ready?: boolean;
  committee_reviewed_at?: string;
  tabs_viewed?: string[];
  covenant_banker_notes?: string;
  covenant_adjustments?: CovenantAdjustment[];
  qualitative_override_character?: QualitativeOverride;
  qualitative_override_capital?: QualitativeOverride;
  qualitative_override_conditions?: QualitativeOverride;
  qualitative_override_management?: QualitativeOverride;
  qualitative_override_business_model?: QualitativeOverride;
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "profile",     label: "Business Profile" },
  { key: "qualitative", label: "Qualitative Assessment" },
  { key: "covenants",   label: "Covenant Review" },
  { key: "checklist",   label: "Pre-Submission Checklist" },
];

const QUAL_DIMENSIONS: Array<{
  key: "character" | "capital" | "conditions" | "management" | "business_model";
  overrideKey: keyof OverridesBag;
  label: string;
}> = [
  { key: "character",      overrideKey: "qualitative_override_character",      label: "Character" },
  { key: "capital",        overrideKey: "qualitative_override_capital",        label: "Capital" },
  { key: "conditions",     overrideKey: "qualitative_override_conditions",     label: "Conditions" },
  { key: "management",     overrideKey: "qualitative_override_management",     label: "Management" },
  { key: "business_model", overrideKey: "qualitative_override_business_model", label: "Business Model" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: "ok" | "warn" | "missing"): string {
  switch (status) {
    case "ok":      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "warn":    return "bg-amber-100 text-amber-700 border-amber-200";
    case "missing": return "bg-rose-100 text-rose-700 border-rose-200";
  }
}

function StarsRow({ score }: { score: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(score)));
  return (
    <span className="font-mono text-[11px] text-amber-600">
      {"★".repeat(filled)}
      <span className="text-gray-300">{"★".repeat(5 - filled)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BankerReviewPanel({ dealId, memo }: Props) {
  const [open, setOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<TabKey>("profile");
  const [overrides, setOverrides] = useState<OverridesBag>({});
  const [loaded, setLoaded] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingTab, setSavingTab] = useState<TabKey | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Load overrides on mount ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/credit-memo/overrides`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled && data?.ok) {
          setOverrides((data.overrides ?? {}) as OverridesBag);
          setLoaded(true);
        }
      } catch (err: any) {
        if (!cancelled) {
          // Render in empty state — never block memo view
          setLoadError(String(err?.message ?? err));
          setLoaded(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [dealId]);

  // ── Save helper ────────────────────────────────────────────────────────
  const saveOverrides = useCallback(
    async (patch: Partial<OverridesBag>, tag: TabKey) => {
      setSavingTab(tag);
      setSaveError(null);
      try {
        const res = await fetch(`/api/deals/${dealId}/credit-memo/overrides`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides: patch }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data?.ok) {
          setOverrides((data.overrides ?? {}) as OverridesBag);
          setSavedAt(new Date().toISOString());
        } else {
          throw new Error(data?.error ?? "Save failed");
        }
      } catch (err: any) {
        setSaveError(String(err?.message ?? err));
      } finally {
        setSavingTab(null);
      }
    },
    [dealId],
  );

  // Debounced auto-save for text fields on the Business Profile tab
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textPatchBuffer = useRef<Record<string, string>>({});
  const scheduleTextSave = useCallback(
    (key: string, value: string) => {
      textPatchBuffer.current[key] = value;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const patch = { ...textPatchBuffer.current } as Partial<OverridesBag>;
        textPatchBuffer.current = {};
        void saveOverrides(patch, "profile");
      }, 800);
    },
    [saveOverrides],
  );

  // Mark a tab as viewed (used by checklist "Recommended" items)
  useEffect(() => {
    if (!loaded) return;
    const viewed = new Set(overrides.tabs_viewed ?? []);
    if (!viewed.has(activeTab)) {
      viewed.add(activeTab);
      void saveOverrides({ tabs_viewed: Array.from(viewed) }, activeTab);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, loaded]);

  // ── Profile tab: wrap MemoQualitativeForm ──────────────────────────────
  const profileOverrides = useMemo<QualitativeOverrides>(() => {
    const out: QualitativeOverrides = {};
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }, [overrides]);

  const handleProfileChange = (key: string, value: string) => {
    setOverrides((prev) => ({ ...prev, [key]: value }));
    scheduleTextSave(key, value);
  };

  // ── Qualitative tab: per-dimension override ────────────────────────────
  const qa: QualitativeAssessment | null = memo.qualitative_assessment;

  const updateQualOverride = (
    dimKey: (typeof QUAL_DIMENSIONS)[number]["key"],
    overrideKey: keyof OverridesBag,
    patch: Partial<QualitativeOverride>,
  ) => {
    const current = (overrides[overrideKey] as QualitativeOverride | undefined) ?? { score: 0, reason: "" };
    const next: QualitativeOverride = { ...current, ...patch };
    setOverrides((prev) => ({ ...prev, [overrideKey]: next }));
  };

  const saveQualOverride = async (overrideKey: keyof OverridesBag) => {
    const o = overrides[overrideKey] as QualitativeOverride | undefined;
    if (!o || !o.score || !o.reason || o.reason.trim().length < 20) return;
    await saveOverrides({ [overrideKey]: o } as Partial<OverridesBag>, "qualitative");
  };

  // ── Covenant tab ──────────────────────────────────────────────────────
  const pkg: CovenantPackage | null = memo.covenant_package;

  const adjustmentsIndex = useMemo(() => {
    const idx: Record<string, CovenantAdjustment> = {};
    for (const adj of overrides.covenant_adjustments ?? []) idx[adj.covenantId] = adj;
    return idx;
  }, [overrides.covenant_adjustments]);

  const setAdjustment = (covenantId: string, patch: Partial<CovenantAdjustment>) => {
    const curr = adjustmentsIndex[covenantId] ?? { covenantId, action: "keep", note: "" };
    const next: CovenantAdjustment = { ...curr, ...patch };
    const list = { ...adjustmentsIndex, [covenantId]: next };
    setOverrides((prev) => ({ ...prev, covenant_adjustments: Object.values(list) }));
  };

  const saveCovenantTab = async () => {
    await saveOverrides(
      {
        covenant_banker_notes: overrides.covenant_banker_notes ?? "",
        covenant_adjustments: overrides.covenant_adjustments ?? [],
      },
      "covenants",
    );
  };

  // ── Checklist tab ─────────────────────────────────────────────────────
  const dscrOk = memo.financial_analysis.dscr.value !== null;
  const loanOk = memo.key_metrics.loan_amount.value !== null && memo.key_metrics.loan_amount.value > 0;
  const collatOk = memo.collateral.gross_value.value !== null && memo.collateral.gross_value.value > 0;
  const bizDescOk = typeof overrides.business_description === "string"
    && (overrides.business_description as string).trim().length >= 20;
  const principalIds = memo.management_qualifications.principals.map((p) => p.id);
  const anyMgmtBioOk = principalIds.some((pid) => {
    const v = overrides[`principal_bio_${pid}`];
    return typeof v === "string" && (v as string).trim().length >= 20;
  });
  const requiredItems = [
    { id: "dscr",     ok: dscrOk,        label: "DSCR computed" },
    { id: "loan",     ok: loanOk,        label: "Loan amount entered" },
    { id: "collat",   ok: collatOk,      label: "Collateral value entered" },
    { id: "bizdesc",  ok: bizDescOk,     label: "Business description filled (≥ 20 chars)" },
    { id: "mgmtbio",  ok: anyMgmtBioOk,  label: "At least one management bio filled" },
  ];
  const requiredDoneCount = requiredItems.filter((r) => r.ok).length;
  const requiredTotal = requiredItems.length;
  const allRequiredDone = requiredDoneCount === requiredTotal;

  const viewed = new Set(overrides.tabs_viewed ?? []);
  // We can't observe the narrative / research buttons from here, so we only
  // track what's locally observable: memo fields populated and tab views.
  const narrativeExists = typeof memo.executive_summary?.narrative === "string"
    && memo.executive_summary.narrative.length > 0
    && !memo.executive_summary.narrative.toLowerCase().includes("not yet generated");
  const researchExists = memo.business_industry_analysis !== null;

  const recommendedItems = [
    { id: "narrative", ok: narrativeExists,          label: "AI narrative generated" },
    { id: "research",  ok: researchExists,           label: "Research run" },
    { id: "cov-tab",   ok: viewed.has("covenants"),  label: "Covenant package reviewed" },
    { id: "qual-tab",  ok: viewed.has("qualitative"), label: "Qualitative assessment reviewed" },
  ];

  const markCommitteeReady = async () => {
    if (!allRequiredDone) return;
    await saveOverrides(
      {
        committee_ready: true,
        committee_reviewed_at: new Date().toISOString(),
      },
      "checklist",
    );
  };

  const isCommitteeReady = Boolean(overrides.committee_ready);
  const reviewedAt = typeof overrides.committee_reviewed_at === "string" ? overrides.committee_reviewed_at : null;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="mb-4 border border-gray-200 rounded-md bg-white">
      {/* Collapsed header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">Banker Review</span>
          <span className={`text-[11px] font-semibold border rounded px-2 py-0.5 ${
            allRequiredDone ? statusBadge("ok") : requiredDoneCount > 0 ? statusBadge("warn") : statusBadge("missing")
          }`}>
            {requiredDoneCount}/{requiredTotal} required fields complete
          </span>
          {isCommitteeReady && (
            <span className={`text-[11px] font-semibold border rounded px-2 py-0.5 ${statusBadge("ok")}`}>
              Committee-ready
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">{open ? "Collapse ▴" : "Expand ▾"}</span>
      </button>

      {open && (
        <div className="border-t border-gray-200 bg-gray-50/50 p-4">
          {/* Tab buttons */}
          <div className="flex items-center gap-2 border-b border-gray-200 mb-4 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === t.key
                    ? "border-sky-500 text-sky-700"
                    : "border-transparent text-gray-600 hover:text-gray-900"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {!loaded && (
            <div className="text-xs text-gray-500 italic">Loading overrides…</div>
          )}

          {loaded && loadError && (
            <div className="mb-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              Could not load saved overrides — starting empty. {loadError}
            </div>
          )}

          {saveError && (
            <div className="mb-3 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
              Save failed: {saveError}
            </div>
          )}

          {/* ── Tab 1: Business Profile ───────────────────────────── */}
          {loaded && activeTab === "profile" && (
            <div>
              <div className="text-[11px] text-gray-500 mb-3">
                Auto-saves 800ms after you stop typing.{" "}
                {savingTab === "profile" && <span className="text-sky-600">Saving…</span>}
                {savedAt && savingTab === null && (
                  <span className="text-emerald-700">Saved at {new Date(savedAt).toLocaleTimeString()}.</span>
                )}
              </div>
              <MemoQualitativeForm
                overrides={profileOverrides}
                onChange={handleProfileChange}
                principals={memo.management_qualifications.principals.map((p) => ({ id: p.id, name: p.name }))}
                theme="light"
              />
            </div>
          )}

          {/* ── Tab 2: Qualitative Assessment Override ────────────── */}
          {loaded && activeTab === "qualitative" && (
            <div>
              {!qa && (
                <div className="text-xs text-gray-500 italic">
                  Qualitative assessment unavailable — insufficient data in the memo to score dimensions.
                </div>
              )}
              {qa && (
                <div className="space-y-3">
                  {QUAL_DIMENSIONS.map((dim) => {
                    const auto = (qa as any)[dim.key] as { score: number; label: string; basis: string };
                    const over = overrides[dim.overrideKey] as QualitativeOverride | undefined;
                    const reasonOk = over?.reason && over.reason.trim().length >= 20;
                    const scoreSet = over?.score && over.score >= 1 && over.score <= 5;
                    return (
                      <div key={dim.key} className="border border-gray-200 rounded p-3 bg-white">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-gray-900">{dim.label}</div>
                            <div className="text-[11px] text-gray-600 mt-0.5">{auto.basis}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[10px] text-gray-500 uppercase">Auto</div>
                            <StarsRow score={auto.score} />
                            <div className="text-[10px] text-gray-500">{auto.label}</div>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-[140px_1fr_auto] gap-2 items-start">
                          <select
                            value={over?.score ?? 0}
                            onChange={(e) =>
                              updateQualOverride(dim.key, dim.overrideKey, { score: Number(e.target.value) })
                            }
                            className="text-xs border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-900"
                          >
                            <option value={0}>— no override —</option>
                            <option value={1}>1 (Insufficient)</option>
                            <option value={2}>2 (Weak)</option>
                            <option value={3}>3 (Marginal)</option>
                            <option value={4}>4 (Adequate)</option>
                            <option value={5}>5 (Strong)</option>
                          </select>
                          <textarea
                            rows={2}
                            placeholder="Override reason (min 20 chars)"
                            value={over?.reason ?? ""}
                            onChange={(e) =>
                              updateQualOverride(dim.key, dim.overrideKey, { reason: e.target.value })
                            }
                            className="text-xs border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-900 resize-none"
                          />
                          <button
                            type="button"
                            disabled={!scoreSet || !reasonOk || savingTab === "qualitative"}
                            onClick={() => saveQualOverride(dim.overrideKey)}
                            className="text-xs font-semibold px-3 py-1.5 rounded bg-gray-900 text-white disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-gray-700"
                          >
                            {savingTab === "qualitative" ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Tab 3: Covenant Review ───────────────────────────── */}
          {loaded && activeTab === "covenants" && (
            <div>
              {!pkg && (
                <div className="text-xs text-gray-500 italic">
                  No covenant package generated for this deal yet. Populate financial data to generate one.
                </div>
              )}
              {pkg && (
                <div className="space-y-4">
                  <div className="text-xs text-gray-700">{pkg.rationale}</div>

                  {(["financial", "reporting", "affirmativeNegative", "springing"] as const).map((group) => {
                    const items =
                      group === "financial" ? pkg.financial :
                      group === "reporting" ? pkg.reporting :
                      group === "affirmativeNegative" ? pkg.affirmativeNegative :
                      pkg.springing;
                    if (!items.length) return null;
                    const title =
                      group === "financial" ? "Financial Covenants" :
                      group === "reporting" ? "Reporting Requirements" :
                      group === "affirmativeNegative" ? "Affirmative & Negative Covenants" :
                      "Springing Covenants";
                    return (
                      <div key={group}>
                        <div className="text-[11px] font-semibold text-gray-600 uppercase mb-1">{title}</div>
                        <div className="space-y-2">
                          {items.map((c: any) => {
                            const adj = adjustmentsIndex[c.id];
                            return (
                              <div key={c.id} className="border border-gray-200 rounded p-2 bg-white">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs font-semibold text-gray-900 truncate">{c.name}</div>
                                    <div className="text-[11px] text-gray-600 truncate">{c.draftLanguage}</div>
                                  </div>
                                  <select
                                    value={adj?.action ?? "keep"}
                                    onChange={(e) =>
                                      setAdjustment(c.id, { action: e.target.value as CovenantAdjustment["action"] })
                                    }
                                    className="text-[11px] border border-gray-300 rounded px-2 py-1 bg-white text-gray-900 shrink-0"
                                  >
                                    <option value="keep">Keep</option>
                                    <option value="modify">Modify</option>
                                    <option value="remove">Remove</option>
                                  </select>
                                </div>
                                {(adj?.action === "modify" || adj?.action === "remove") && (
                                  <input
                                    type="text"
                                    placeholder="Note / proposed modification"
                                    value={adj?.note ?? ""}
                                    onChange={(e) => setAdjustment(c.id, { note: e.target.value })}
                                    className="mt-1 w-full text-[11px] border border-gray-300 rounded px-2 py-1 bg-white text-gray-900"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 uppercase mb-1">
                      Banker Notes
                    </label>
                    <textarea
                      rows={3}
                      value={(overrides.covenant_banker_notes as string) ?? ""}
                      onChange={(e) =>
                        setOverrides((prev) => ({ ...prev, covenant_banker_notes: e.target.value }))
                      }
                      placeholder="Free-text notes on the proposed covenant package — rationale, exceptions, committee discussion points."
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-900 resize-none"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={saveCovenantTab}
                      disabled={savingTab === "covenants"}
                      className="text-xs font-semibold px-3 py-1.5 rounded bg-gray-900 text-white disabled:bg-gray-300 hover:bg-gray-700"
                    >
                      {savingTab === "covenants" ? "Saving…" : "Save covenant review"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab 4: Pre-Submission Checklist ──────────────────── */}
          {loaded && activeTab === "checklist" && (
            <div>
              <div className="text-[11px] font-semibold text-gray-600 uppercase mb-2">Required (blocks submission)</div>
              <ul className="space-y-1.5 mb-4">
                {requiredItems.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full border text-[10px] flex items-center justify-center ${
                      r.ok ? "bg-emerald-500 border-emerald-500 text-white" : "bg-white border-rose-400 text-rose-500"
                    }`}>
                      {r.ok ? "✓" : "!"}
                    </span>
                    <span className="text-xs text-gray-800">{r.label}</span>
                  </li>
                ))}
              </ul>

              <div className="text-[11px] font-semibold text-gray-600 uppercase mb-2">Recommended (warnings)</div>
              <ul className="space-y-1.5 mb-4">
                {recommendedItems.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full border text-[10px] flex items-center justify-center ${
                      r.ok ? "bg-emerald-500 border-emerald-500 text-white" : "bg-amber-100 border-amber-400 text-amber-600"
                    }`}>
                      {r.ok ? "✓" : "?"}
                    </span>
                    <span className="text-xs text-gray-800">{r.label}</span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-200">
                <div className="text-[11px] text-gray-600">
                  {isCommitteeReady && reviewedAt
                    ? `Marked committee-ready at ${new Date(reviewedAt).toLocaleString()}.`
                    : allRequiredDone
                      ? "All required items complete. You may mark this memo committee-ready."
                      : `${requiredTotal - requiredDoneCount} required item${(requiredTotal - requiredDoneCount) !== 1 ? "s" : ""} remaining.`}
                </div>
                <button
                  type="button"
                  disabled={!allRequiredDone || savingTab === "checklist"}
                  onClick={markCommitteeReady}
                  className={`text-xs font-semibold px-3 py-1.5 rounded transition-colors ${
                    isCommitteeReady
                      ? "bg-emerald-600 text-white"
                      : !allRequiredDone
                        ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                        : "bg-gray-900 text-white hover:bg-gray-700"
                  }`}
                >
                  {savingTab === "checklist"
                    ? "Saving…"
                    : isCommitteeReady
                      ? "Committee-Ready ✓"
                      : "Mark as Committee-Ready"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
