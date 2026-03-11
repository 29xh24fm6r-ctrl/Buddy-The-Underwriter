"use client";

import { useSpreadOutput } from "@/hooks/useSpreadOutput";
import { useFinancialSnapshot } from "@/hooks/useFinancialSnapshot";
import Link from "next/link";

// ─── Formatting helpers ────────────────────────────────────────────────────

function fmtX(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n.toFixed(2)}x`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  // If value looks like a decimal ratio (0–1), convert
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

function fmtDollars(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000).toLocaleString("en-US")}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function toNum(val: unknown): number | null {
  if (val == null) return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

// ─── Metric cell ───────────────────────────────────────────────────────────

function MetricCell({
  label,
  value,
  context,
  highlight,
}: {
  label: string;
  value: string;
  context?: string;
  highlight?: "critical" | "elevated" | "good" | null;
}) {
  const borderColor =
    highlight === "critical"
      ? "border-rose-500/50"
      : highlight === "elevated"
      ? "border-amber-500/50"
      : highlight === "good"
      ? "border-emerald-500/40"
      : "border-white/10";

  return (
    <div
      className={`bg-white/5 border ${borderColor} rounded-lg px-4 py-3 flex flex-col gap-0.5`}
    >
      <span className="text-[10px] uppercase tracking-wide text-white/50">
        {label}
      </span>
      <span className="text-white font-semibold text-xl leading-tight">
        {value}
      </span>
      {context && (
        <span className="text-xs text-white/40 mt-0.5">{context}</span>
      )}
    </div>
  );
}

// ─── Risk card ─────────────────────────────────────────────────────────────

const SEVERITY_STYLES = {
  critical: {
    border: "border-l-2 border-rose-500",
    bg: "bg-rose-950/20",
    chip: "text-rose-400",
  },
  elevated: {
    border: "border-l-2 border-amber-500",
    bg: "bg-amber-950/20",
    chip: "text-amber-400",
  },
  watch: {
    border: "border-l-2 border-yellow-500/60",
    bg: "bg-yellow-950/10",
    chip: "text-yellow-400",
  },
  info: {
    border: "border-l-2 border-white/20",
    bg: "bg-white/5",
    chip: "text-white/50",
  },
};

type FlagSeverity = "critical" | "elevated" | "watch" | "info";

function RiskCard({
  severity,
  summary,
  detail,
}: {
  severity: FlagSeverity;
  summary: string;
  detail: string;
}) {
  const s = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info;
  return (
    <div
      className={`${s.border} ${s.bg} rounded-r-lg px-3 py-2 min-w-[200px] max-w-[280px] shrink-0`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[10px] uppercase font-semibold tracking-wide ${s.chip}`}>
          {severity}
        </span>
        <span className="text-xs text-white/80 truncate">{summary}</span>
      </div>
      <p className="text-xs text-white/60 line-clamp-2">{detail}</p>
    </div>
  );
}

// ─── Evidence chip ─────────────────────────────────────────────────────────

