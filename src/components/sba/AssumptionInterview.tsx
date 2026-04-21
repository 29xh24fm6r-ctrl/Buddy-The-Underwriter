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
import { getConceptExplanation } from "@/lib/sba/sbaConceptExplainer";
import type { DraftedAssumptions } from "@/lib/sba/sbaAssumptionDrafter";
import SBAGenerationProgress from "./SBAGenerationProgress";
import SBAConversationalInterview from "./SBAConversationalInterview";

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

// ─── Phase 3 — Mode switcher ─────────────────────────────────────────────

type Mode = "guided" | "form" | "conversational";

function ModeSwitcher({
  mode,
  onChange,
  includeChat = false,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  includeChat?: boolean;
}) {
  const base =
    "flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition";
  const active = "bg-blue-600 text-white";
  const inactive = "text-white/60 hover:text-white";
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-white/5 p-1">
      <button
        type="button"
        onClick={() => onChange("guided")}
        className={`${base} ${mode === "guided" ? active : inactive}`}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          smart_toy
        </span>
        Guided
      </button>
      <button
        type="button"
        onClick={() => onChange("form")}
        className={`${base} ${mode === "form" ? active : inactive}`}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          edit_note
        </span>
        Form
      </button>
      {includeChat && (
        <button
          type="button"
          onClick={() => onChange("conversational")}
          className={`${base} ${mode === "conversational" ? active : inactive}`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            chat
          </span>
          Chat
        </button>
      )}
    </div>
  );
}

// ─── Phase 3 — Plain-English explain tooltip ────────────────────────────

function ExplainButton({
  conceptKey,
  naicsCode,
  value,
}: {
  conceptKey: string;
  naicsCode: string | null;
  value?: number;
}) {
  const [open, setOpen] = useState(false);
  const explanation = getConceptExplanation(conceptKey, naicsCode, value);
  return (
    <span className="relative inline-flex align-baseline">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="ml-1 inline-flex text-blue-400/40 hover:text-blue-400"
        aria-label={`Explain ${explanation.term}`}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          help_outline
        </span>
      </button>
      {open && (
        <div className="absolute z-20 left-0 top-5 w-72 rounded-lg border border-blue-500/20 bg-blue-950/90 p-3 text-xs shadow-lg">
          <div className="font-semibold text-blue-300">{explanation.term}</div>
          <p className="mt-1 text-white/70">{explanation.plainEnglish}</p>
          <p className="mt-1 text-white/60">
            <strong>Why it matters:</strong> {explanation.whyItMatters}
          </p>
          <p className="mt-1 text-white/60">
            <strong>Typical range:</strong> {explanation.goodRange}
          </p>
          {explanation.yourValue && (
            <p className="mt-1 text-white/80">
              <strong>Your value:</strong> {explanation.yourValue}
            </p>
          )}
        </div>
      )}
    </span>
  );
}

// ─── Phase 3 — Guided review cards ──────────────────────────────────────

