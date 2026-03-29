"use client";

import { useEffect, useState, useCallback } from "react";
import type {
  EtranReadinessReport,
  EtranField,
} from "@/lib/sba/sbaEtranReadiness";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<string, string> = {
  present: "\u2705",
  missing: "\u274c",
  partial: "\u26a0\ufe0f",
};

const PRIORITY_LABEL: Record<string, string> = {
  required: "Required",
  conditional: "Conditional",
  recommended: "Recommended",
};

const SECTION_LABELS: Record<string, string> = {
  business: "Business Info",
  parties: "Owners & Parties",
  structure: "Loan Structure",
  collateral: "Collateral",
  story: "Deal Story",
  financials: "Financials",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldRow({
  field,
  onJump,
}: {
  field: EtranField;
  onJump: (section: string) => void;
}) {
  return (
    <div
      className={`flex items-start gap-3 py-2 border-b border-white/5 last:border-0 ${
        field.status === "missing"
          ? "bg-red-500/5"
          : field.status === "partial"
            ? "bg-amber-500/5"
            : ""
      }`}
    >
      <span className="text-base mt-0.5 flex-shrink-0">
        {STATUS_ICON[field.status]}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-white/80">
            {field.label}
          </span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
              field.priority === "required"
                ? "bg-red-500/20 text-red-300"
                : field.priority === "conditional"
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-white/10 text-white/50"
            }`}
          >
            {PRIORITY_LABEL[field.priority]}
          </span>
        </div>
        {field.currentValue && (
          <p className="text-xs text-white/40 mt-0.5 truncate">
            {field.currentValue}
          </p>
        )}
        {field.missingReason && (
          <p className="text-xs text-red-300/80 mt-0.5 leading-relaxed">
            {field.missingReason}
          </p>
        )}
      </div>
      {field.status !== "present" && (
        <button
          onClick={() => onJump(field.builderSection)}
          className="flex-shrink-0 text-xs text-blue-400 hover:text-blue-300 underline whitespace-nowrap"
          title={`Go to ${SECTION_LABELS[field.builderSection]} \u2192 ${field.builderFieldHint}`}
        >
          Fix in {SECTION_LABELS[field.builderSection]}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function SBAEtranReadinessPanel({
  dealId,
  onNavigateToBuilder,
}: {
  dealId: string;
  onNavigateToBuilder?: (section: string) => void;
}) {
  const [report, setReport] = useState<EtranReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/deals/${dealId}/sba/etran-readiness`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.report) setReport(d.report);
      })
      .catch((e) => console.error("[SBAEtranReadinessPanel]", e))
      .finally(() => setLoading(false));
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleJump = (section: string) => {
    if (onNavigateToBuilder) {
      onNavigateToBuilder(section);
    } else {
      window.location.href = `../builder?section=${section}`;
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-sm text-white/40 animate-pulse">
          Checking E-Tran readiness...
        </div>
      </div>
    );
  }

  if (!report) return null;

  const pct = Math.round(report.completionPct * 100);
  const isReady = report.readyToSubmit;

  const displayFields = showAll
    ? report.fields
    : report.fields.filter((f) => f.status !== "present");

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-3 cursor-pointer border-b border-white/10 ${
          isReady ? "bg-emerald-500/5" : "bg-red-500/5"
        }`}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{isReady ? "\u2705" : "\u274c"}</span>
          <div>
            <p className="text-sm font-semibold text-white/80">
              E-Tran Submission Readiness
            </p>
            <p className="text-xs text-white/50">
              {report.requiredPresentCount}/{report.requiredFieldCount}{" "}
              required fields complete &middot; {pct}%
            </p>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded font-semibold ${
              isReady
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-red-500/20 text-red-300"
            }`}
          >
            {report.overallStatus.replace("_", " ")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              load();
            }}
            className="text-xs text-white/40 hover:text-white/60"
            title="Refresh"
          >
            \u21bb
          </button>
          <span className="text-white/40 text-xs">
            {collapsed ? "Show" : "Hide"}
          </span>
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 py-3">
          {/* Progress bar */}
          <div className="w-full bg-white/10 rounded-full h-2 mb-3">
            <div
              className={`h-2 rounded-full transition-all ${
                isReady ? "bg-emerald-500" : "bg-red-500"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Ready banner */}
          {isReady && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 mb-3">
              <p className="text-xs font-semibold text-emerald-300">
                All required fields are present &mdash; this deal is ready
                for E-Tran submission.
              </p>
              {report.warnings.length > 0 && (
                <p className="text-xs text-emerald-200/70 mt-0.5">
                  {report.warnings.length} recommended field(s) still
                  missing &mdash; review before submitting.
                </p>
              )}
            </div>
          )}

          {/* Field list */}
          <div>
            {displayFields.length === 0 && !showAll ? (
              <p className="text-xs text-white/50 py-2">
                All required fields are complete.
              </p>
            ) : (
              displayFields.map((field) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  onJump={handleJump}
                />
              ))
            )}
          </div>

          {/* Toggle show all */}
          <button
            onClick={() => setShowAll(!showAll)}
            className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
          >
            {showAll
              ? "Show missing fields only"
              : `Show all ${report.fields.length} fields (${report.fields.filter((f) => f.status === "present").length} complete)`}
          </button>
        </div>
      )}
    </div>
  );
}