function EvidenceChip({
  label,
  status,
}: {
  label: string;
  status: "pass" | "warn" | "fail" | "unknown";
}) {
  const dot =
    status === "pass"
      ? "text-emerald-400"
      : status === "warn"
      ? "text-amber-400"
      : status === "fail"
      ? "text-rose-400"
      : "text-white/30";

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70">
      <span className={`text-base leading-none ${dot}`}>&#9679;</span>
      {label}
    </span>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

type Props = {
  dealId: string;
  auditConfidence: number | null;
  auditDocCount: number | null;
  totalDocs: number | null;
  reconStatus: string | null;
};

export default function IntelligenceClient({
  dealId,
  auditConfidence,
  auditDocCount,
  totalDocs,
  reconStatus,
}: Props) {
  const { data: spread, loading: spreadLoading, pricingRequired } = useSpreadOutput(dealId);
  const { data: snapshot } = useFinancialSnapshot(dealId);

  // ── Derived values ────────────────────────────────────────────────────────

  const facts = spread?.canonical_facts ?? {};
  const ratios = spread?.ratios ?? {};
  const flags = spread?.flag_report?.flags ?? [];
  const years = spread?.years_available ?? [];
  const latestYear = years.length > 0 ? Math.max(...years) : null;

  const dscr = toNum(ratios["DSCR"] ?? ratios["ratio_dscr_final"]) ??
    toNum((snapshot as any)?.snapshot?.dscr?.value_num);
  const dscrDownside = dscr != null ? dscr * 0.85 : null;
  const leverage = toNum(ratios["DEBT_TO_EBITDA"]);
  const loanAmount = toNum(facts["loan_amount"]);

  const openFlags = flags.filter(
    (f) => f.status !== "resolved" && f.status !== "waived",
  );
  const criticalCount = openFlags.filter((f) => f.severity === "critical").length;
  const elevatedCount = openFlags.filter((f) => f.severity === "elevated").length;
  const policyExceptions = criticalCount + elevatedCount;

  // Treasury wallet tier
  const revenue = latestYear ? toNum(facts[`GROSS_RECEIPTS_${latestYear}`]) : null;
  const ebitda = latestYear ? toNum(facts[`EBITDA_${latestYear}`]) : null;
  const revGrowth = (() => {
    if (years.length < 2 || latestYear == null) return null;
    const prev = years[years.length - 2];
    const r0 = toNum(facts[`GROSS_RECEIPTS_${prev}`]);
    const r1 = toNum(facts[`GROSS_RECEIPTS_${latestYear}`]);
    if (r0 == null || r1 == null || r0 === 0) return null;
    return (r1 - r0) / r0;
  })();

  const walletTier =
    ebitda != null && ebitda > 500_000 && revGrowth != null && revGrowth > 0.05
      ? "HIGH"
      : dscr != null && dscr < 1.1 || (ebitda != null && ebitda < 150_000)
      ? "LOW"
      : ebitda != null
      ? "MED"
      : null;

  // Covenant breach threshold: revenue decline % that pushes DSCR to 1.0x
  const covenantBreachPct =
    dscr != null && dscr > 1.0
      ? Math.round(((dscr - 1.0) / dscr) * 100)
      : null;

  // Committee readiness score (0–100)
  const readiness = (() => {
    let score = 0;
    if (dscr != null && dscr >= 1.25) score += 40;
    else if (dscr != null && dscr >= 1.0) score += 20;
    if (policyExceptions === 0) score += 30;
    else if (policyExceptions <= 1) score += 15;
    const conf = auditConfidence ?? 0;
    if (conf >= 80) score += 30;
    else if (conf >= 60) score += 15;
    return score;
  })();

  const sbaStatus = (snapshot as any)?.snapshot?.sba_json?.status ?? null;

  // Sponsor support (simple proxy from personal net worth vs loan)
  const personalNetWorth = toNum(facts["personal_net_worth"]);
  const sponsorSupport =
    personalNetWorth == null || loanAmount == null
      ? null
      : personalNetWorth >= loanAmount * 3
      ? "Strong"
      : personalNetWorth >= loanAmount
      ? "Medium"
      : "Weak";

  // Final narrative
  const finalNarrative =
    spread?.narrative_report?.final_narrative ?? null;

  // Financial snapshot row — latest year data
  const snapRevenue = latestYear ? toNum(facts[`GROSS_RECEIPTS_${latestYear}`]) : null;
  const snapEbitda = latestYear ? toNum(facts[`EBITDA_${latestYear}`]) : null;
  const snapEbitdaMargin = latestYear ? toNum(ratios[`EBITDA_MARGIN_${latestYear}`]) : null;
  const snapDscr = latestYear ? toNum(ratios[`DSCR_${latestYear}`]) ?? dscr : null;
  const snapCurrentRatio = toNum(ratios["CURRENT_RATIO"] ?? ratios["ratio_current"]);
  const snapWorkingCapital = latestYear
    ? toNum(facts[`bs_working_capital_${latestYear}`]) ??
      toNum(facts["WORKING_CAPITAL"])
    : null;

  // Evidence rail
  const docVerifiedLabel =
    auditDocCount != null && totalDocs != null
      ? `${auditDocCount}/${totalDocs} Documents Verified`
      : totalDocs != null
      ? `${totalDocs} Documents`
      : "Documents";

  const docStatus: "pass" | "warn" | "fail" | "unknown" =
    auditDocCount != null && totalDocs != null
      ? auditDocCount === totalDocs
        ? "pass"
        : auditDocCount > 0
        ? "warn"
        : "fail"
      : "unknown";

  const reconChipStatus: "pass" | "warn" | "fail" | "unknown" =
    reconStatus === "CLEAN"
      ? "pass"
      : reconStatus === "FLAGS"
      ? "warn"
      : reconStatus === "CONFLICTS"
      ? "fail"
      : "unknown";

  // ── Render ────────────────────────────────────────────────────────────────

  if (spreadLoading) {
    return (
      <div className="px-6 py-12 text-center text-sm text-white/40">
        Loading intelligence...
      </div>
    );
  }

  if (pricingRequired) {
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-white/60 mb-3">
          Pricing assumptions required before intelligence can be generated.
        </p>
        <Link
          href={`/deals/${dealId}/pricing-memo`}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
        >
          Set Pricing
        </Link>
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-5">

      {/* ── Panel A: Metric Grid ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <MetricCell
          label="Exposure"
          value={fmtDollars(loanAmount)}
          context="Loan amount"
        />
        <MetricCell
          label="DSCR Base"
          value={fmtX(dscr)}
          context="Latest year"
          highlight={
            dscr == null ? null : dscr >= 1.25 ? "good" : dscr >= 1.0 ? "elevated" : "critical"
          }
        />
        <MetricCell
          label="DSCR Downside"
          value={fmtX(dscrDownside)}
          context="-15% rev stress"
          highlight={
            dscrDownside == null ? null : dscrDownside >= 1.25 ? "good" : dscrDownside >= 1.0 ? "elevated" : "critical"
          }
        />
        <MetricCell
          label="Leverage"
          value={leverage != null ? `${leverage.toFixed(1)}x` : "—"}
          context="Policy max 4.5x"
          highlight={leverage != null && leverage > 4.5 ? "elevated" : null}
        />
        <MetricCell
          label="Policy Exceptions"
          value={spread ? String(policyExceptions) : "—"}
          context="Open flags"
          highlight={policyExceptions > 0 ? (criticalCount > 0 ? "critical" : "elevated") : null}
        />
        <MetricCell
          label="Evidence Confidence"
          value={auditConfidence != null ? `${Math.round(auditConfidence)}%` : "—"}
          context="Document verification"
          highlight={
            auditConfidence == null ? null : auditConfidence >= 80 ? "good" : auditConfidence >= 60 ? "elevated" : "critical"
          }
        />
        <MetricCell
          label="Treasury Wallet"
          value={walletTier ?? "—"}
          context="Deposit + treasury"
          highlight={walletTier === "HIGH" ? "good" : walletTier === "LOW" ? "elevated" : null}
        />
        <MetricCell
          label="Sponsor Support"
          value={sponsorSupport ?? "—"}
          context="Guaranty coverage"
        />
        <MetricCell
          label="Covenant Breach"
          value={covenantBreachPct != null ? `Rev \u2193${covenantBreachPct}%` : "—"}
          context="Breaks DSCR 1.0x"
          highlight={covenantBreachPct != null && covenantBreachPct < 15 ? "elevated" : null}
        />
        <MetricCell
          label="Committee Readiness"
          value={spread ? `${readiness}%` : "—"}
          context="Readiness score"
          highlight={readiness >= 70 ? "good" : readiness >= 50 ? "elevated" : "critical"}
        />
        <MetricCell
          label="Open Issues"
          value={spread ? String(openFlags.length) : "—"}
          context="Unresolved"
          highlight={openFlags.length > 0 ? (criticalCount > 0 ? "critical" : "elevated") : null}
        />
        <MetricCell
          label="SBA Eligibility"
          value={
            sbaStatus === "eligible"
              ? "Eligible"
              : sbaStatus === "ineligible"
              ? "Ineligible"
              : sbaStatus === "conditional"
              ? "Conditional"
              : "—"
          }
          context="SBA screening"
          highlight={
            sbaStatus === "eligible" ? "good" : sbaStatus === "ineligible" ? "critical" : null
          }
        />
      </div>

      {/* ── Panel B: Risk Signal Strip ───────────────────────────────────── */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-white/40 mb-2">
          Risk Signals
        </div>
        {openFlags.length === 0 ? (
          <div className="border-l-2 border-emerald-500 bg-emerald-950/20 rounded-r-lg px-4 py-3 text-sm text-emerald-300">
            No open risk signals
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {openFlags
              .sort((a, b) => {
                const order: Record<string, number> = { critical: 0, elevated: 1, watch: 2, info: 3 };
                return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
              })
              .slice(0, 6)
              .map((f) => (
                <RiskCard
                  key={f.id}
                  severity={f.severity as FlagSeverity}
                  summary={f.banker_summary}
                  detail={f.banker_detail}
                />
              ))}
            {openFlags.length > 6 && (
              <div className="flex items-center justify-center min-w-[80px] text-xs text-white/50 border border-white/10 rounded-lg px-3">
                +{openFlags.length - 6} more
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Panel C: Financial Snapshot Row ─────────────────────────────── */}
      {latestYear && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-white/40 mb-2">
            Financial Snapshot — {latestYear}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricCell label="Revenue" value={fmtDollars(snapRevenue)} context={String(latestYear)} />
            <MetricCell label="EBITDA" value={fmtDollars(snapEbitda)} context={String(latestYear)} />
            <MetricCell label="EBITDA Margin" value={fmtPct(snapEbitdaMargin)} context={String(latestYear)} />
            <MetricCell label="DSCR" value={fmtX(snapDscr)} context={String(latestYear)} />
            <MetricCell label="Current Ratio" value={snapCurrentRatio != null ? `${snapCurrentRatio.toFixed(2)}x` : "—"} context="Liquidity" />
            <MetricCell label="Working Capital" value={fmtDollars(snapWorkingCapital)} context="BS derived" />
          </div>
        </div>
      )}

      {/* ── Panel D: Buddy's Assessment ─────────────────────────────────── */}
      <div className="border-l-4 border-primary/50 bg-white/[0.03] rounded-r-lg px-5 py-4">
        <div className="text-[10px] uppercase tracking-wide text-primary/70 mb-2">
          Buddy&apos;s Assessment
        </div>
        <p className="text-sm text-white/80 leading-relaxed">
          {finalNarrative ||
            "Complete financial data and set pricing to generate assessment."}
        </p>
      </div>

      {/* ── Panel E: Evidence Status Rail ───────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/5">
        <EvidenceChip label={docVerifiedLabel} status={docStatus} />
        <EvidenceChip
          label={`Reconciliation: ${reconStatus ?? "Pending"}`}
          status={reconChipStatus}
        />
        <EvidenceChip
          label={`Confidence: ${auditConfidence != null ? `${Math.round(auditConfidence)}%` : "—"}`}
          status={
            auditConfidence == null ? "unknown" : auditConfidence >= 80 ? "pass" : auditConfidence >= 60 ? "warn" : "fail"
          }
        />
        <Link
          href={`/deals/${dealId}/documents`}
          className="text-xs text-white/40 hover:text-white/70 ml-auto"
        >
          View Evidence &rarr;
        </Link>
      </div>

    </div>
  );
}
