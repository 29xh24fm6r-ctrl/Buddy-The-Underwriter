"use client";

import type {
  RelationshipSurfaceItem,
  RelationshipSurfaceAction,
  RelationshipCasePresentation,
} from "@/core/relationship-surface/types";
import { buildRelationshipCasePresentation } from "@/core/relationship-surface/buildRelationshipCasePresentation";

interface Props {
  item: RelationshipSurfaceItem;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "border-red-500/30 bg-red-500/10",
  warning: "border-amber-500/30 bg-amber-500/10",
  normal: "border-white/10 bg-white/[0.03]",
};

export default function RelationshipSurfaceFocusRail({ item }: Props) {
  return (
    <div className="space-y-4">
      {/* Why This Matters Now */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
          Why This Matters Now
        </h3>
        {item.explanationLines.map((line, i) => (
          <p key={i} className="text-sm text-white/80 mb-1">
            {line}
          </p>
        ))}
      </div>

      {/* Primary Move */}
      {item.primaryActionCode && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
          <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">
            Recommended Move
          </h3>
          <div className="text-sm font-semibold text-white">
            {item.primaryActionLabel}
          </div>
          <div className="text-xs text-white/50 mt-1">
            {item.primaryActionability === "execute_now"
              ? "Ready to execute"
              : item.primaryActionability === "approval_required"
                ? "Requires approval"
                : item.primaryActionability === "waiting_on_borrower"
                  ? "Waiting on borrower"
                  : "Review recommended"}
          </div>
        </div>
      )}

      {/* Supporting Moves */}
      {item.supportingActions.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
            Supporting Actions
          </h3>
          <div className="space-y-2">
            {item.supportingActions.map((action, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-white/70">{action.label}</span>
                <span className="text-xs text-white/40">{action.domain}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open Cases */}
      {item.openCases.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
            Open Cases
          </h3>
          <div className="space-y-2">
            {item.openCases.map((caseRef) => {
              const presentation = buildRelationshipCasePresentation(caseRef);
              return (
                <div
                  key={caseRef.caseId}
                  className={`rounded-lg border p-3 ${SEVERITY_COLORS[presentation.severity] ?? SEVERITY_COLORS.normal}`}
                >
                  <div className="text-sm font-semibold text-white">
                    {presentation.title}
                  </div>
                  <div className="text-xs text-white/50 mt-0.5">
                    {presentation.summary}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Evidence Summary */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
          Evidence
        </h3>
        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          <div>
            <div className="text-white font-mono">{item.evidenceSummary.reasonCount}</div>
            <div className="text-xs text-white/40">Reasons</div>
          </div>
          <div>
            <div className="text-white font-mono">{item.evidenceSummary.blockerCount}</div>
            <div className="text-xs text-white/40">Blockers</div>
          </div>
          <div>
            <div className="text-white font-mono">{item.evidenceSummary.caseCount}</div>
            <div className="text-xs text-white/40">Cases</div>
          </div>
        </div>
      </div>
    </div>
  );
}
