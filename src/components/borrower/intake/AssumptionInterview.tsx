"use client";

// src/components/borrower/intake/AssumptionInterview.tsx
// Phase 85-BPG-A — Borrower-facing 5-section SBA assumption interview.
// Auto-prefills from deal_financial_facts + intake owners/loan; debounced
// save to buddy_sba_assumptions via the portal-token route.

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  RevenueStream,
  FixedCostCategory,
  PlannedHire,
  PlannedCapex,
  ManagementMember,
} from "@/lib/sba/sbaReadinessTypes";

type Props = {
  token: string;
  dealId: string;
};

type SubStep =
  | "revenue"
  | "costs"
  | "working_capital"
  | "loan_impact"
  | "management";

const SUB_STEPS: { key: SubStep; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "costs", label: "Costs" },
  { key: "working_capital", label: "Working Capital" },
  { key: "loan_impact", label: "Loan Details" },
  { key: "management", label: "Management Team" },
];

const inputCls =
  "w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

const labelCls = "block text-sm font-medium text-gray-300 mb-1.5";

export function AssumptionInterview({ token }: Props) {
  const [loading, setLoading] = useState(true);
  const [subStep, setSubStep] = useState<SubStep>("revenue");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Section state ───────────────────────────────────────────────────────
  const [revenueStreams, setRevenueStreams] = useState<RevenueStream[]>([]);
  const [cogsY1, setCogsY1] = useState("");
  const [cogsY2, setCogsY2] = useState("");
  const [cogsY3, setCogsY3] = useState("");
  const [fixedCosts, setFixedCosts] = useState<FixedCostCategory[]>([]);
  const [hires, setHires] = useState<PlannedHire[]>([]);
  const [capex, setCapex] = useState<PlannedCapex[]>([]);
  const [dso, setDso] = useState("45");
  const [dpo, setDpo] = useState("30");
  const [invTurns, setInvTurns] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [termMonths, setTermMonths] = useState("120");
  const [interestRate, setInterestRate] = useState("7.25");
  const [mgmtTeam, setMgmtTeam] = useState<ManagementMember[]>([]);

  // ── Load existing + prefilled ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/borrower/portal/${token}/sba-assumptions`,
        );
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) {
          setLoading(false);
          return;
        }

        // Prefer existing saved assumptions; fall back to prefilled defaults.
        const data = json.assumptions ?? json.prefilled;
        if (!data) {
          setLoading(false);
          return;
        }

        if (data.revenueStreams?.length) setRevenueStreams(data.revenueStreams);
        if (data.costAssumptions) {
          if (data.costAssumptions.cogsPercentYear1 != null)
            setCogsY1(String(Math.round(data.costAssumptions.cogsPercentYear1 * 100)));
          if (data.costAssumptions.cogsPercentYear2 != null)
            setCogsY2(String(Math.round(data.costAssumptions.cogsPercentYear2 * 100)));
          if (data.costAssumptions.cogsPercentYear3 != null)
            setCogsY3(String(Math.round(data.costAssumptions.cogsPercentYear3 * 100)));
          if (data.costAssumptions.fixedCostCategories?.length)
            setFixedCosts(data.costAssumptions.fixedCostCategories);
          if (data.costAssumptions.plannedHires?.length)
            setHires(data.costAssumptions.plannedHires);
          if (data.costAssumptions.plannedCapex?.length)
            setCapex(data.costAssumptions.plannedCapex);
        }
        if (data.workingCapital) {
          setDso(String(data.workingCapital.targetDSO ?? 45));
          setDpo(String(data.workingCapital.targetDPO ?? 30));
          setInvTurns(
            data.workingCapital.inventoryTurns
              ? String(data.workingCapital.inventoryTurns)
              : "",
          );
        }
        if (data.loanImpact) {
          setLoanAmount(
            data.loanImpact.loanAmount
              ? String(data.loanImpact.loanAmount)
              : "",
          );
          setTermMonths(String(data.loanImpact.termMonths ?? 120));
          setInterestRate(
            ((data.loanImpact.interestRate ?? 0.0725) * 100).toFixed(2),
          );
        }
        if (data.managementTeam?.length) setMgmtTeam(data.managementTeam);
      } catch {
        setError("Failed to load projections data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // ── Debounced save ─────────────────────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const patch = {
        revenueStreams,
        costAssumptions: {
          cogsPercentYear1: parseFloat(cogsY1) / 100 || 0.5,
          cogsPercentYear2: parseFloat(cogsY2) / 100 || 0.5,
          cogsPercentYear3: parseFloat(cogsY3) / 100 || 0.5,
          fixedCostCategories: fixedCosts,
          plannedHires: hires,
          plannedCapex: capex,
        },
        workingCapital: {
          targetDSO: parseInt(dso, 10) || 45,
          targetDPO: parseInt(dpo, 10) || 30,
          inventoryTurns: invTurns ? parseInt(invTurns, 10) : null,
        },
        loanImpact: {
          loanAmount: parseFloat(loanAmount.replace(/[^0-9.]/g, "")) || 0,
          termMonths: parseInt(termMonths, 10) || 120,
          interestRate: (parseFloat(interestRate) || 7.25) / 100,
          existingDebt: [],
        },
        managementTeam: mgmtTeam,
      };

      const res = await fetch(
        `/api/borrower/portal/${token}/sba-assumptions`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patch }),
        },
      );

      const json = await res.json();
      if (!json.ok) setError(json.error ?? "Save failed");
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [
    token,
    revenueStreams,
    cogsY1,
    cogsY2,
    cogsY3,
    fixedCosts,
    hires,
    capex,
    dso,
    dpo,
    invTurns,
    loanAmount,
    termMonths,
    interestRate,
    mgmtTeam,
  ]);

  const debouncedSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 800);
  }, [save]);

  useEffect(() => {
    if (!loading) debouncedSave();
  }, [
    revenueStreams,
    cogsY1,
    cogsY2,
    cogsY3,
    fixedCosts,
    hires,
    capex,
    dso,
    dpo,
    invTurns,
    loanAmount,
    termMonths,
    interestRate,
    mgmtTeam,
    loading,
    debouncedSave,
  ]);

  const subStepIdx = SUB_STEPS.findIndex((s) => s.key === subStep);
  const canGoBack = subStepIdx > 0;
  const canGoForward = subStepIdx < SUB_STEPS.length - 1;

  if (loading) {
    return (
      <div className="text-sm text-gray-400 py-4">
        Loading projections data…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-white">Financial Projections</h2>
      <p className="text-sm text-gray-400">
        We&apos;ll build 3-year projections for your SBA application. Most
        fields are pre-filled from your documents — just review and adjust.
      </p>

      {/* Sub-step indicator */}
      <div className="flex gap-1">
        {SUB_STEPS.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setSubStep(s.key)}
            className={`flex-1 py-1.5 text-xs rounded-md transition ${
              s.key === subStep
                ? "bg-blue-600 text-white font-medium"
                : i < subStepIdx
                  ? "bg-green-900/30 text-green-400"
                  : "bg-neutral-800 text-neutral-500"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* ── Revenue ───────────────────────────────────────────────── */}
      {subStep === "revenue" && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            How does your business make money? We&apos;ve pre-filled based on your
            financial documents.
          </p>
          {revenueStreams.map((stream, idx) => (
            <div
              key={stream.id}
              className="border border-neutral-800 rounded-lg p-4 space-y-3"
            >
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-300">
                  Revenue Stream {idx + 1}
                </span>
                {revenueStreams.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setRevenueStreams((prev) =>
                        prev.filter((s) => s.id !== stream.id),
                      )
                    }
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div>
                <label className={labelCls}>Name</label>
                <input
                  className={inputCls}
                  value={stream.name}
                  onChange={(e) =>
                    setRevenueStreams((prev) =>
                      prev.map((s) =>
                        s.id === stream.id ? { ...s, name: e.target.value } : s,
                      ),
                    )
                  }
                  placeholder="e.g., Restaurant Sales, Catering"
                />
              </div>
              <div>
                <label className={labelCls}>Base Annual Revenue ($)</label>
                <input
                  className={inputCls}
                  value={
                    stream.baseAnnualRevenue
                      ? String(Math.round(stream.baseAnnualRevenue))
                      : ""
                  }
                  inputMode="numeric"
                  onChange={(e) => {
                    const v =
                      parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0;
                    setRevenueStreams((prev) =>
                      prev.map((s) =>
                        s.id === stream.id
                          ? { ...s, baseAnnualRevenue: v }
                          : s,
                      ),
                    );
                  }}
                  placeholder="e.g., 850000"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Year 1 Growth %</label>
                  <input
                    className={inputCls}
                    value={String(Math.round((stream.growthRateYear1 ?? 0) * 100))}
                    inputMode="numeric"
                    onChange={(e) => {
                      const v = (parseFloat(e.target.value) || 0) / 100;
                      setRevenueStreams((prev) =>
                        prev.map((s) =>
                          s.id === stream.id
                            ? { ...s, growthRateYear1: v }
                            : s,
                        ),
                      );
                    }}
                    placeholder="10"
                  />
                </div>
                <div>
                  <label className={labelCls}>Year 2 Growth %</label>
                  <input
                    className={inputCls}
                    value={String(Math.round((stream.growthRateYear2 ?? 0) * 100))}
                    inputMode="numeric"
                    onChange={(e) => {
                      const v = (parseFloat(e.target.value) || 0) / 100;
                      setRevenueStreams((prev) =>
                        prev.map((s) =>
                          s.id === stream.id
                            ? { ...s, growthRateYear2: v }
                            : s,
                        ),
                      );
                    }}
                    placeholder="8"
                  />
                </div>
                <div>
                  <label className={labelCls}>Year 3 Growth %</label>
                  <input
                    className={inputCls}
                    value={String(Math.round((stream.growthRateYear3 ?? 0) * 100))}
                    inputMode="numeric"
                    onChange={(e) => {
                      const v = (parseFloat(e.target.value) || 0) / 100;
                      setRevenueStreams((prev) =>
                        prev.map((s) =>
                          s.id === stream.id
                            ? { ...s, growthRateYear3: v }
                            : s,
                        ),
                      );
                    }}
                    placeholder="6"
                  />
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setRevenueStreams((prev) => [
                ...prev,
                {
                  id: `stream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  name: "",
                  baseAnnualRevenue: 0,
                  growthRateYear1: 0.1,
                  growthRateYear2: 0.08,
                  growthRateYear3: 0.06,
                  pricingModel: "flat",
                  seasonalityProfile: null,
                },
              ])
            }
            className="w-full py-3 rounded-lg border border-dashed border-neutral-700 text-gray-400 text-sm hover:border-neutral-500 transition min-h-[44px]"
          >
            + Add Revenue Stream
          </button>
        </div>
      )}

      {/* ── Costs ─────────────────────────────────────────────────── */}
      {subStep === "costs" && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            What does it cost to run your business?
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>COGS % Year 1</label>
              <input
                className={inputCls}
                value={cogsY1}
                inputMode="numeric"
                onChange={(e) => setCogsY1(e.target.value)}
                placeholder="30"
              />
            </div>
            <div>
              <label className={labelCls}>COGS % Year 2</label>
              <input
                className={inputCls}
                value={cogsY2}
                inputMode="numeric"
                onChange={(e) => setCogsY2(e.target.value)}
                placeholder="29"
              />
            </div>
            <div>
              <label className={labelCls}>COGS % Year 3</label>
              <input
                className={inputCls}
                value={cogsY3}
                inputMode="numeric"
                onChange={(e) => setCogsY3(e.target.value)}
                placeholder="28"
              />
            </div>
          </div>

          <div className="pt-2">
            <label className="text-sm font-medium text-gray-300 mb-2 block">
              Fixed Costs
            </label>
            {fixedCosts.map((fc, idx) => (
              <div key={idx} className="grid grid-cols-3 gap-2 mb-2">
                <input
                  className={inputCls}
                  value={fc.name}
                  placeholder="e.g., Rent"
                  onChange={(e) =>
                    setFixedCosts((prev) =>
                      prev.map((c, i) =>
                        i === idx ? { ...c, name: e.target.value } : c,
                      ),
                    )
                  }
                />
                <input
                  className={inputCls}
                  value={
                    fc.annualAmount ? String(Math.round(fc.annualAmount)) : ""
                  }
                  placeholder="Annual $"
                  inputMode="numeric"
                  onChange={(e) =>
                    setFixedCosts((prev) =>
                      prev.map((c, i) =>
                        i === idx
                          ? {
                              ...c,
                              annualAmount:
                                parseFloat(
                                  e.target.value.replace(/[^0-9.]/g, ""),
                                ) || 0,
                            }
                          : c,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setFixedCosts((prev) => prev.filter((_, i) => i !== idx))
                  }
                  className="text-xs text-red-400 hover:text-red-300 self-center"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setFixedCosts((prev) => [
                  ...prev,
                  { name: "", annualAmount: 0, escalationPctPerYear: 0.03 },
                ])
              }
              className="text-xs text-blue-400 hover:text-blue-300 mt-1"
            >
              + Add Fixed Cost
            </button>
          </div>

          <div className="pt-2">
            <label className="text-sm font-medium text-gray-300 mb-2 block">
              Planned Hires
            </label>
            {hires.map((h, idx) => (
              <div key={idx} className="grid grid-cols-4 gap-2 mb-2">
                <input
                  className={inputCls}
                  value={h.role}
                  placeholder="Role"
                  onChange={(e) =>
                    setHires((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, role: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  className={inputCls}
                  value={
                    h.annualSalary ? String(Math.round(h.annualSalary)) : ""
                  }
                  placeholder="Salary $"
                  inputMode="numeric"
                  onChange={(e) =>
                    setHires((prev) =>
                      prev.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              annualSalary:
                                parseFloat(
                                  e.target.value.replace(/[^0-9.]/g, ""),
                                ) || 0,
                            }
                          : x,
                      ),
                    )
                  }
                />
                <input
                  className={inputCls}
                  value={h.startMonth ? String(h.startMonth) : ""}
                  placeholder="Start month"
                  inputMode="numeric"
                  onChange={(e) =>
                    setHires((prev) =>
                      prev.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              startMonth: parseInt(e.target.value, 10) || 1,
                            }
                          : x,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setHires((prev) => prev.filter((_, i) => i !== idx))
                  }
                  className="text-xs text-red-400 hover:text-red-300 self-center"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setHires((prev) => [
                  ...prev,
                  { role: "", startMonth: 1, annualSalary: 0 },
                ])
              }
              className="text-xs text-blue-400 hover:text-blue-300 mt-1"
            >
              + Add Hire
            </button>
          </div>

          <div className="pt-2">
            <label className="text-sm font-medium text-gray-300 mb-2 block">
              Planned Capital Expenditures
            </label>
            {capex.map((c, idx) => (
              <div key={idx} className="grid grid-cols-4 gap-2 mb-2">
                <input
                  className={inputCls}
                  value={c.description}
                  placeholder="Description"
                  onChange={(e) =>
                    setCapex((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, description: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  className={inputCls}
                  value={c.amount ? String(Math.round(c.amount)) : ""}
                  placeholder="Amount $"
                  inputMode="numeric"
                  onChange={(e) =>
                    setCapex((prev) =>
                      prev.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              amount:
                                parseFloat(
                                  e.target.value.replace(/[^0-9.]/g, ""),
                                ) || 0,
                            }
                          : x,
                      ),
                    )
                  }
                />
                <select
                  className={inputCls}
                  value={String(c.year)}
                  onChange={(e) =>
                    setCapex((prev) =>
                      prev.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              year: (parseInt(e.target.value, 10) || 1) as 1 | 2 | 3,
                            }
                          : x,
                      ),
                    )
                  }
                >
                  <option value="1">Year 1</option>
                  <option value="2">Year 2</option>
                  <option value="3">Year 3</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    setCapex((prev) => prev.filter((_, i) => i !== idx))
                  }
                  className="text-xs text-red-400 hover:text-red-300 self-center"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setCapex((prev) => [
                  ...prev,
                  { description: "", amount: 0, year: 1 },
                ])
              }
              className="text-xs text-blue-400 hover:text-blue-300 mt-1"
            >
              + Add Capex
            </button>
          </div>
        </div>
      )}

      {/* ── Working Capital ───────────────────────────────────────── */}
      {subStep === "working_capital" && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            These defaults work for most businesses. Adjust if your industry has
            unusual payment cycles.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Days Sales Outstanding</label>
              <input
                className={inputCls}
                value={dso}
                inputMode="numeric"
                onChange={(e) => setDso(e.target.value)}
                placeholder="45"
              />
              <p className="text-[10px] text-gray-600 mt-1">
                How fast customers pay you
              </p>
            </div>
            <div>
              <label className={labelCls}>Days Payable Outstanding</label>
              <input
                className={inputCls}
                value={dpo}
                inputMode="numeric"
                onChange={(e) => setDpo(e.target.value)}
                placeholder="30"
              />
              <p className="text-[10px] text-gray-600 mt-1">
                How fast you pay vendors
              </p>
            </div>
            <div>
              <label className={labelCls}>Inventory Turns / Year</label>
              <input
                className={inputCls}
                value={invTurns}
                inputMode="numeric"
                onChange={(e) => setInvTurns(e.target.value)}
                placeholder="N/A"
              />
              <p className="text-[10px] text-gray-600 mt-1">
                Leave blank if no inventory
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Loan Impact ───────────────────────────────────────────── */}
      {subStep === "loan_impact" && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Pre-filled from your loan request. Confirm or adjust these details.
          </p>
          <div>
            <label className={labelCls}>Loan Amount ($)</label>
            <input
              className={inputCls}
              value={loanAmount}
              inputMode="numeric"
              onChange={(e) => setLoanAmount(e.target.value)}
              placeholder="500,000"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Term (months)</label>
              <input
                className={inputCls}
                value={termMonths}
                inputMode="numeric"
                onChange={(e) => setTermMonths(e.target.value)}
                placeholder="120"
              />
            </div>
            <div>
              <label className={labelCls}>Interest Rate (%)</label>
              <input
                className={inputCls}
                value={interestRate}
                inputMode="decimal"
                onChange={(e) => setInterestRate(e.target.value)}
                placeholder="7.25"
              />
            </div>
          </div>
          <div className="bg-blue-900/20 border border-blue-800 rounded-lg px-4 py-3 text-xs text-blue-300">
            The interest rate is an estimate based on current SBA rates. Your
            banker will confirm the final rate during underwriting.
          </div>
        </div>
      )}

      {/* ── Management Team ───────────────────────────────────────── */}
      {subStep === "management" && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Tell us about your management team. This goes into your business
            plan.
            {mgmtTeam.length > 0 &&
              " We've pre-filled names from your ownership information."}
          </p>
          {mgmtTeam.map((m, idx) => (
            <div
              key={idx}
              className="border border-neutral-800 rounded-lg p-4 space-y-3"
            >
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-300">
                  Member {idx + 1}
                </span>
                {mgmtTeam.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setMgmtTeam((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Name</label>
                  <input
                    className={inputCls}
                    value={m.name}
                    onChange={(e) =>
                      setMgmtTeam((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="Jane Smith"
                  />
                </div>
                <div>
                  <label className={labelCls}>Title</label>
                  <input
                    className={inputCls}
                    value={m.title}
                    onChange={(e) =>
                      setMgmtTeam((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, title: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="Managing Member"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Years in Industry</label>
                  <input
                    className={inputCls}
                    value={
                      m.yearsInIndustry ? String(m.yearsInIndustry) : ""
                    }
                    inputMode="numeric"
                    onChange={(e) =>
                      setMgmtTeam((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                yearsInIndustry:
                                  parseInt(e.target.value, 10) || 0,
                              }
                            : x,
                        ),
                      )
                    }
                    placeholder="10"
                  />
                </div>
                <div>
                  <label className={labelCls}>Ownership %</label>
                  <input
                    className={inputCls}
                    value={
                      m.ownershipPct != null ? String(m.ownershipPct) : ""
                    }
                    inputMode="numeric"
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setMgmtTeam((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                ownershipPct: Number.isFinite(v) ? v : undefined,
                              }
                            : x,
                        ),
                      );
                    }}
                    placeholder="51"
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>
                  Brief Bio (2–3 sentences about your experience)
                </label>
                <textarea
                  className={inputCls + " resize-none"}
                  rows={3}
                  value={m.bio}
                  onChange={(e) =>
                    setMgmtTeam((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, bio: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="15 years in commercial property management. Previously managed a portfolio of 50+ units across 3 states."
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setMgmtTeam((prev) => [
                ...prev,
                {
                  name: "",
                  title: "",
                  yearsInIndustry: 0,
                  bio: "",
                },
              ])
            }
            className="w-full py-3 rounded-lg border border-dashed border-neutral-700 text-gray-400 text-sm hover:border-neutral-500 transition min-h-[44px]"
          >
            + Add Team Member
          </button>
        </div>
      )}

      {/* Sub-step navigation */}
      <div className="flex gap-3 pt-2">
        {canGoBack && (
          <button
            type="button"
            onClick={() => setSubStep(SUB_STEPS[subStepIdx - 1].key)}
            className="px-4 py-2.5 rounded-lg border border-neutral-700 text-gray-300 text-sm hover:bg-neutral-800 transition min-h-[44px]"
          >
            Back
          </button>
        )}
        {canGoForward && (
          <button
            type="button"
            onClick={() => setSubStep(SUB_STEPS[subStepIdx + 1].key)}
            className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition min-h-[44px]"
          >
            Next: {SUB_STEPS[subStepIdx + 1].label}
          </button>
        )}
      </div>

      {saving && (
        <p className="text-center text-xs text-neutral-600">
          Saving projections…
        </p>
      )}
    </div>
  );
}
