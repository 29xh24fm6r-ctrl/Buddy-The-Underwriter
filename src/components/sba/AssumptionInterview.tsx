"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type {
  SBAAssumptions,
  RevenueStream,
  FixedCostCategory,
  PlannedHire,
  PlannedCapex,
  ExistingDebtItem,
  ManagementMember,
  CoachingTip,
  PrefillMeta,
} from "@/lib/sba/sbaReadinessTypes";
import { computeAssumptionsCompletionPct } from "@/lib/sba/sbaAssumptionsValidator";
import { getAssumptionCoachingTips } from "@/lib/sba/sbaAssumptionCoach";
import SBAGenerationProgress from "./SBAGenerationProgress";

// Phase 2 — NAICS industry-typical badge shown next to prefilled fields.
function NAICSBadge({ meta }: { meta: PrefillMeta | null | undefined }) {
  if (!meta?.benchmarkApplied) return null;
  const label = meta.naicsLabel ?? meta.industryLabel ?? "this industry";
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400 border border-blue-500/20">
      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
        insights
      </span>
      Industry typical for {label}
    </span>
  );
}

// ─── Phase BPG — coaching tip callout ───────────────────────────────────────

function CoachingCallout({ tip }: { tip: CoachingTip }) {
  const styles: Record<CoachingTip["severity"], string> = {
    info: "border-blue-500 bg-blue-50 text-blue-900",
    warning: "border-amber-500 bg-amber-50 text-amber-900",
    concern: "border-red-500 bg-red-50 text-red-900",
  };
  return (
    <div
      className={`mt-2 rounded-md border-l-4 px-3 py-2 text-xs ${styles[tip.severity]}`}
    >
      <div className="font-semibold">{tip.title}</div>
      <div>{tip.message}</div>
    </div>
  );
}

interface GuarantorRow {
  entity_id: string;
  display_name: string | null;
  entity_type: string | null;
  ownership_pct: number;
  w2_salary: number;
  other_personal_income: number;
  personal_income_notes: string;
  mortgage_payment: number;
  auto_payments: number;
  student_loans: number;
  credit_card_minimums: number;
  other_personal_debt: number;
  personal_debt_notes: string;
}

interface Props {
  dealId: string;
  initial: SBAAssumptions | null;
  prefilled: Partial<SBAAssumptions>;
  onConfirmed: () => void;
  // Phase 2 — NAICS metadata from the prefill API
  prefillMeta?: PrefillMeta | null;
}

function mergeAssumptions(
  saved: SBAAssumptions | null,
  prefilled: Partial<SBAAssumptions>,
  dealId: string,
): SBAAssumptions {
  if (saved) return saved;
  return {
    dealId,
    status: "draft",
    revenueStreams: prefilled.revenueStreams ?? [],
    costAssumptions: prefilled.costAssumptions ?? {
      cogsPercentYear1: 0.5,
      cogsPercentYear2: 0.5,
      cogsPercentYear3: 0.5,
      fixedCostCategories: [],
      plannedHires: [],
      plannedCapex: [],
    },
    workingCapital: prefilled.workingCapital ?? {
      targetDSO: 45,
      targetDPO: 30,
      inventoryTurns: null,
    },
    loanImpact: prefilled.loanImpact ?? {
      loanAmount: 0,
      termMonths: 120,
      interestRate: 0.0725,
      existingDebt: [],
      equityInjectionAmount: 0,
      equityInjectionSource: "cash_savings",
      sellerFinancingAmount: 0,
      sellerFinancingTermMonths: 0,
      sellerFinancingRate: 0,
      otherSources: [],
    },
    managementTeam: prefilled.managementTeam ?? [],
  };
}

function PrefilledBadge() {
  return (
    <span className="ml-1 inline-block rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
      Pre-filled
    </span>
  );
}

function SectionHeader({
  title,
  complete,
  open,
  onToggle,
}: {
  title: string;
  complete: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-left hover:bg-white/[0.05]"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-white">{title}</span>
        {complete ? (
          <span className="text-emerald-400 text-xs">Complete</span>
        ) : (
          <span className="text-amber-400 text-xs">Incomplete</span>
        )}
      </div>
      <span
        className="material-symbols-outlined text-white/50 transition-transform"
        style={{ fontSize: 18, transform: open ? "rotate(180deg)" : "rotate(0)" }}
      >
        expand_more
      </span>
    </button>
  );
}