const fmtMoney = (n: number): string => {
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000).toLocaleString()}K`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
};
const fmtPct = (n: number, digits = 1): string =>
  Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "0%";

type ReviewCardKey =
  | "revenue"
  | "costs"
  | "workingCapital"
  | "loan"
  | "management";

function GuidedReview({
  assumptions,
  reasoning,
  loading,
  draftError,
  prefillMeta,
  sectionApprovals,
  toggleApproval,
  openForEdit,
  onGenerate,
  generating,
  completionPct,
}: {
  dealId: string;
  assumptions: SBAAssumptions;
  reasoning: Partial<DraftedAssumptions["reasoning"]>;
  loading: boolean;
  draftError: string | null;
  prefillMeta: PrefillMeta | null;
  sectionApprovals: Record<string, boolean>;
  toggleApproval: (key: string) => void;
  openForEdit: (key: ReviewCardKey) => void;
  onGenerate: () => void;
  generating: boolean;
  completionPct: number;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <div className="mx-auto mb-4 inline-flex h-10 w-10 items-center justify-center">
          <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
        <h3 className="text-base font-semibold text-white">
          Buddy is analyzing your business…
        </h3>
        <p className="mt-2 text-xs text-white/50">
          Reading your financial statements, researching your industry,
          analyzing market conditions, and drafting your assumptions.
        </p>
      </div>
    );
  }

  if (draftError) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
        Could not draft assumptions automatically: {draftError}. Switch to Form
        mode to fill them in manually.
      </div>
    );
  }

  const naicsCode = prefillMeta?.naicsCode ?? null;
  const allApproved: ReviewCardKey[] = [
    "revenue",
    "costs",
    "workingCapital",
    "loan",
    "management",
  ];
  const everythingApproved =
    allApproved.every((k) => !!sectionApprovals[k]);

  return (
    <div className="space-y-3">
      <ReviewCard
        cardKey="revenue"
        icon="trending_up"
        title="Revenue Projection"
        approved={!!sectionApprovals.revenue}
        onApprove={() => toggleApproval("revenue")}
        onEdit={() => openForEdit("revenue")}
        reasoning={reasoning.revenueRationale}
      >
        {assumptions.revenueStreams.length === 0 ? (
          <p className="text-white/50">No revenue streams drafted yet.</p>
        ) : (
          <div className="space-y-2">
            {assumptions.revenueStreams.map((s) => (
              <div key={s.id} className="space-y-0.5">
                <div className="text-white/80">
                  <span className="font-medium">{s.name || "Stream"}</span>
                  : {fmtMoney(s.baseAnnualRevenue)}/year
                </div>
                <div className="text-white/50 flex items-center flex-wrap gap-1">
                  Growth:
                  <span>{fmtPct(s.growthRateYear1, 0)}</span>
                  <ExplainButton
                    conceptKey="revenueGrowth"
                    naicsCode={naicsCode}
                    value={s.growthRateYear1}
                  />
                  <span className="text-white/30">→</span>
                  <span>{fmtPct(s.growthRateYear2, 0)}</span>
                  <span className="text-white/30">→</span>
                  <span>{fmtPct(s.growthRateYear3, 0)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </ReviewCard>

      <ReviewCard
        cardKey="costs"
        icon="payments"
        title="Cost Structure"
        approved={!!sectionApprovals.costs}
        onApprove={() => toggleApproval("costs")}
        onEdit={() => openForEdit("costs")}
        reasoning={reasoning.costRationale}
      >
        <div className="flex items-center gap-1 text-white/80">
          COGS:
          <span className="font-medium">
            {fmtPct(assumptions.costAssumptions.cogsPercentYear1, 0)}
          </span>
          of revenue
          <ExplainButton
            conceptKey="cogs"
            naicsCode={naicsCode}
            value={assumptions.costAssumptions.cogsPercentYear1}
          />
          <span className="text-white/40 ml-2">
            · Gross Margin:{" "}
            {fmtPct(1 - assumptions.costAssumptions.cogsPercentYear1, 0)}
          </span>
        </div>
        <div className="mt-1 text-white/50">
          {assumptions.costAssumptions.fixedCostCategories.length} fixed cost
          {assumptions.costAssumptions.fixedCostCategories.length === 1
            ? " category"
            : " categories"}
          {assumptions.costAssumptions.plannedHires.length > 0 &&
            ` · ${assumptions.costAssumptions.plannedHires.length} planned hire${assumptions.costAssumptions.plannedHires.length === 1 ? "" : "s"}`}
          {assumptions.costAssumptions.plannedCapex.length > 0 &&
            ` · ${assumptions.costAssumptions.plannedCapex.length} capex item${assumptions.costAssumptions.plannedCapex.length === 1 ? "" : "s"}`}
        </div>
      </ReviewCard>

      <ReviewCard
        cardKey="workingCapital"
        icon="schedule"
        title="Working Capital"
        approved={!!sectionApprovals.workingCapital}
        onApprove={() => toggleApproval("workingCapital")}
        onEdit={() => openForEdit("workingCapital")}
        reasoning={reasoning.workingCapitalRationale}
      >
        <div className="flex items-center flex-wrap gap-1 text-white/80">
          DSO: <span className="font-medium">{assumptions.workingCapital.targetDSO} days</span>
          <ExplainButton conceptKey="dso" naicsCode={naicsCode} value={assumptions.workingCapital.targetDSO} />
          <span className="text-white/40 ml-2">·</span>
          DPO: <span className="font-medium">{assumptions.workingCapital.targetDPO} days</span>
          <ExplainButton conceptKey="dpo" naicsCode={naicsCode} value={assumptions.workingCapital.targetDPO} />
        </div>
        {assumptions.workingCapital.inventoryTurns != null && (
          <div className="mt-1 text-white/50">
            Inventory turns: {assumptions.workingCapital.inventoryTurns}×/yr
          </div>
        )}
      </ReviewCard>

      <ReviewCard
        cardKey="loan"
        icon="request_quote"
        title="Loan & Funding"
        approved={!!sectionApprovals.loan}
        onApprove={() => toggleApproval("loan")}
        onEdit={() => openForEdit("loan")}
        reasoning={reasoning.equityRationale}
      >
        <div className="space-y-1">
          <div className="flex items-center flex-wrap gap-1 text-white/80">
            Loan: <span className="font-medium">{fmtMoney(assumptions.loanImpact.loanAmount)}</span>
            <span className="text-white/40 ml-2">·</span>
            {assumptions.loanImpact.termMonths} months
            <ExplainButton conceptKey="termMonths" naicsCode={naicsCode} value={assumptions.loanImpact.termMonths} />
            <span className="text-white/40 ml-2">·</span>
            {fmtPct(assumptions.loanImpact.interestRate, 2)}
            <ExplainButton conceptKey="interestRate" naicsCode={naicsCode} value={assumptions.loanImpact.interestRate} />
          </div>
          <div className="flex items-center flex-wrap gap-1 text-white/70">
            Equity injection: <span className="font-medium">{fmtMoney(assumptions.loanImpact.equityInjectionAmount)}</span>
            <ExplainButton conceptKey="equityInjection" naicsCode={naicsCode} value={assumptions.loanImpact.equityInjectionAmount} />
          </div>
          {assumptions.loanImpact.sellerFinancingAmount > 0 && (
            <div className="text-white/70">
              Seller financing: {fmtMoney(assumptions.loanImpact.sellerFinancingAmount)}
              {assumptions.loanImpact.sellerFinancingTermMonths
                ? ` over ${assumptions.loanImpact.sellerFinancingTermMonths} mo`
                : ""}
            </div>
          )}
        </div>
      </ReviewCard>

      <ReviewCard
        cardKey="management"
        icon="group"
        title="Management Team"
        approved={!!sectionApprovals.management}
        onApprove={() => toggleApproval("management")}
        onEdit={() => openForEdit("management")}
        reasoning={reasoning.managementRationale}
      >
        {assumptions.managementTeam.length === 0 ? (
          <p className="text-white/50">No management team on file yet.</p>
        ) : (
          <div className="space-y-1">
            {assumptions.managementTeam.map((m, i) => (
              <div key={i} className="text-white/80">
                <span className="font-medium">{m.name || "Unnamed"}</span>
                <span className="text-white/50"> · {m.title}</span>
                {m.ownershipPct != null && (
                  <span className="text-white/40"> · {fmtPct(m.ownershipPct, 0)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </ReviewCard>

      {/* Final CTA appears once every section has been approved. */}
      {everythingApproved && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
          <h3 className="text-sm font-semibold text-emerald-300">
            You&apos;ve approved every section — ready to generate.
          </h3>
          <p className="text-xs text-white/60">
            Buddy will confirm these assumptions and build your 3-year business
            plan. This takes about 45–60 seconds.
          </p>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating || completionPct < 100}
            className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating ? "Generating…" : "Generate My Business Plan"}
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  cardKey: _cardKey,
  icon,
  title,
  approved,
  onApprove,
  onEdit,
  reasoning,
  children,
}: {
  cardKey: ReviewCardKey;
  icon: string;
  title: string;
  approved: boolean;
  onApprove: () => void;
  onEdit: () => void;
  reasoning: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-white/90 flex items-center gap-2">
          <span className="material-symbols-outlined text-blue-400" style={{ fontSize: 18 }}>
            {icon}
          </span>
          {title}
          {approved && (
            <span className="text-emerald-400 text-xs">✓ Approved</span>
          )}
        </h3>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          Edit
        </button>
      </div>

      <div className="text-sm text-white/70 space-y-1">{children}</div>

      {reasoning && (
        <div className="rounded-lg bg-blue-500/5 border border-blue-500/10 p-3">
          <div className="flex items-center gap-1 text-xs text-blue-400 font-medium mb-1">
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              psychology
            </span>
            Why Buddy chose these values
          </div>
          <p className="text-xs text-white/50">{reasoning}</p>
        </div>
      )}

      {!approved && (
        <button
          type="button"
          onClick={onApprove}
          className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20"
        >
          Looks Good ✓
        </button>
      )}
    </div>
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

  // Phase 3 — "The Consultant Experience": mode switcher + AI-drafted review.
  // Default is Guided (Buddy presents a completed draft). Form is the
  // escape hatch for power users / bankers who want raw inputs.
  // Widen to Mode (guided|form|conversational) — Step 10 wires in the third
  // option via the mode switcher prop.
  const [mode, setMode] = useState<Mode>("guided");
  const [draftLoading, setDraftLoading] = useState(true);
  const [draftedReasoning, setDraftedReasoning] = useState<
    Partial<DraftedAssumptions["reasoning"]>
  >({});
  const [draftError, setDraftError] = useState<string | null>(null);
  const [sectionApprovals, setSectionApprovals] = useState<
    Record<string, boolean>
  >({});

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

  // Phase 3 — fetch an AI-drafted set of assumptions on mount when the
  // borrower hasn't already confirmed a prior draft. Non-fatal: on any
  // failure we just drop into the form with whatever prefill is there.
  useEffect(() => {
    let cancelled = false;
    async function draft() {
      // Already confirmed or we have a persisted draft — don't clobber.
      if (initial && (initial.revenueStreams?.length ?? 0) > 0) {
        setDraftLoading(false);
        return;
      }
      try {
        const res = await fetch(
          `/api/deals/${dealId}/sba/draft-assumptions`,
          { method: "POST" },
        );
        const json = await res.json();
        if (cancelled) return;
        if (json.ok && json.assumptions) {
          setAssumptions((prev) => ({
            ...prev,
            ...(json.assumptions as SBAAssumptions),
            dealId,
          }));
          setDraftedReasoning(json.reasoning ?? {});
        } else if (!json.ok) {
          setDraftError(json.error ?? "Could not draft assumptions");
        }
      } catch {
        if (!cancelled)
          setDraftError("Network error while drafting assumptions");
      } finally {
        if (!cancelled) setDraftLoading(false);
      }
    }
    draft();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const toggleApproval = useCallback((key: string) => {
    setSectionApprovals((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const openForEdit = useCallback((key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: true }));
    setMode("form");
    // scroll the form section into view shortly after mode flip
    setTimeout(() => {
      const el = document.getElementById(`section-${key}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }, []);

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

      {/* Phase 3 — mode switcher: Guided | Form | Chat */}
      <ModeSwitcher mode={mode} onChange={setMode} includeChat />

      {/* Phase 3 — conversational chat mode. */}
      {mode === "conversational" && (
        <SBAConversationalInterview
          dealId={dealId}
          assumptions={assumptions}
          onAssumptionsChange={(next) => setAssumptions(next)}
          onConfirmed={async () => {
            await saveGuarantors();
            await handleConfirm();
          }}
        />
      )}

      {/* Phase 3 — guided review mode (default). Buddy presents the draft. */}
      {mode === "guided" && (
        <GuidedReview
          dealId={dealId}
          assumptions={assumptions}
          reasoning={draftedReasoning}
          loading={draftLoading}
          draftError={draftError}
          prefillMeta={prefillMeta ?? null}
          sectionApprovals={sectionApprovals}
          toggleApproval={toggleApproval}
          openForEdit={openForEdit}
          onGenerate={async () => {
            await saveGuarantors();
            await handleConfirm();
          }}
          generating={generating}
          completionPct={completionPct}
        />
      )}

      {/* Phase 3 — form mode (power users): original multi-section form. */}
      {mode === "form" && (
      <>

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

      </>
      )}
    </div>
  );
}
