"use client";

// src/components/borrower/intake/AssumptionInterview.tsx
// Phase 85-BPG-A — Borrower-facing 5-section SBA assumption interview.
// Auto-prefills from deal_financial_facts + intake owners/loan; debounced
// save to buddy_sba_assumptions via the portal-token route.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type {
  RevenueStream,
  FixedCostCategory,
  PlannedHire,
  PlannedCapex,
  ManagementMember,
  SBAAssumptions,
  AnnualProjectionYear,
  MonthlyProjection,
  BreakEvenResult,
  SensitivityScenario,
} from "@/lib/sba/sbaReadinessTypes";
import {
  buildBaseYear,
  buildAnnualProjections,
  buildMonthlyProjections,
  computeBreakEven,
  buildSensitivityScenarios,
} from "@/lib/sba/sbaForwardModelBuilder";
import { ProjectionDashboard } from "./ProjectionDashboard";

// Local mirror of ResearchContext shape from sbaResearchProjectionGenerator.ts
// (that module is server-only, so we duplicate the fields we render here).
type ResearchContextLike = {
  marketSize?: number | null;
  marketGrowthRate?: number | null;
  establishmentCount?: number | null;
  employmentCount?: number | null;
  averageWage?: number | null;
  medianIncome?: number | null;
  population?: number | null;
  populationGrowthRate?: number | null;
  competitiveIntensity?: string | null;
  marketAttractiveness?: string | null;
  growthTrajectory?: string | null;
  cyclicalityRisk?: string | null;
  demandStability?: string | null;
  naicsCode?: string | null;
  naicsLabel?: string | null;
  revenueGrowthMedian?: number | null;
  cogsMedian?: number | null;
};

type BaseYearFactsLike = {
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  ebitda: number;
  depreciation: number;
  netIncome: number;
  existingDebtServiceAnnual: number;
};

type Projections = {
  annual: AnnualProjectionYear[];
  monthly: MonthlyProjection[];
  breakEven: BreakEvenResult;
  scenarios: SensitivityScenario[];
};

type Props = {
  token: string;
  dealId: string;
  // Phase 85-BPG-ELITE — invoked when borrower confirms the auto-generated
  // projections from the presentation phase. Lets the parent step advance.
  onConfirmAndContinue?: () => void;
};

// Phase 85-BPG-ELITE — three-phase flow:
//   researching  → spinner while POST /research-projections runs
//   presenting   → research briefing card + auto-computed dashboard + CTAs
//   editing      → original 5-section form
type Phase = "researching" | "presenting" | "editing";

