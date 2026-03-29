"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  SBAAssumptions,
  RevenueStream,
  FixedCostCategory,
  PlannedHire,
  PlannedCapex,
  ExistingDebtItem,
  ManagementMember,
} from "@/lib/sba/sbaReadinessTypes";
import { computeAssumptionsCompletionPct } from "@/lib/sba/sbaAssumptionsValidator";

interface Props {
  dealId: string;
  initial: SBAAssumptions | null;
  prefilled: Partial<SBAAssumptions>;
  onConfirmed: () => void;
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

export default function AssumptionInterview({ dealId, initial, prefilled, onConfirmed }: Props) {
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
  });

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

  const handleConfirm = async () => {
    const next = { ...assumptions, status: "confirmed" as const };
    setAssumptions(next);
    try {
      await fetch(`/api/deals/${dealId}/sba/assumptions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: { status: "confirmed" } }),
      });
      onConfirmed();
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
                    <label className={labelCls}>Y1 Growth %</label>
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
              <label className={labelCls}>Days Sales Outstanding</label>
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
              <label className={labelCls}>Days Payable Outstanding</label>
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
            onClick={handleConfirm}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirm Assumptions
          </button>
        )}
      </div>
    </div>
  );
}
