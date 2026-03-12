"use client";

import { useState } from "react";
import { useSpreadOutput } from "@/hooks/useSpreadOutput";
import { useAIRisk } from "@/hooks/useAIRisk";
import type { AuditCertRow } from "./page";

// ─── Types ───────────────────────────────────────────────────────────────────

type FlagSeverity = "critical" | "elevated" | "watch" | "info";

type Flag = {
  id: string;
  severity: FlagSeverity;
  status: string;
  banker_summary: string;
  banker_detail: string;
  domain?: string | null;
  field?: string | null;
  recommendation?: string | null;
};

// ─── Risk domain taxonomy ────────────────────────────────────────────────────

const DOMAIN_PATTERNS: Array<{ pattern: RegExp; domain: string }> = [
  { pattern: /dscr|debt.service|coverage/i, domain: "Coverage" },
  { pattern: /ebitda|earnings|margin|profitability/i, domain: "Earnings Quality" },
  { pattern: /leverage|debt.to|loan.to/i, domain: "Leverage" },
  { pattern: /liquidity|current.ratio|working.capital|cash/i, domain: "Liquidity" },
  { pattern: /revenue|sales|top.line|concentration/i, domain: "Revenue Risk" },
  { pattern: /trend|declining|compressing/i, domain: "Trend" },
  { pattern: /collateral|ltv|appraisal|property/i, domain: "Collateral" },
  { pattern: /guarantor|sponsor|personal/i, domain: "Sponsor" },
  { pattern: /document|extraction|confidence|reconcil/i, domain: "Data Quality" },
  { pattern: /sba|eligib|program/i, domain: "Program Eligibility" },
  { pattern: /industry|naics|sector/i, domain: "Industry" },
];

function classifyDomain(flag: Flag): string {
  const text = [flag.domain, flag.field, flag.banker_summary, flag.banker_detail]
    .filter(Boolean)
    .join(" ");
  for (const { pattern, domain } of DOMAIN_PATTERNS) {
    if (pattern.test(text)) return domain;
  }
  return "Other";
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "\u2014";
  return `${Math.round(n)}%`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "\u2014";
  return new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Severity styles ─────────────────────────────────────────────────────────

const SEV: Record<
  FlagSeverity,
  { border: string; bg: string; chip: string; dot: string }
> = {
  critical: {
    border: "border-l-4 border-rose-500",
    bg: "bg-rose-950/20",
    chip: "text-rose-400 bg-rose-950/40 border-rose-500/40",
    dot: "bg-rose-500",
  },
  elevated: {
    border: "border-l-4 border-amber-500",
    bg: "bg-amber-950/20",
    chip: "text-amber-400 bg-amber-950/40 border-amber-500/40",
    dot: "bg-amber-500",
  },
  watch: {
    border: "border-l-4 border-yellow-500/60",
    bg: "bg-yellow-950/10",
    chip: "text-yellow-400 bg-yellow-950/30 border-yellow-500/30",
    dot: "bg-yellow-500",
  },
  info: {
    border: "border-l-2 border-white/15",
    bg: "bg-white/[0.02]",
    chip: "text-white/50 bg-white/5 border-white/10",
    dot: "bg-white/30",
  },
};

const SEV_ORDER: FlagSeverity[] = ["critical", "elevated", "watch", "info"];

// ─── Identity status chip ────────────────────────────────────────────────────

function identityChip(status: string | null): { label: string; cls: string } {
  if (!status) return { label: "\u2014", cls: "text-white/30" };
  const s = status.toUpperCase();
  if (s === "VERIFIED") return { label: "Verified", cls: "text-emerald-400" };
  if (s === "FLAGGED") return { label: "Flagged", cls: "text-amber-400" };
  if (s === "BLOCKED") return { label: "Blocked", cls: "text-rose-400" };
  if (s === "PARTIAL") return { label: "Partial", cls: "text-yellow-400" };
  return { label: status, cls: "text-white/50" };
}

function confidenceColor(n: number | null): string {
  if (n == null) return "text-white/40";
  if (n >= 80) return "text-emerald-400";
  if (n >= 60) return "text-amber-400";
  return "text-rose-400";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-white/40 mb-2">
      {children}
    </div>
  );
}

