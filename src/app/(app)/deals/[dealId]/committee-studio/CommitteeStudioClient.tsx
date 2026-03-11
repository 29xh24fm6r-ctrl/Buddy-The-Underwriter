"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSpreadOutput } from "@/hooks/useSpreadOutput";
import type { CommitteeServerData } from "./page";

// ─── Types ───────────────────────────────────────────────────────────────────

type SignalTier = "APPROVE" | "CAUTION" | "DECLINE";

type RecommendationSignal = {
  tier: SignalTier;
  reasons: string[];
  dscr: number | null;
  flagCriticalCount: number;
  flagElevatedCount: number;
  avgConfidence: number | null;
  reconStatus: string | null;
};

// ─── Formatting ──────────────────────────────────────────────────────────────

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !isFinite(n)) return "\u2014";
  return n.toFixed(digits);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "\u2014";
  return `${n.toFixed(1)}%`;
}

// ─── Signal derivation ──────────────────────────────────────────────────────

function deriveRecommendation(
  dscr: number | null,
  flagCriticalCount: number,
  flagElevatedCount: number,
  avgConfidence: number | null,
  reconStatus: string | null,
): RecommendationSignal {
  const reasons: string[] = [];

  // Use numeric severity to avoid TS narrowing issues with string literals
  // 0 = APPROVE, 1 = CAUTION, 2 = DECLINE
  let severity = 0;

  // DSCR check
  if (dscr == null) {
    reasons.push("DSCR not computed — pricing data required");
    severity = Math.max(severity, 1);
  } else if (dscr < 1.0) {
    reasons.push(`DSCR ${dscr.toFixed(2)}x — below breakeven`);
    severity = 2;
  } else if (dscr < 1.25) {
    reasons.push(`DSCR ${dscr.toFixed(2)}x — below 1.25x policy minimum`);
    severity = Math.max(severity, 1);
  }

  // Critical flags
  if (flagCriticalCount > 0) {
    reasons.push(`${flagCriticalCount} critical risk flag${flagCriticalCount > 1 ? "s" : ""} unresolved`);
    severity = 2;
  }

  // Elevated flags
  if (flagElevatedCount >= 3) {
    reasons.push(`${flagElevatedCount} elevated risk flags — concentration risk`);
    severity = Math.max(severity, 1);
  }

  // Confidence
  if (avgConfidence != null && avgConfidence < 0.85) {
    reasons.push(`Average extraction confidence ${(avgConfidence * 100).toFixed(0)}% — below 85% threshold`);
    severity = Math.max(severity, 1);
  }

  // Reconciliation
  if (reconStatus === "CONFLICTS") {
    reasons.push("Cross-document reconciliation has unresolved conflicts");
    severity = Math.max(severity, 1);
  } else if (reconStatus == null) {
    reasons.push("Reconciliation not yet run");
    severity = Math.max(severity, 1);
  }

  if (reasons.length === 0) {
    reasons.push("All checks pass — no policy exceptions identified");
  }

  const tier: SignalTier = severity >= 2 ? "DECLINE" : severity >= 1 ? "CAUTION" : "APPROVE";

  return { tier, reasons, dscr, flagCriticalCount, flagElevatedCount, avgConfidence, reconStatus };
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-white/40 mb-3">
      {children}
    </div>
  );
}

const TIER_STYLES: Record<SignalTier, { bg: string; border: string; text: string; label: string }> = {
  APPROVE: {
    bg: "bg-emerald-950/30",
    border: "border-emerald-500/30",
    text: "text-emerald-300",
    label: "Approve",
  },
  CAUTION: {
    bg: "bg-amber-950/30",
    border: "border-amber-500/30",
    text: "text-amber-300",
    label: "Caution",
  },
  DECLINE: {
    bg: "bg-rose-950/30",
    border: "border-rose-500/30",
    text: "text-rose-300",
    label: "Decline",
  },
};