export default function AssumptionInterview({ dealId, initial, prefilled, onConfirmed, prefillMeta }: Props) {
  const [assumptions, setAssumptions] = useState<SBAAssumptions>(() =>
    mergeAssumptions(initial, prefilled, dealId),
  );
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    revenue: true,
    costs: false,
    workingCapital: false,
    loan: false,
    management: false,
    guarantors: false,
  });

  // Phase BPG — coaching tips (recomputed on every state change)
  const coachingTips = useMemo<CoachingTip[]>(
    () => getAssumptionCoachingTips({ assumptions }),
    [assumptions],
  );
  const tipsByField = useMemo(() => {
    const byField = new Map<string, CoachingTip[]>();
    for (const t of coachingTips) {
      const list = byField.get(t.field) ?? [];
      list.push(t);
      byField.set(t.field, list);
    }
    return byField;
  }, [coachingTips]);

  // Phase BPG — guarantor cashflow (loaded + saved via the API)
  const [guarantors, setGuarantors] = useState<GuarantorRow[]>([]);
  const [guarantorsLoaded, setGuarantorsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadGuarantors() {
      try {
        const res = await fetch(`/api/deals/${dealId}/sba/guarantor-cashflow`);
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) setGuarantors(json.guarantors ?? []);
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setGuarantorsLoaded(true);
      }
    }
    loadGuarantors();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  const saveGuarantors = useCallback(async () => {
    try {
      await fetch(`/api/deals/${dealId}/sba/guarantor-cashflow`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          guarantors.map((g) => ({
            entity_id: g.entity_id,
            w2_salary: g.w2_salary,
            other_personal_income: g.other_personal_income,
            personal_income_notes: g.personal_income_notes || null,
            mortgage_payment: g.mortgage_payment,
            auto_payments: g.auto_payments,
            student_loans: g.student_loans,
            credit_card_minimums: g.credit_card_minimums,
            other_personal_debt: g.other_personal_debt,
            personal_debt_notes: g.personal_debt_notes || null,
          })),
        ),
      });
    } catch {
      // non-fatal
    }
  }, [dealId, guarantors]);

  const updateGuarantor = useCallback(
    (entityId: string, patch: Partial<GuarantorRow>) => {
      setGuarantors((prev) =>
        prev.map((g) => (g.entity_id === entityId ? { ...g, ...patch } : g)),
      );
    },
    [],
  );

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const completionPct = computeAssumptionsCompletionPct(assumptions);
  const isConfirmed = assumptions.status === "confirmed";

  const toggleSection = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const autoSave = useCallback(
    (updated: SBAAssumptions) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveStatus("saving");
      saveTimer.current = setTimeout(async () => {
        try {
          setSaving(true);
          await fetch(`/api/deals/${dealId}/sba/assumptions`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patch: updated }),
          });
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2000);
        } catch {
          setSaveStatus("idle");
        } finally {
          setSaving(false);
        }
      }, 800);
    },
    [dealId],
  );

  const update = useCallback(
    (patch: Partial<SBAAssumptions>) => {
      setAssumptions((prev) => {
        const next = { ...prev, ...patch };
        autoSave(next);
        return next;
      });
    },
    [autoSave],
  );

  // Phase 2 — live generation progress streamed from the SSE endpoint.
  const [generating, setGenerating] = useState(false);
  const [genStep, setGenStep] = useState("Starting...");
  const [genPct, setGenPct] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);

  async function runStreamingGenerate() {
    setGenerating(true);
    setGenStep("Starting...");
    setGenPct(0);
    setGenError(null);

    try {
      const res = await fetch(`/api/deals/${dealId}/sba/generate`, {
        method: "POST",
      });

      if (!res.body) {
        setGenError("Streaming not supported by this browser.");
        setGenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by two newlines.
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const ev of events) {
          const line = ev.startsWith("data: ") ? ev.slice(6) : ev;
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line) as {
              step: string;
              pct: number;
              error?: string;
            };
            setGenStep(data.step);
            setGenPct(data.pct);
            if (data.step === "error" && data.error) {
              setGenError(data.error);
              setGenerating(false);
            }
            if (data.step === "complete") {
              // Allow the 100% frame to render, then dismiss.
              setTimeout(() => {
                setGenerating(false);
                onConfirmed();
              }, 500);
            }
          } catch {
            // ignore malformed frame
          }
        }
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Network error");
      setGenerating(false);
    }
  }

  const handleConfirm = async () => {
    const next = { ...assumptions, status: "confirmed" as const };
    setAssumptions(next);
    try {
      await fetch(`/api/deals/${dealId}/sba/assumptions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: { status: "confirmed" } }),
      });
      // Phase 2 — fire generation immediately; onConfirmed fires after
      // streaming completes (or the error callback clears the overlay).
      await runStreamingGenerate();
    } catch {
      // revert
      setAssumptions((prev) => ({ ...prev, status: "complete" }));
    }
  };

  const handleReopen = async () => {
    const next = { ...assumptions, status: "draft" as const };
    setAssumptions(next);
    await fetch(`/api/deals/${dealId}/sba/assumptions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch: { status: "draft" } }),
    });
  };

  // --- Revenue Streams ---
  const addStream = () => {
    if (assumptions.revenueStreams.length >= 3) return;
    const stream: RevenueStream = {
      id: `stream_${Date.now()}`,
      name: "",
      baseAnnualRevenue: 0,
      growthRateYear1: 0.1,
      growthRateYear2: 0.08,
      growthRateYear3: 0.06,
      pricingModel: "flat",
      seasonalityProfile: null,
    };
    update({ revenueStreams: [...assumptions.revenueStreams, stream] });
  };

  const updateStream = (idx: number, patch: Partial<RevenueStream>) => {
    const streams = [...assumptions.revenueStreams];
    streams[idx] = { ...streams[idx], ...patch };
    update({ revenueStreams: streams });
  };

  const removeStream = (idx: number) => {
    update({ revenueStreams: assumptions.revenueStreams.filter((_, i) => i !== idx) });
  };

  // --- Fixed Costs ---
  const addFixedCost = () => {
    const cat: FixedCostCategory = { name: "", annualAmount: 0, escalationPctPerYear: 0.03 };
    update({
      costAssumptions: {
        ...assumptions.costAssumptions,
        fixedCostCategories: [...assumptions.costAssumptions.fixedCostCategories, cat],
      },
    });
  };

  // --- Hires ---
  const addHire = () => {
    const hire: PlannedHire = { role: "", startMonth: 1, annualSalary: 0 };
    update({
      costAssumptions: {
        ...assumptions.costAssumptions,
        plannedHires: [...assumptions.costAssumptions.plannedHires, hire],
      },
    });
  };

  // --- Capex ---
  const addCapex = () => {
    const capex: PlannedCapex = { description: "", amount: 0, year: 1 };
    update({
      costAssumptions: {
        ...assumptions.costAssumptions,
        plannedCapex: [...assumptions.costAssumptions.plannedCapex, capex],
      },
    });
  };

  // --- Existing Debt ---
  const addDebt = () => {
    const debt: ExistingDebtItem = {
      description: "",
      currentBalance: 0,
      monthlyPayment: 0,
      remainingTermMonths: 60,
    };
    update({
      loanImpact: {
        ...assumptions.loanImpact,
        existingDebt: [...assumptions.loanImpact.existingDebt, debt],
      },
    });
  };

  // --- Management ---
  const addMember = () => {
    const member: ManagementMember = {
      name: "",
      title: "",
      yearsInIndustry: 0,
      bio: "",
    };
    update({ managementTeam: [...assumptions.managementTeam, member] });
  };

  const updateMember = (idx: number, patch: Partial<ManagementMember>) => {
    const team = [...assumptions.managementTeam];
    team[idx] = { ...team[idx], ...patch };
    update({ managementTeam: team });
  };

  const removeMember = (idx: number) => {
    update({ managementTeam: assumptions.managementTeam.filter((_, i) => i !== idx) });
  };

  const inputCls =
    "w-full rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-blue-500/50 focus:outline-none";
  const labelCls = "block text-xs text-white/60 mb-1";

  return (
    <div className="space-y-3">
      {/* Phase 2 — generation progress overlay */}
      <SBAGenerationProgress step={genStep} pct={genPct} generating={generating} />

      {genError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          Generation failed: {genError}
        </div>
      )}

      {/* Phase 2 — NAICS prefill summary banner */}
      {prefillMeta?.benchmarkApplied && (
        <div className="flex items-center gap-2 rounded-md border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-300">
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            insights
          </span>
          We pre-filled industry-typical defaults for
          {" "}
          <span className="font-semibold">
            {prefillMeta.naicsLabel ?? prefillMeta.industryLabel}
          </span>
          {prefillMeta.naicsCode ? ` (NAICS ${prefillMeta.naicsCode})` : ""}. Adjust any field that doesn&apos;t match your specific business.
        </div>
      )}

      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${completionPct}%` }}
          />
        </div>
        <span className="text-xs text-white/60">{completionPct}%</span>
        {saveStatus === "saving" && (
          <span className="text-xs text-amber-300">Saving...</span>
        )}
        {saveStatus === "saved" && (
          <span className="text-xs text-emerald-400">Saved</span>
        )}
      </div>

      {/* Section 1: Revenue */}
      <div>
        <SectionHeader
          title="1. Revenue Streams"
          complete={(assumptions.revenueStreams?.length ?? 0) > 0}
          open={!!openSections.revenue}
          onToggle={() => toggleSection("revenue")}
        />
        {openSections.revenue && (
          <div className="mt-2 space-y-3 pl-2">
            {assumptions.revenueStreams.map((stream, idx) => (
              <div
                key={stream.id}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Stream {idx + 1}</span>
                  <button
                    onClick={() => removeStream(idx)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Name</label>
                    <input
                      className={inputCls}
                      value={stream.name}
                      onChange={(e) => updateStream(idx, { name: e.target.value })}
                      placeholder="e.g. Consulting Services"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      Base Annual Revenue ($)
                      {idx === 0 && initial === null && stream.baseAnnualRevenue > 0 && (
                        <PrefilledBadge />
                      )}
                    </label>
                    <input
                      className={inputCls}
                      type="number"
                      value={stream.baseAnnualRevenue || ""}
                      onChange={(e) =>
                        updateStream(idx, { baseAnnualRevenue: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="flex items-center gap-1 mb-1">
                      <label className={labelCls + " mb-0"}>Y1 Growth %</label>
                      <NAICSBadge meta={prefillMeta} />
                    </div>
                    <input
                      className={inputCls}
                      type="number"
                      step="0.01"
                      value={stream.growthRateYear1 * 100 || ""}
                      onChange={(e) =>
                        updateStream(idx, { growthRateYear1: Number(e.target.value) / 100 })
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Y2 Growth %</label>
                    <input
                      className={inputCls}
                      type="number"
                      step="0.01"
                      value={stream.growthRateYear2 * 100 || ""}
                      onChange={(e) =>
                        updateStream(idx, { growthRateYear2: Number(e.target.value) / 100 })
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Y3 Growth %</label>
                    <input
                      className={inputCls}
                      type="number"
                      step="0.01"
                      value={stream.growthRateYear3 * 100 || ""}
                      onChange={(e) =>
                        updateStream(idx, { growthRateYear3: Number(e.target.value) / 100 })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Pricing Model</label>
                  <select
                    className={inputCls}
                    value={stream.pricingModel}
                    onChange={(e) =>
                      updateStream(idx, {
                        pricingModel: e.target.value as RevenueStream["pricingModel"],
                      })
                    }
                  >
                    <option value="flat">Flat</option>
                    <option value="per_unit">Per Unit</option>
                    <option value="subscription">Subscription</option>
                    <option value="pct_revenue">% of Revenue</option>
                  </select>
                </div>
              </div>
            ))}
            {assumptions.revenueStreams.length < 3 && (
              <button
                onClick={addStream}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                + Add Revenue Stream
              </button>
            )}
          </div>
        )}
      </div>

      {/* Section 2: Cost Structure */}
      <div>
        <SectionHeader
          title="2. Cost Structure"
          complete={assumptions.costAssumptions?.cogsPercentYear1 !== undefined}
          open={!!openSections.costs}
          onToggle={() => toggleSection("costs")}
        />
        {openSections.costs && (
          <div className="mt-2 space-y-3 pl-2">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>
                  COGS % Y1
                  {initial === null && <PrefilledBadge />}
                  <span className="ml-1"><NAICSBadge meta={prefillMeta} /></span>
                </label>
                <input
                  className={inputCls}
                  type="number"
                  step="0.01"
                  value={(assumptions.costAssumptions.cogsPercentYear1 * 100) || ""}
                  onChange={(e) =>
                    update({
                      costAssumptions: {
                        ...assumptions.costAssumptions,
                        cogsPercentYear1: Number(e.target.value) / 100,
                      },
                    })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>COGS % Y2</label>
                <input
                  className={inputCls}
                  type="number"
                  step="0.01"
                  value={(assumptions.costAssumptions.cogsPercentYear2 * 100) || ""}
                  onChange={(e) =>
                    update({
                      costAssumptions: {
                        ...assumptions.costAssumptions,
                        cogsPercentYear2: Number(e.target.value) / 100,
                      },
                    })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>COGS % Y3</label>
                <input
                  className={inputCls}
                  type="number"
                  step="0.01"
                  value={(assumptions.costAssumptions.cogsPercentYear3 * 100) || ""}
                  onChange={(e) =>
                    update({
                      costAssumptions: {
                        ...assumptions.costAssumptions,
                        cogsPercentYear3: Number(e.target.value) / 100,
                      },
                    })
                  }
                />
              </div>
            </div>

            {/* Fixed Costs */}
            <div>
              <span className="text-xs font-semibold text-white/70">Fixed Cost Categories</span>
              {assumptions.costAssumptions.fixedCostCategories.map((fc, idx) => (
                <div key={idx} className="grid grid-cols-4 gap-2 mt-1 items-end">
                  <div>
                    <label className={labelCls}>Name</label>
                    <input
                      className={inputCls}
                      value={fc.name}
                      onChange={(e) => {
                        const cats = [...assumptions.costAssumptions.fixedCostCategories];
                        cats[idx] = { ...cats[idx], name: e.target.value };
                        update({ costAssumptions: { ...assumptions.costAssumptions, fixedCostCategories: cats } });
                      }}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Annual ($)</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={fc.annualAmount || ""}
                      onChange={(e) => {
                        const cats = [...assumptions.costAssumptions.fixedCostCategories];
                        cats[idx] = { ...cats[idx], annualAmount: Number(e.target.value) };
                        update({ costAssumptions: { ...assumptions.costAssumptions, fixedCostCategories: cats } });
                      }}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Escalation %</label>
                    <input
                      className={inputCls}
                      type="number"
                      step="0.01"
                      value={(fc.escalationPctPerYear * 100) || ""}
                      onChange={(e) => {
                        const cats = [...assumptions.costAssumptions.fixedCostCategories];
                        cats[idx] = { ...cats[idx], escalationPctPerYear: Number(e.target.value) / 100 };
                        update({ costAssumptions: { ...assumptions.costAssumptions, fixedCostCategories: cats } });
                      }}
                    />
                  </div>
                  <button
                    onClick={() => {
                      const cats = assumptions.costAssumptions.fixedCostCategories.filter((_, i) => i !== idx);
                      update({ costAssumptions: { ...assumptions.costAssumptions, fixedCostCategories: cats } });
                    }}
                    className="text-xs text-red-400 hover:text-red-300 pb-1"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button onClick={addFixedCost} className="mt-1 text-sm text-blue-400 hover:text-blue-300">
                + Add Fixed Cost
              </button>
            </div>

            {/* Planned Hires */}
            <div>
              <span className="text-xs font-semibold text-white/70">Planned Hires</span>
              {assumptions.costAssumptions.plannedHires.map((hire, idx) => (
                <div key={idx} className="grid grid-cols-4 gap-2 mt-1 items-end">
                  <div>
                    <label className={labelCls}>Role</label>
                    <input
                      className={inputCls}
                      value={hire.role}
                      onChange={(e) => {
                        const hires = [...assumptions.costAssumptions.plannedHires];
                        hires[idx] = { ...hires[idx], role: e.target.value };
                        update({ costAssumptions: { ...assumptions.costAssumptions, plannedHires: hires } });
                      }}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Start Month (1-36)</label>
                    <input
                      className={inputCls}
                      type="number"
                      min={1}
                      max={36}
                      value={hire.startMonth || ""}
                      onChange={(e) => {
                        const hires = [...assumptions.costAssumptions.plannedHires];
                        hires[idx] = { ...hires[idx], startMonth: Number(e.target.value) };
                        update({ costAssumptions: { ...assumptions.costAssumptions, plannedHires: hires } });
                      }}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Annual Salary ($)</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={hire.annualSalary || ""}
                      onChange={(e) => {
                        const hires = [...assumptions.costAssumptions.plannedHires];
                        hires[idx] = { ...hires[idx], annualSalary: Number(e.target.value) };
                        update({ costAssumptions: { ...assumptions.costAssumptions, plannedHires: hires } });
                      }}
                    />
                  </div>
                  <button
                    onClick={() => {
                      const hires = assumptions.costAssumptions.plannedHires.filter((_, i) => i !== idx);
                      update({ costAssumptions: { ...assumptions.costAssumptions, plannedHires: hires } });
                    }}
                    className="text-xs text-red-400 hover:text-red-300 pb-1"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button onClick={addHire} className="mt-1 text-sm text-blue-400 hover:text-blue-300">
                + Add Hire
              </button>
            </div>

            {/* Capex */}
            <div>
              <span className="text-xs font-semibold text-white/70">Capital Expenditures</span>
              {assumptions.costAssumptions.plannedCapex.map((cx, idx) => (
                <div key={idx} className="grid grid-cols-4 gap-2 mt-1 items-end">
                  <div>
                    <label className={labelCls}>Description</label>
                    <input
                      className={inputCls}
                      value={cx.description}
                      onChange={(e) => {
                        const capex = [...assumptions.costAssumptions.plannedCapex];
                        capex[idx] = { ...capex[idx], description: e.target.value };
                        update({ costAssumptions: { ...assumptions.costAssumptions, plannedCapex: capex } });
                      }}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Amount ($)</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={cx.amount || ""}
                      onChange={(e) => {
                        const capex = [...assumptions.costAssumptions.plannedCapex];
                        capex[idx] = { ...capex[idx], amount: Number(e.target.value) };
                        update({ costAssumptions: { ...assumptions.costAssumptions, plannedCapex: capex } });
                      }}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Year</label>
                    <select
                      className={inputCls}
                      value={cx.year}
                      onChange={(e) => {
                        const capex = [...assumptions.costAssumptions.plannedCapex];
                        capex[idx] = { ...capex[idx], year: Number(e.target.value) as 1 | 2 | 3 };
                        update({ costAssumptions: { ...assumptions.costAssumptions, plannedCapex: capex } });
                      }}
                    >
                      <option value={1}>Year 1</option>
                      <option value={2}>Year 2</option>
                      <option value={3}>Year 3</option>
                    </select>
                  </div>
                  <button
                    onClick={() => {
                      const capex = assumptions.costAssumptions.plannedCapex.filter((_, i) => i !== idx);
                      update({ costAssumptions: { ...assumptions.costAssumptions, plannedCapex: capex } });
                    }}
                    className="text-xs text-red-400 hover:text-red-300 pb-1"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button onClick={addCapex} className="mt-1 text-sm text-blue-400 hover:text-blue-300">
                + Add Capex
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Working Capital */}
      <div>
        <SectionHeader
          title="3. Working Capital"
          complete={(assumptions.workingCapital?.targetDSO ?? 0) > 0}
          open={!!openSections.workingCapital}
          onToggle={() => toggleSection("workingCapital")}
        />
        {openSections.workingCapital && (
          <div className="mt-2 pl-2 grid grid-cols-3 gap-3">
            <div>
              <div className="flex items-center gap-1 mb-1">
                <label className={labelCls + " mb-0"}>Days Sales Outstanding</label>
                <NAICSBadge meta={prefillMeta} />
              </div>
              <input
                className={inputCls}
                type="number"
                value={assumptions.workingCapital.targetDSO || ""}
                onChange={(e) =>
                  update({
                    workingCapital: {
                      ...assumptions.workingCapital,
                      targetDSO: Number(e.target.value),
                    },
                  })
                }
              />
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1">
                <label className={labelCls + " mb-0"}>Days Payable Outstanding</label>
                <NAICSBadge meta={prefillMeta} />
              </div>
              <input
                className={inputCls}
                type="number"
                value={assumptions.workingCapital.targetDPO || ""}
                onChange={(e) =>
                  update({
                    workingCapital: {
                      ...assumptions.workingCapital,
                      targetDPO: Number(e.target.value),
                    },
                  })
                }
              />
            </div>
            <div>
              <label className={labelCls}>Inventory Turns (optional)</label>
              <input
                className={inputCls}
                type="number"
                value={assumptions.workingCapital.inventoryTurns ?? ""}
                onChange={(e) =>
                  update({
                    workingCapital: {
                      ...assumptions.workingCapital,
                      inventoryTurns: e.target.value ? Number(e.target.value) : null,
                    },
                  })
                }
              />
            </div>
          </div>
        )}
      </div>

      {/* Section 4: Loan Impact */}
      <div>
        <SectionHeader
          title="4. Loan Impact"
          complete={(assumptions.loanImpact?.loanAmount ?? 0) > 0}
          open={!!openSections.loan}
          onToggle={() => toggleSection("loan")}
        />
        {openSections.loan && (
          <div className="mt-2 space-y-3 pl-2">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>
                  Loan Amount ($)
                  {initial === null && (assumptions.loanImpact?.loanAmount ?? 0) > 0 && (
                    <PrefilledBadge />
                  )}
                </label>
                <input
                  className={inputCls}
                  type="number"
                  value={assumptions.loanImpact.loanAmount || ""}
                  onChange={(e) =>
                    update({
                      loanImpact: {
                        ...assumptions.loanImpact,
                        loanAmount: Number(e.target.value),
                      },
                    })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Term (months)</label>
                <input
                  className={inputCls}
                  type="number"
                  value={assumptions.loanImpact.termMonths || ""}
                  onChange={(e) =>
                    update({
                      loanImpact: {
                        ...assumptions.loanImpact,
                        termMonths: Number(e.target.value),
                      },
                    })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Interest Rate (%)</label>
                <input
                  className={inputCls}
                  type="number"
                  step="0.01"
                  value={(assumptions.loanImpact.interestRate * 100) || ""}
                  onChange={(e) =>
                    update({
                      loanImpact: {
                        ...assumptions.loanImpact,
                        interestRate: Number(e.target.value) / 100,
                      },
                    })
                  }
                />
              </div>
            </div>

            {/* Existing Debt */}
            <div>
              <span className="text-xs font-semibold text-white/70">Existing Debt</span>
              {assumptions.loanImpact.existingDebt.map((debt, idx) => (
                <div key={idx} className="grid grid-cols-4 gap-2 mt-1 items-end">
                  <div>
                    <label className={labelCls}>Description</label>
                    <input
                      className={inputCls}
                      value={debt.description}
                      onChange={(e) => {
                        const debts = [...assumptions.loanImpact.existingDebt];
                        debts[idx] = { ...debts[idx], description: e.target.value };
                        update({ loanImpact: { ...assumptions.loanImpact, existingDebt: debts } });
                      }}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Monthly Payment ($)</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={debt.monthlyPayment || ""}
                      onChange={(e) => {
                        const debts = [...assumptions.loanImpact.existingDebt];
                        debts[idx] = { ...debts[idx], monthlyPayment: Number(e.target.value) };
                        update({ loanImpact: { ...assumptions.loanImpact, existingDebt: debts } });
                      }}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Remaining Term (mo)</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={debt.remainingTermMonths || ""}
                      onChange={(e) => {
                        const debts = [...assumptions.loanImpact.existingDebt];
                        debts[idx] = { ...debts[idx], remainingTermMonths: Number(e.target.value) };
                        update({ loanImpact: { ...assumptions.loanImpact, existingDebt: debts } });
                      }}
                    />
                  </div>
                  <button
                    onClick={() => {
                      const debts = assumptions.loanImpact.existingDebt.filter((_, i) => i !== idx);
                      update({ loanImpact: { ...assumptions.loanImpact, existingDebt: debts } });
                    }}
                    className="text-xs text-red-400 hover:text-red-300 pb-1"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button onClick={addDebt} className="mt-1 text-sm text-blue-400 hover:text-blue-300">
                + Add Existing Debt
              </button>
            </div>

            {/* Revenue Impact */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>Revenue Impact Start Month</label>
                <input
                  className={inputCls}
                  type="number"
                  min={1}
                  max={12}
                  value={assumptions.loanImpact.revenueImpactStartMonth ?? ""}
                  onChange={(e) =>
                    update({
                      loanImpact: {
                        ...assumptions.loanImpact,
                        revenueImpactStartMonth: e.target.value ? Number(e.target.value) : undefined,
                      },
                    })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Additional Growth %</label>
                <input
                  className={inputCls}
                  type="number"
                  step="0.01"
                  value={assumptions.loanImpact.revenueImpactPct ? assumptions.loanImpact.revenueImpactPct * 100 : ""}
                  onChange={(e) =>
                    update({
                      loanImpact: {
                        ...assumptions.loanImpact,
                        revenueImpactPct: e.target.value ? Number(e.target.value) / 100 : undefined,
                      },
                    })
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <input
                  className={inputCls}
                  value={assumptions.loanImpact.revenueImpactDescription ?? ""}
                  onChange={(e) =>
                    update({
                      loanImpact: {
                        ...assumptions.loanImpact,
                        revenueImpactDescription: e.target.value || undefined,
                      },
                    })
                  }
                  placeholder="e.g. New equipment increases capacity"
                />
              </div>
            </div>

            {/* Phase BPG — Sources of Funds */}
            <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
              <div className="text-xs font-semibold text-white/70">
                Sources of Funds
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Equity Injection ($)</label>
                  <input
                    className={inputCls}
                    type="number"
                    value={assumptions.loanImpact.equityInjectionAmount || ""}
                    onChange={(e) =>
                      update({
                        loanImpact: {
                          ...assumptions.loanImpact,
                          equityInjectionAmount: Number(e.target.value) || 0,
                        },
                      })
                    }
                    placeholder="e.g. 50000"
                  />
                  {(tipsByField.get("loanImpact.equityInjectionAmount") ?? []).map(
                    (t, i) => (
                      <CoachingCallout key={i} tip={t} />
                    ),
                  )}
                </div>
                <div>
                  <label className={labelCls}>Source</label>
                  <select
                    className={inputCls}
                    value={assumptions.loanImpact.equityInjectionSource ?? "cash_savings"}
                    onChange={(e) =>
                      update({
                        loanImpact: {
                          ...assumptions.loanImpact,
                          equityInjectionSource: e.target.value as SBAAssumptions["loanImpact"]["equityInjectionSource"],
                        },
                      })
                    }
                  >
                    <option value="cash_savings">Cash Savings</option>
                    <option value="401k_rollover">401(k) Rollover</option>
                    <option value="gift">Gift</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={labelCls}>Seller Financing ($)</label>
                <input
                  className={inputCls}
                  type="number"
                  value={assumptions.loanImpact.sellerFinancingAmount || ""}
                  onChange={(e) =>
                    update({
                      loanImpact: {
                        ...assumptions.loanImpact,
                        sellerFinancingAmount: Number(e.target.value) || 0,
                      },
                    })
                  }
                  placeholder="0 if none"
                />
              </div>
              {(assumptions.loanImpact.sellerFinancingAmount ?? 0) > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Seller Term (months)</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={assumptions.loanImpact.sellerFinancingTermMonths || ""}
                      onChange={(e) =>
                        update({
                          loanImpact: {
                            ...assumptions.loanImpact,
                            sellerFinancingTermMonths: Number(e.target.value) || 0,
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Seller Rate (%)</label>
                    <input
                      className={inputCls}
                      type="number"
                      step="0.01"
                      value={(assumptions.loanImpact.sellerFinancingRate ?? 0) * 100 || ""}
                      onChange={(e) =>
                        update({
                          loanImpact: {
                            ...assumptions.loanImpact,
                            sellerFinancingRate: Number(e.target.value) / 100 || 0,
                          },
                        })
                      }
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs text-white/50">Other Sources</div>
                {(assumptions.loanImpact.otherSources ?? []).map((o, idx) => (
                  <div key={idx} className="grid grid-cols-5 gap-2">
                    <input
                      className={inputCls + " col-span-3"}
                      value={o.description}
                      placeholder="Description"
                      onChange={(e) => {
                        const next = [...(assumptions.loanImpact.otherSources ?? [])];
                        next[idx] = { ...next[idx], description: e.target.value };
                        update({
                          loanImpact: { ...assumptions.loanImpact, otherSources: next },
                        });
                      }}
                    />
                    <input
                      className={inputCls + " col-span-1"}
                      type="number"
                      value={o.amount || ""}
                      placeholder="Amount"
                      onChange={(e) => {
                        const next = [...(assumptions.loanImpact.otherSources ?? [])];
                        next[idx] = { ...next[idx], amount: Number(e.target.value) || 0 };
                        update({
                          loanImpact: { ...assumptions.loanImpact, otherSources: next },
                        });
                      }}
                    />
                    <button
                      type="button"
                      className="text-xs text-red-400 hover:text-red-300"
                      onClick={() => {
                        const next = (assumptions.loanImpact.otherSources ?? []).filter(
                          (_, i) => i !== idx,
                        );
                        update({
                          loanImpact: { ...assumptions.loanImpact, otherSources: next },
                        });
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-sm text-blue-400 hover:text-blue-300"
                  onClick={() => {
                    const next = [
                      ...(assumptions.loanImpact.otherSources ?? []),
                      { description: "", amount: 0 },
                    ];
                    update({
                      loanImpact: { ...assumptions.loanImpact, otherSources: next },
                    });
                  }}
                >
                  + Add Other Source
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Section 5: Management Team */}
      <div>
        <SectionHeader
          title="5. Management Team"
          complete={(assumptions.managementTeam?.length ?? 0) > 0}
          open={!!openSections.management}
          onToggle={() => toggleSection("management")}
        />
        {openSections.management && (
          <div className="mt-2 space-y-3 pl-2">
            {/* Phase 2 — hint when team was auto-filled from ownership */}
            {assumptions.managementTeam.length > 0 &&
              assumptions.managementTeam.every((m) => !m.bio && m.yearsInIndustry === 0) && (
                <div className="rounded-md border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-300">
                  Pre-filled from deal ownership records — please add each
                  member&apos;s years of experience and a short bio so the
                  business plan narrative reads accurately.
                </div>
              )}
            {assumptions.managementTeam.map((member, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Member {idx + 1}</span>
                  <button
                    onClick={() => removeMember(idx)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className={labelCls}>Name</label>
                    <input
                      className={inputCls}
                      value={member.name}
                      onChange={(e) => updateMember(idx, { name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Title</label>
                    <input
                      className={inputCls}
                      value={member.title}
                      onChange={(e) => updateMember(idx, { title: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Years in Industry</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={member.yearsInIndustry || ""}
                      onChange={(e) =>
                        updateMember(idx, { yearsInIndustry: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>
                    Ownership % (optional)
                  </label>
                  <input
                    className={inputCls}
                    type="number"
                    value={member.ownershipPct ?? ""}
                    onChange={(e) =>
                      updateMember(idx, {
                        ownershipPct: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>
                    Bio (min 20 characters)
                    {member.bio && member.bio.length < 20 && (
                      <span className="ml-2 text-red-400">
                        {20 - member.bio.length} more chars needed
                      </span>
                    )}
                  </label>
                  <textarea
                    className={inputCls + " min-h-[60px]"}
                    value={member.bio}
                    onChange={(e) => updateMember(idx, { bio: e.target.value })}
                    placeholder="Professional background and relevant experience..."
                  />
                </div>
              </div>
            ))}
            <button
              onClick={addMember}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              + Add Team Member
            </button>
          </div>
        )}
      </div>

      {/* Phase BPG — Section 6: Guarantor Cash Flow (20%+ owners) */}
      <div>
        <SectionHeader
          title="6. Guarantor Cash Flow"
          complete={guarantors.length > 0}
          open={!!openSections.guarantors}
          onToggle={() => toggleSection("guarantors")}
        />
        {openSections.guarantors && (
          <div className="mt-2 space-y-3 pl-2">
            {!guarantorsLoaded && (
              <div className="text-xs text-white/50">Loading guarantors…</div>
            )}
            {guarantorsLoaded && guarantors.length === 0 && (
              <div className="text-xs text-white/50">
                No owners with 20%+ ownership were found for this deal.
                Add owners via the Intake flow first.
              </div>
            )}
            {guarantors.map((g) => (
              <div
                key={g.entity_id}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white/80">
                    {g.display_name ?? "Guarantor"}
                  </span>
                  <span className="text-xs text-white/50">
                    {g.ownership_pct.toFixed(1)}% ownership
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>W-2 / Salary ($)</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={g.w2_salary || ""}
                      onChange={(e) =>
                        updateGuarantor(g.entity_id, {
                          w2_salary: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Other Personal Income ($)</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={g.other_personal_income || ""}
                      onChange={(e) =>
                        updateGuarantor(g.entity_id, {
                          other_personal_income: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Mortgage Payment ($/mo)</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={g.mortgage_payment || ""}
                      onChange={(e) =>
                        updateGuarantor(g.entity_id, {
                          mortgage_payment: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Auto Payments ($/mo)</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={g.auto_payments || ""}
                      onChange={(e) =>
                        updateGuarantor(g.entity_id, {
                          auto_payments: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className={labelCls}>Student Loans ($/mo)</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={g.student_loans || ""}
                      onChange={(e) =>
                        updateGuarantor(g.entity_id, {
                          student_loans: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>CC Minimums ($/mo)</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={g.credit_card_minimums || ""}
                      onChange={(e) =>
                        updateGuarantor(g.entity_id, {
                          credit_card_minimums: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Other Debt ($/mo)</label>
                    <input
                      className={inputCls}
                      type="number"
                      value={g.other_personal_debt || ""}
                      onChange={(e) =>
                        updateGuarantor(g.entity_id, {
                          other_personal_debt: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
            {guarantors.length > 0 && (
              <button
                type="button"
                onClick={saveGuarantors}
                className="text-sm rounded-md border border-white/20 px-3 py-1.5 text-white/80 hover:bg-white/[0.06]"
              >
                Save Guarantor Cash Flow
              </button>
            )}
          </div>
        )}
      </div>

      {/* Confirm / Reopen button */}
      <div className="pt-2">
        {isConfirmed ? (
          <button
            onClick={handleReopen}
            className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10"
          >
            Confirmed — Re-open to Edit
          </button>
        ) : (
          <button
            disabled={completionPct < 100}
            onClick={async () => {
              await saveGuarantors();
              await handleConfirm();
            }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirm Assumptions
          </button>
        )}
      </div>
    </div>
  );
}