function FlagCard({
  flag,
  expanded,
  onToggle,
}: {
  flag: Flag;
  expanded: boolean;
  onToggle: () => void;
}) {
  const s = SEV[flag.severity] ?? SEV.info;
  const resolved = flag.status === "resolved" || flag.status === "waived";

  return (
    <div
      className={`${s.border} ${s.bg} rounded-r-lg transition-colors ${resolved ? "opacity-50" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-start gap-3"
      >
        <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${s.chip}`}
            >
              {flag.severity}
            </span>
            {resolved && (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/40">
                {flag.status}
              </span>
            )}
            <span className="text-sm text-white/90 truncate">
              {flag.banker_summary}
            </span>
          </div>
        </div>
        <span className="text-white/30 text-xs shrink-0 mt-0.5">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2 border-t border-white/[0.06] pt-3">
          <p className="text-sm text-white/70 leading-relaxed">
            {flag.banker_detail}
          </p>
          {flag.recommendation && (
            <div className="text-xs text-white/50 italic">
              Recommendation: {flag.recommendation}
            </div>
          )}
          {flag.field && (
            <div className="text-[10px] text-white/30 font-mono">
              field: {flag.field}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RiskClient({
  dealId,
  auditCerts,
}: {
  dealId: string;
  auditCerts: AuditCertRow[];
}) {
  const { data: spread, loading } = useSpreadOutput(dealId);
  const { run: aiRun, loading: aiLoading, running: aiRunning, error: aiError, runAssessment } = useAIRisk(dealId);
  const [expandedFlags, setExpandedFlags] = useState<Set<string>>(new Set());
  const [showResolved, setShowResolved] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FlagSeverity | "all">("all");

  const allFlags: Flag[] = (spread?.flag_report?.flags ?? []) as Flag[];

  const openFlags = allFlags.filter(
    (f) => f.status !== "resolved" && f.status !== "waived",
  );

  const visibleFlags = (showResolved ? allFlags : openFlags).filter(
    (f) => activeFilter === "all" || f.severity === activeFilter,
  );

  const sortedFlags = [...visibleFlags].sort((a, b) => {
    const ao = SEV_ORDER.indexOf(a.severity);
    const bo = SEV_ORDER.indexOf(b.severity);
    if (ao !== bo) return ao - bo;
    return a.banker_summary.localeCompare(b.banker_summary);
  });

  const byDomain = sortedFlags.reduce<Record<string, Flag[]>>((acc, f) => {
    const domain = classifyDomain(f);
    (acc[domain] ??= []).push(f);
    return acc;
  }, {});

  const counts = {
    critical: openFlags.filter((f) => f.severity === "critical").length,
    elevated: openFlags.filter((f) => f.severity === "elevated").length,
    watch: openFlags.filter((f) => f.severity === "watch").length,
    info: openFlags.filter((f) => f.severity === "info").length,
  };

  function toggleFlag(id: string) {
    setExpandedFlags((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const avgConfidence =
    auditCerts.length > 0
      ? auditCerts.reduce((s, c) => s + (c.overall_confidence ?? 0), 0) /
        auditCerts.length
      : null;

  if (loading) {
    return (
      <div className="px-6 py-12 text-center text-sm text-white/40">
        Loading risk signals\u2026
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-8">
      {/* ── AI Risk Assessment Panel ──────────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold text-white/90">AI Risk Assessment</div>
            <div className="text-xs text-white/40 mt-0.5">
              Explainable risk grade + pricing rationale from Buddy AI
            </div>
          </div>
          <button
            type="button"
            onClick={runAssessment}
            disabled={aiRunning}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-xs font-semibold text-white transition-colors"
          >
            {aiRunning ? (
              <>
                <span className="animate-spin inline-block w-3 h-3 border border-white/40 border-t-white rounded-full" />
                Running&hellip;
              </>
            ) : (
              "Run AI Assessment"
            )}
          </button>
        </div>

        {aiError && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 px-4 py-3 text-xs text-rose-400 mb-4">
            {aiError}
          </div>
        )}

        {aiLoading && !aiRun && (
          <div className="text-xs text-white/30 py-2">Loading previous assessment&hellip;</div>
        )}

        {aiRun && (
          <div className="space-y-4">
            {/* Grade + Pricing */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-indigo-300">{aiRun.grade}</span>
                <span className="text-xs text-white/40 uppercase tracking-wide">Risk Grade</span>
              </div>
              <div className="text-xs text-white/50">
                Base: <span className="text-white/80 font-mono">{aiRun.baseRateBps} bps</span>
                {" \u00b7 "}
                Premium: <span className="text-white/80 font-mono">{aiRun.riskPremiumBps} bps</span>
                {" \u00b7 "}
                Total: <span className="text-indigo-300 font-mono font-semibold">{aiRun.baseRateBps + aiRun.riskPremiumBps} bps</span>
              </div>
              {aiRun.createdAt && (
                <div className="ml-auto text-[10px] text-white/30">
                  {new Date(aiRun.createdAt).toLocaleString()}
                </div>
              )}
            </div>

            {/* Factors */}
            {aiRun.factors.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wide text-white/30 mb-2">Key Factors</div>
                {aiRun.factors.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                  >
                    <span
                      className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                        f.direction === "positive"
                          ? "bg-emerald-400"
                          : f.direction === "negative"
                          ? "bg-rose-400"
                          : "bg-white/30"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white/80 font-medium">{f.label}</div>
                      <div className="text-[11px] text-white/45 mt-0.5 leading-relaxed">{f.rationale}</div>
                    </div>
                    <div className="shrink-0 text-[10px] text-white/30 tabular-nums">
                      {Math.round(f.confidence * 100)}%
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pricing Explain */}
            {aiRun.pricingExplain.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-white/30 mb-2">Pricing Adders</div>
                {aiRun.pricingExplain.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg border border-white/[0.05] bg-white/[0.01]">
                    <span className="text-white/60">{p.label}</span>
                    <span className="font-mono text-white/80">+{p.bps} bps</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!aiRun && !aiLoading && !aiRunning && (
          <div className="text-xs text-white/30 py-2">
            No assessment yet. Click &quot;Run AI Assessment&quot; to generate an explainable risk grade.
          </div>
        )}
      </div>

      {/* ── Section 1: Risk Summary Bar ───────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["critical", "elevated", "watch", "info"] as FlagSeverity[]).map(
          (sev) => {
            const s = SEV[sev];
            const count = counts[sev];
            const active = activeFilter === sev;
            return (
              <button
                key={sev}
                type="button"
                onClick={() => setActiveFilter(active ? "all" : sev)}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  active
                    ? `${s.bg} ${s.border.replace("border-l-4", "border").replace("border-l-2", "border")}`
                    : "border-white/10 bg-white/5 hover:bg-white/8"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">
                  {sev}
                </div>
                <div
                  className={`text-2xl font-semibold ${count > 0 ? s.chip.split(" ")[0] : "text-white/30"}`}
                >
                  {count}
                </div>
              </button>
            );
          },
        )}
      </div>

      {/* ── Section 2: Controls ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setActiveFilter("all")}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            activeFilter === "all"
              ? "border-white/20 bg-white/10 text-white"
              : "border-white/10 text-white/50 hover:text-white/80"
          }`}
        >
          All Domains
        </button>
        <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="rounded border-white/20"
          />
          Show resolved / waived
        </label>
        {openFlags.length > 0 && (
          <button
            type="button"
            onClick={() =>
              setExpandedFlags(
                expandedFlags.size === sortedFlags.length
                  ? new Set()
                  : new Set(sortedFlags.map((f) => f.id)),
              )
            }
            className="text-xs text-white/40 hover:text-white/70"
          >
            {expandedFlags.size === sortedFlags.length
              ? "Collapse all"
              : "Expand all"}
          </button>
        )}
      </div>

      {/* ── Section 3: Risk Signal Grid ───────────────────────────────────── */}
      {openFlags.length === 0 && !showResolved ? (
        <div className="border-l-4 border-emerald-500 bg-emerald-950/20 rounded-r-lg px-5 py-4">
          <p className="text-sm text-emerald-300 font-medium">
            No open risk signals.
          </p>
          <p className="text-xs text-emerald-400/60 mt-1">
            All flags are resolved or waived. Review evidence audit below.
          </p>
        </div>
      ) : Object.keys(byDomain).length === 0 ? (
        <div className="text-sm text-white/40 text-center py-8">
          No flags match the current filter.
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byDomain).map(([domain, flags]) => (
            <div key={domain}>
              <SectionHeader>
                {domain} &mdash; {flags.length} signal
                {flags.length !== 1 ? "s" : ""}
              </SectionHeader>
              <div className="space-y-2">
                {flags.map((flag) => (
                  <FlagCard
                    key={flag.id}
                    flag={flag}
                    expanded={expandedFlags.has(flag.id)}
                    onToggle={() => toggleFlag(flag.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Section 4: Evidence Audit ─────────────────────────────────────── */}
      <div>
        <SectionHeader>
          Evidence Audit
          {avgConfidence != null && (
            <span
              className={`ml-2 normal-case text-xs font-normal ${confidenceColor(avgConfidence)}`}
            >
              avg confidence {fmtPct(avgConfidence)}
            </span>
          )}
        </SectionHeader>

        {auditCerts.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-6 text-sm text-white/40 text-center">
            No audit certificates found. Extract documents to generate
            verification results.
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.03]">
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                    Document
                  </th>
                  <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                    Confidence
                  </th>
                  <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                    Corroboration
                  </th>
                  <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                    Reasonableness
                  </th>
                  <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                    Identity
                  </th>
                  <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                    Certified
                  </th>
                </tr>
              </thead>
              <tbody>
                {auditCerts.map((cert) => {
                  const id = identityChip(cert.identity_status);
                  return (
                    <tr
                      key={cert.id}
                      className="border-t border-white/[0.06] hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-2.5 text-white/80 text-xs max-w-[240px]">
                        <div
                          className="truncate"
                          title={
                            cert.document_name ??
                            cert.document_id ??
                            cert.id
                          }
                        >
                          {cert.document_name ?? cert.document_id ?? "\u2014"}
                        </div>
                      </td>
                      <td
                        className={`text-right px-4 py-2.5 tabular-nums font-semibold ${confidenceColor(cert.overall_confidence)}`}
                      >
                        {fmtPct(cert.overall_confidence)}
                      </td>
                      <td
                        className={`text-right px-4 py-2.5 tabular-nums ${confidenceColor(cert.corroboration_score)}`}
                      >
                        {fmtPct(cert.corroboration_score)}
                      </td>
                      <td
                        className={`text-right px-4 py-2.5 tabular-nums ${confidenceColor(cert.reasonableness_score)}`}
                      >
                        {fmtPct(cert.reasonableness_score)}
                      </td>
                      <td
                        className={`text-right px-4 py-2.5 text-xs font-medium ${id.cls}`}
                      >
                        {id.label}
                      </td>
                      <td className="text-right px-4 py-2.5 text-xs text-white/40">
                        {fmtDate(cert.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