function RecommendationPanel({ signal }: { signal: RecommendationSignal }) {
  const style = TIER_STYLES[signal.tier];

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} px-6 py-5`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-white/40 mb-2">
            Recommendation Signal
          </div>
          <div className={`text-3xl font-bold ${style.text}`}>
            {style.label}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-right shrink-0">
          <div className="text-[10px] uppercase text-white/40">DSCR</div>
          <div className="text-sm font-semibold text-white">{fmtNum(signal.dscr)}</div>
          <div className="text-[10px] uppercase text-white/40">Critical</div>
          <div className={`text-sm font-semibold ${signal.flagCriticalCount > 0 ? "text-rose-300" : "text-white"}`}>
            {signal.flagCriticalCount}
          </div>
          <div className="text-[10px] uppercase text-white/40">Elevated</div>
          <div className={`text-sm font-semibold ${signal.flagElevatedCount >= 3 ? "text-amber-300" : "text-white"}`}>
            {signal.flagElevatedCount}
          </div>
          <div className="text-[10px] uppercase text-white/40">Confidence</div>
          <div className="text-sm font-semibold text-white">{fmtPct(signal.avgConfidence != null ? signal.avgConfidence * 100 : null)}</div>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        {signal.reasons.map((r, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className={`mt-0.5 text-xs ${style.text}`}>
              {signal.tier === "APPROVE" ? "\u2713" : signal.tier === "CAUTION" ? "\u26A0" : "\u2717"}
            </span>
            <span className="text-sm text-white/70">{r}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PolicyExceptionsPanel({
  signal,
  reconConflicts,
}: {
  signal: RecommendationSignal;
  reconConflicts: number;
}) {
  const exceptions: Array<{ label: string; severity: "critical" | "elevated" | "watch"; detail: string }> = [];

  if (signal.dscr != null && signal.dscr < 1.25) {
    exceptions.push({
      label: "DSCR Below Policy Minimum",
      severity: signal.dscr < 1.0 ? "critical" : "elevated",
      detail: `DSCR of ${signal.dscr.toFixed(2)}x is ${signal.dscr < 1.0 ? "below breakeven (1.0x)" : "below 1.25x policy floor"}. Requires committee exception.`,
    });
  }

  if (signal.flagCriticalCount > 0) {
    exceptions.push({
      label: "Unresolved Critical Risk Flags",
      severity: "critical",
      detail: `${signal.flagCriticalCount} critical flag${signal.flagCriticalCount > 1 ? "s" : ""} require resolution before committee approval.`,
    });
  }

  if (signal.avgConfidence != null && signal.avgConfidence < 0.85) {
    exceptions.push({
      label: "Low Extraction Confidence",
      severity: "elevated",
      detail: `Average confidence ${(signal.avgConfidence * 100).toFixed(0)}% is below the 85% threshold. Consider re-extraction or manual verification.`,
    });
  }

  if (reconConflicts > 0) {
    exceptions.push({
      label: "Reconciliation Conflicts",
      severity: "elevated",
      detail: `${reconConflicts} cross-document check${reconConflicts > 1 ? "s" : ""} returned conflicts. Review reconciliation results before proceeding.`,
    });
  }

  const sevColors = {
    critical: "border-rose-500/30 bg-rose-950/20 text-rose-300",
    elevated: "border-amber-500/30 bg-amber-950/20 text-amber-300",
    watch: "border-white/10 bg-white/5 text-white/50",
  };

  return (
    <div>
      <SectionHeader>Policy Exceptions Register</SectionHeader>
      {exceptions.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 px-5 py-4 text-sm text-emerald-300">
          No policy exceptions identified. All metrics within approved thresholds.
        </div>
      ) : (
        <div className="space-y-2">
          {exceptions.map((ex, i) => (
            <div
              key={i}
              className={`rounded-lg border px-4 py-3 ${sevColors[ex.severity]}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${sevColors[ex.severity]}`}
                >
                  {ex.severity}
                </span>
                <span className="text-sm font-semibold text-white">{ex.label}</span>
              </div>
              <p className="text-xs text-white/60">{ex.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type ChecklistItem = {
  label: string;
  passed: boolean;
  detail: string;
};

function ReadinessChecklist({ items }: { items: ChecklistItem[] }) {
  const passedCount = items.filter((i) => i.passed).length;

  return (
    <div>
      <SectionHeader>
        Committee Readiness &mdash; {passedCount} of {items.length}
      </SectionHeader>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div
            key={i}
            className={`rounded-lg border px-4 py-3 flex items-start gap-3 ${
              item.passed
                ? "border-emerald-500/20 bg-emerald-950/10"
                : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <span
              className={`mt-0.5 text-sm font-bold ${
                item.passed ? "text-emerald-400" : "text-white/30"
              }`}
            >
              {item.passed ? "\u2713" : "\u25CB"}
            </span>
            <div>
              <div className="text-sm font-medium text-white">{item.label}</div>
              <div className="text-xs text-white/50 mt-0.5">{item.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PackageLinksGrid({ dealId }: { dealId: string }) {
  const links = [
    { label: "Credit Memo", href: `/credit-memo/${dealId}/canonical`, icon: "\uD83D\uDCDD" },
    { label: "Financials", href: `/deals/${dealId}/financials`, icon: "\uD83D\uDCCA" },
    { label: "Risk Flags", href: `/deals/${dealId}/risk`, icon: "\u26A0\uFE0F" },
    { label: "Structure", href: `/deals/${dealId}/structure`, icon: "\uD83C\uDFD7\uFE0F" },
    { label: "Relationship", href: `/deals/${dealId}/relationship`, icon: "\uD83E\uDD1D" },
    { label: "Classic Spread PDF", href: `/api/deals/${dealId}/classic-spread/pdf`, icon: "\uD83D\uDCC4", external: true },
  ];

  return (
    <div>
      <SectionHeader>Committee Package Links</SectionHeader>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {links.map((link) => (
          <Link
            key={link.label}
            href={link.href}
            target={link.external ? "_blank" : undefined}
            rel={link.external ? "noopener noreferrer" : undefined}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 flex items-center gap-3 hover:bg-white/[0.06] transition-colors group"
          >
            <span className="text-lg leading-none">{link.icon}</span>
            <span className="text-sm font-medium text-white/80 group-hover:text-white">
              {link.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function CommitteeStudioClient({
  dealId,
  serverData,
}: {
  dealId: string;
  serverData: CommitteeServerData;
}) {
  const { data: spread, loading: spreadLoading } = useSpreadOutput(dealId);

  const facts = spread?.canonical_facts ?? {};
  const years = (spread?.years_available ?? []).sort((a, b) => a - b);
  const latestYear = years.length > 0 ? years[years.length - 1] : null;

  // Extract key values
  const dscr = spread?.ratios?.dscr ?? null;
  const flags = spread?.flag_report?.flags ?? [];
  const criticalCount = flags.filter((f) => f.severity === "critical").length;
  const elevatedCount = flags.filter((f) => f.severity === "elevated").length;

  // Average confidence from audit certs
  const avgConfidence = useMemo(() => {
    const confs = serverData.auditCerts
      .map((c) => c.overall_confidence)
      .filter((c): c is number => c != null);
    if (confs.length === 0) return null;
    return confs.reduce((s, v) => s + v, 0) / confs.length;
  }, [serverData.auditCerts]);

  // Derive recommendation signal
  const signal = useMemo(
    () =>
      deriveRecommendation(
        dscr,
        criticalCount,
        elevatedCount,
        avgConfidence,
        serverData.reconciliation.status,
      ),
    [dscr, criticalCount, elevatedCount, avgConfidence, serverData.reconciliation.status],
  );

  // Build readiness checklist (7 items)
  const checklist: ChecklistItem[] = useMemo(() => {
    const certCount = serverData.auditCerts.length;
    const docCount = serverData.totalDocCount;
    const allVerified = certCount > 0 && certCount >= docCount;

    const hasFinancials = latestYear != null && Object.keys(facts).length > 0;
    const hasDscr = dscr != null;
    const reconClean =
      serverData.reconciliation.status === "CLEAN" ||
      serverData.reconciliation.status === "FLAGS";
    const noCritical = criticalCount === 0;
    const confAbove = avgConfidence != null && avgConfidence >= 0.85;
    const hasSpread = spread != null;

    return [
      {
        label: "Documents Extracted",
        passed: docCount > 0,
        detail: docCount > 0
          ? `${docCount} document${docCount > 1 ? "s" : ""} uploaded and processed`
          : "No documents uploaded yet",
      },
      {
        label: "Audit Certificates Issued",
        passed: allVerified,
        detail: allVerified
          ? `${certCount} certificate${certCount > 1 ? "s" : ""} — all documents verified`
          : `${certCount} of ${docCount} document${docCount > 1 ? "s" : ""} have audit certificates`,
      },
      {
        label: "Financial Data Available",
        passed: hasFinancials,
        detail: hasFinancials
          ? `${years.length} period${years.length > 1 ? "s" : ""} available (${years.join(", ")})`
          : "No financial periods extracted yet",
      },
      {
        label: "DSCR Computed",
        passed: hasDscr,
        detail: hasDscr
          ? `DSCR = ${dscr!.toFixed(2)}x`
          : "Pricing data required to compute DSCR",
      },
      {
        label: "Reconciliation Complete",
        passed: reconClean,
        detail: reconClean
          ? `Status: ${serverData.reconciliation.status} — ${serverData.reconciliation.check_count} checks passed`
          : serverData.reconciliation.status === "CONFLICTS"
            ? `${serverData.reconciliation.conflict_count} conflict${serverData.reconciliation.conflict_count > 1 ? "s" : ""} found — review required`
            : "Cross-document reconciliation not yet run",
      },
      {
        label: "No Critical Risk Flags",
        passed: noCritical,
        detail: noCritical
          ? "Zero critical risk flags"
          : `${criticalCount} critical flag${criticalCount > 1 ? "s" : ""} require resolution`,
      },
      {
        label: "Extraction Confidence Above Threshold",
        passed: confAbove,
        detail: confAbove
          ? `Average confidence: ${(avgConfidence! * 100).toFixed(0)}%`
          : avgConfidence != null
            ? `Average confidence: ${(avgConfidence * 100).toFixed(0)}% — below 85% threshold`
            : "No audit certificates to measure confidence",
      },
    ];
  }, [
    serverData, latestYear, facts, dscr, criticalCount, avgConfidence, spread, years,
  ]);

  // ── Loading ──────────────────────────────────────────────────────────────

  if (spreadLoading) {
    return (
      <div className="px-6 py-12 text-center text-sm text-white/40">
        Loading committee data&hellip;
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-6 space-y-8">
      {/* Panel A: Recommendation Signal */}
      <RecommendationPanel signal={signal} />

      {/* Panel B: Policy Exceptions */}
      <PolicyExceptionsPanel
        signal={signal}
        reconConflicts={serverData.reconciliation.conflict_count}
      />

      {/* Panel C: Readiness Checklist */}
      <ReadinessChecklist items={checklist} />

      {/* Panel D: Package Links */}
      <PackageLinksGrid dealId={dealId} />

      {/* Footer: Compliance */}
      <div className="rounded-xl border border-white/8 bg-white/[0.015] px-5 py-4">
        <div className="text-[10px] uppercase tracking-wide text-white/30 mb-2">
          Committee Governance
        </div>
        <p className="text-xs text-white/40 leading-relaxed">
          Recommendation signals are advisory. Final credit authority rests with
          the credit committee per OCC SR 11-7 and FDIC model risk guidance.
          All data points are derived from audited extraction results with
          confidence scoring and cross-document reconciliation.
        </p>
      </div>
    </div>
  );
}