type ResearchBriefing = {
  narrative: string;
  context: Record<string, unknown> | null;
  confidenceLevel: string;
  dataSources: string[];
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

export function AssumptionInterview({
  token,
  dealId,
  onConfirmAndContinue,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [subStep, setSubStep] = useState<SubStep>("revenue");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("researching");
  const [researchBriefing, setResearchBriefing] =
    useState<ResearchBriefing | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [baseYearFacts, setBaseYearFacts] = useState<BaseYearFactsLike | null>(
    null,
  );

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

  // ── Phase 85-BPG-ELITE: research → present → (optionally) edit ────────
  useEffect(() => {
    let cancelled = false;
    async function init() {
      let briefing: ResearchBriefing | null = null;
      // 1. Trigger research-powered auto-generation. Non-fatal on failure;
      //    we still fall through to the regular load + form below.
      try {
        const resRes = await fetch(
          `/api/borrower/portal/${token}/research-projections`,
          { method: "POST" },
        );
        const resJson = await resRes.json();
        if (!cancelled && resJson?.ok && resJson.researchNarrative) {
          briefing = {
            narrative: String(resJson.researchNarrative),
            context: resJson.researchContext ?? null,
            confidenceLevel: String(resJson.confidenceLevel ?? "medium"),
            dataSources: Array.isArray(resJson.dataSources)
              ? resJson.dataSources.map(String)
              : [],
          };
        }
      } catch {
        // Non-fatal — fall through to existing form.
      }
      if (cancelled) return;

      // 2. Hydrate state from the (possibly just-generated) assumptions.
      try {
        const res = await fetch(
          `/api/borrower/portal/${token}/sba-assumptions`,
        );
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) {
          setResearchBriefing(briefing);
          setPhase(briefing ? "presenting" : "editing");
          setLoading(false);
          return;
        }

        // Prefer existing saved assumptions; fall back to prefilled defaults.
        const data = json.assumptions ?? json.prefilled;
        if (!data) {
          setResearchBriefing(briefing);
          setPhase(briefing ? "presenting" : "editing");
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

        // If we have a research briefing, present it; otherwise drop straight
        // into the form. If borrower already confirmed elsewhere, also edit.
        const status = (json?.assumptions?.status ?? null) as string | null;
        const wantsPresent = !!briefing && status !== "confirmed";
        setResearchBriefing(briefing);
        setPhase(wantsPresent ? "presenting" : "editing");
      } catch {
        setError("Failed to load projections data");
        setResearchBriefing(briefing);
        setPhase(briefing ? "presenting" : "editing");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Load base-year facts once so we can compute projections for the roadmap
  // card. ProjectionDashboard fetches the same endpoint independently; HTTP
  // caching plus a tiny payload keep the cost negligible.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/borrower/portal/${token}/base-year`);
        const json = await res.json();
        if (!cancelled && json.ok && json.baseYear) {
          setBaseYearFacts(json.baseYear);
        }
      } catch {
        // Non-fatal; roadmap card will simply not render.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Confirm the auto-generated assumptions and (optionally) advance.
  const confirmAndContinue = useCallback(async () => {
    setConfirming(true);
    try {
      await fetch(`/api/borrower/portal/${token}/sba-assumptions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: { status: "confirmed" } }),
      });
      // Fire-and-forget: kick off the borrower PDF in the background. The
      // Review step polls the same endpoint until the PDF is ready.
      fetch(`/api/borrower/portal/${token}/generate-pdf`, {
        method: "POST",
      }).catch(() => {});
      onConfirmAndContinue?.();
    } catch {
      // If the network fails we leave the user on the presenting screen with
      // the dashboard intact — they can retry by clicking Continue again.
    } finally {
      setConfirming(false);
    }
  }, [token, onConfirmAndContinue]);

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

  // Assemble the full SBAAssumptions shape for the live projection dashboard.
  // Mirrors the patch built inside save(), plus dealId/status that save omits.
  const assembledAssumptions: SBAAssumptions = useMemo(
    () => ({
      dealId,
      status: "draft",
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
        equityInjectionAmount: 0,
        equityInjectionSource: "cash_savings",
        sellerFinancingAmount: 0,
        sellerFinancingTermMonths: 0,
        sellerFinancingRate: 0,
        otherSources: [],
      },
      managementTeam: mgmtTeam,
    }),
    [
      dealId,
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
    ],
  );

  // Compute projections at the parent level so the roadmap card can use them
  // alongside the dashboard. Mirrors ProjectionDashboard's own logic; that
  // component keeps its independent compute to stay self-contained.
  const projections = useMemo<Projections | null>(() => {
    if (!baseYearFacts) return null;
    if (!assembledAssumptions.revenueStreams.length) return null;
    if (assembledAssumptions.revenueStreams.every((s) => s.baseAnnualRevenue === 0))
      return null;
    try {
      const bY = buildBaseYear(baseYearFacts);
      const annual = buildAnnualProjections(assembledAssumptions, bY);
      const year1 = annual[0];
      if (!year1) return null;
      const monthly = buildMonthlyProjections(assembledAssumptions, year1);
      const breakEven = computeBreakEven(assembledAssumptions, year1);
      const scenarios = buildSensitivityScenarios(assembledAssumptions, [
        bY,
        ...annual,
      ]);
      return { annual, monthly, breakEven, scenarios };
    } catch {
      return null;
    }
  }, [assembledAssumptions, baseYearFacts]);

  const subStepIdx = SUB_STEPS.findIndex((s) => s.key === subStep);
  const canGoBack = subStepIdx > 0;
  const canGoForward = subStepIdx < SUB_STEPS.length - 1;

  // ── Phase 85-BPG-ELITE: researching ────────────────────────────────────
  if (loading || phase === "researching") {
    return (
      <div className="space-y-4 py-12 text-center">
        <div
          className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"
          aria-hidden
        />
        <h2 className="text-lg font-semibold text-white">
          Buddy is researching your industry
        </h2>
        <p className="text-sm text-gray-400">
          Analyzing market data, competitive landscape, and industry
          benchmarks…
        </p>
      </div>
    );
  }

  // ── Phase 85-BPG-ELITE: presenting research findings ───────────────────
  if (phase === "presenting" && researchBriefing) {
    return (
      <div className="space-y-5">
        <h2 className="text-lg font-semibold text-white">
          Here&apos;s what I found
        </h2>

        <div className="bg-gradient-to-b from-blue-950/40 to-neutral-900 border border-blue-800/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-xs text-blue-400">
            <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
            Buddy&apos;s Industry Research
          </div>

          <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">
            {researchBriefing.narrative}
          </div>

          {researchBriefing.dataSources.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {researchBriefing.dataSources.map((src) => (
                <span
                  key={src}
                  className="text-[10px] px-2 py-1 rounded-full bg-neutral-800 text-gray-400 border border-neutral-700"
                >
                  {src}
                </span>
              ))}
            </div>
          )}
        </div>

        {researchBriefing.context && (
          <ResearchDataGrid context={researchBriefing.context} />
        )}

        <ProjectionDashboard token={token} assumptions={assembledAssumptions} />

        {projections && <RoadmapCard projections={projections} />}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={() => setPhase("editing")}
            className="px-6 py-3 rounded-lg border border-neutral-700 text-gray-300 text-sm font-medium hover:bg-neutral-800 transition min-h-[44px]"
          >
            I want to adjust
          </button>
          <button
            type="button"
            onClick={confirmAndContinue}
            disabled={confirming}
            className="flex-1 px-6 py-3 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition disabled:opacity-60 min-h-[44px]"
          >
            {confirming ? "Confirming…" : "Looks great — continue"}
          </button>
        </div>
      </div>
    );
  }

  // ── Phase: editing (original 5-section form) ───────────────────────────
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

      {/* Live projection dashboard — recalculates client-side on every edit */}
      <ProjectionDashboard token={token} assumptions={assembledAssumptions} />

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

// ─── ResearchDataGrid — visual data cards from ResearchContext ─────────────

function ResearchDataGrid({ context }: { context: Record<string, unknown> }) {
  const ctx = context as ResearchContextLike;
  const cards: Array<{
    label: string;
    value: string;
    sub?: string;
    icon: string;
  }> = [];

  if (ctx.naicsLabel) {
    cards.push({
      label: "Industry",
      value: String(ctx.naicsLabel),
      sub: ctx.naicsCode ? `NAICS ${ctx.naicsCode}` : undefined,
      icon: "🏢",
    });
  }

  if (ctx.marketGrowthRate != null) {
    const rate = Number(ctx.marketGrowthRate);
    cards.push({
      label: "Industry Growth",
      value: `${(rate * 100).toFixed(1)}%`,
      sub: "annual growth rate",
      icon: "📈",
    });
  }

  if (ctx.establishmentCount != null) {
    cards.push({
      label: "Local Competition",
      value: Number(ctx.establishmentCount).toLocaleString(),
      sub: "establishments in market",
      icon: "🏪",
    });
  }

  if (ctx.population != null) {
    cards.push({
      label: "Market Population",
      value: Number(ctx.population).toLocaleString(),
      sub:
        ctx.populationGrowthRate != null
          ? `${(Number(ctx.populationGrowthRate) * 100).toFixed(1)}% growth`
          : undefined,
      icon: "👥",
    });
  }

  if (ctx.medianIncome != null) {
    cards.push({
      label: "Median Income",
      value: `$${Number(ctx.medianIncome).toLocaleString()}`,
      sub: "household income",
      icon: "💰",
    });
  }

  if (ctx.cogsMedian != null) {
    cards.push({
      label: "Typical Cost of Goods",
      value: `${(Number(ctx.cogsMedian) * 100).toFixed(0)}%`,
      sub: "industry benchmark",
      icon: "📊",
    });
  }

  if (ctx.revenueGrowthMedian != null) {
    cards.push({
      label: "Revenue Growth Benchmark",
      value: `${(Number(ctx.revenueGrowthMedian) * 100).toFixed(0)}%`,
      sub: "industry median per year",
      icon: "🎯",
    });
  }

  if (ctx.competitiveIntensity) {
    const intensity = String(ctx.competitiveIntensity);
    cards.push({
      label: "Competitive Intensity",
      value: intensity.charAt(0).toUpperCase() + intensity.slice(1),
      icon: "⚔️",
    });
  }

  if (ctx.demandStability) {
    const stability = String(ctx.demandStability);
    cards.push({
      label: "Demand Stability",
      value: stability.charAt(0).toUpperCase() + stability.slice(1),
      icon: "🛡️",
    });
  }

  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-neutral-800/60 border border-neutral-700/50 rounded-lg p-3 space-y-1"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{card.icon}</span>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
              {card.label}
            </span>
          </div>
          <p className="text-lg font-bold text-gray-100">{card.value}</p>
          {card.sub && <p className="text-[10px] text-gray-500">{card.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ─── RoadmapCard — client-side actionable roadmap summary ──────────────────

function RoadmapCard({ projections }: { projections: Projections }) {
  const y1 = projections.annual[0];
  if (!y1) return null;

  const monthlyRev = Math.round(y1.revenue / 12);
  const monthlyBE = Math.round(projections.breakEven.breakEvenRevenue / 12);
  const cushion = monthlyRev - monthlyBE;
  const monthlyDS = Math.round(y1.totalDebtService / 12);
  const downside = projections.scenarios.find((s) => s.name === "downside");
  const cogsPctNum = y1.grossMarginPct
    ? ((1 - y1.grossMarginPct) * 100).toFixed(0)
    : null;

  return (
    <div className="border border-neutral-800 rounded-xl p-5 space-y-4 bg-gradient-to-b from-green-950/20 to-neutral-900">
      <div className="flex items-center gap-2">
        <span className="text-sm">🗺️</span>
        <h3 className="text-sm font-medium text-green-400">
          Your Business Roadmap
        </h3>
      </div>

      <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
        <p>
          Your business needs to generate{" "}
          <span className="text-white font-semibold">
            ${monthlyBE.toLocaleString()}/month
          </span>{" "}
          to break even. You&apos;re projected at{" "}
          <span className="text-white font-semibold">
            ${monthlyRev.toLocaleString()}/month
          </span>
          , giving you{" "}
          <span className="text-green-400 font-semibold">
            ${cushion.toLocaleString()}
          </span>{" "}
          of monthly cushion — a{" "}
          {(projections.breakEven.marginOfSafetyPct * 100).toFixed(0)}% safety
          margin.
        </p>

        <div className="bg-neutral-800/60 rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Year 1 Targets
          </p>
          <div className="grid grid-cols-1 gap-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-400">Monthly revenue target</span>
              <span className="text-white font-mono">
                ${monthlyRev.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Monthly loan payment</span>
              <span className="text-white font-mono">
                ${monthlyDS.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Keep cost of goods below</span>
              <span className="text-white font-mono">
                {cogsPctNum ? `${cogsPctNum}%` : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">
                Cash reserve goal (2 months)
              </span>
              <span className="text-white font-mono">
                ${(monthlyDS * 2).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {downside && (
          <p className="text-xs text-gray-500">
            {downside.passesSBAThreshold
              ? `Even if revenue drops 15%, your business can still cover all obligations with a ${downside.dscrYear1.toFixed(1)}x coverage ratio.`
              : `If revenue drops 15%, cash flow would be tight. Build reserves early and monitor monthly revenue closely.`}
          </p>
        )}
      </div>
    </div>
  );
}
