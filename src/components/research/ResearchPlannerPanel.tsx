"use client";

/**
 * ResearchPlannerPanel
 *
 * Displays what research Buddy has decided to run and why.
 * Builds trust through transparency - every decision is explainable.
 */

import { useState } from "react";
import type {
  ResearchPlan,
  ProposedMission,
  ResearchIntentLog,
} from "@/lib/research/planner/types";

type ResearchPlannerPanelProps = {
  plan?: ResearchPlan | null;
  intentLogs?: ResearchIntentLog[];
  onApprove?: (missionIndex: number, approved: boolean) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
};

/**
 * Format mission type for display.
 */
function formatMissionType(type: string): string {
  const labels: Record<string, string> = {
    industry_landscape: "Industry & Competitive Landscape",
    competitive_analysis: "Competitive Analysis",
    market_demand: "Market Demand & Demographics",
    demographics: "Demographics",
    regulatory_environment: "Regulatory Environment",
    management_backgrounds: "Management & Ownership Backgrounds",
  };
  return labels[type] ?? type.replace(/_/g, " ");
}

/**
 * Get status badge styling.
 */
function getStatusStyle(status: ProposedMission["status"]): { bg: string; text: string; label: string } {
  switch (status) {
    case "pending":
      return { bg: "bg-amber-100", text: "text-amber-700", label: "Pending" };
    case "approved":
      return { bg: "bg-blue-100", text: "text-blue-700", label: "Approved" };
    case "executing":
      return { bg: "bg-indigo-100", text: "text-indigo-700", label: "Running" };
    case "completed":
      return { bg: "bg-emerald-100", text: "text-emerald-700", label: "Complete" };
    case "failed":
      return { bg: "bg-red-100", text: "text-red-700", label: "Failed" };
    case "rejected":
      return { bg: "bg-slate-100", text: "text-slate-500", label: "Skipped" };
    default:
      return { bg: "bg-slate-100", text: "text-slate-600", label: status };
  }
}

/**
 * Get icon for mission type.
 */
function getMissionIcon(type: string): string {
  const icons: Record<string, string> = {
    industry_landscape: "🏭",
    competitive_analysis: "⚔️",
    market_demand: "📊",
    demographics: "👥",
    regulatory_environment: "⚖️",
    management_backgrounds: "👔",
  };
  return icons[type] ?? "📋";
}

/**
 * Mission card component.
 */
function MissionCard({
  mission,
  index,
  onApprove,
  intentLog,
}: {
  mission: ProposedMission;
  index: number;
  onApprove?: (index: number, approved: boolean) => void;
  intentLog?: ResearchIntentLog;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = getStatusStyle(mission.status);

  return (
    <div className="border border-slate-200 rounded-lg p-4 hover:border-slate-300 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <span className="text-2xl">{getMissionIcon(mission.mission_type)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold text-slate-800">
                {formatMissionType(mission.mission_type)}
              </h4>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.bg} ${status.text}`}>
                {status.label}
              </span>
            </div>
            <p className="text-sm text-slate-600 mt-1">{mission.rationale}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
              <span>Confidence: {Math.round(mission.confidence * 100)}%</span>
              <span>Priority: {mission.priority}</span>
            </div>
          </div>
        </div>

        {/* Actions for pending missions */}
        {mission.status === "pending" && onApprove && (
          <div className="flex gap-2">
            <button
              onClick={() => onApprove(index, true)}
              className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
            >
              Run
            </button>
            <button
              onClick={() => onApprove(index, false)}
              className="px-3 py-1.5 text-sm bg-slate-200 text-slate-700 rounded hover:bg-slate-300 transition-colors"
            >
              Skip
            </button>
          </div>
        )}
      </div>

      {/* Expandable details */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-3 text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span>Why Buddy decided this</span>
      </button>

      {expanded && (
        <div className="mt-3 p-3 bg-slate-50 rounded text-sm">
          <div className="space-y-2">
            {intentLog && (
              <>
                <div>
                  <span className="font-medium text-slate-600">Rule: </span>
                  <span className="text-slate-700">{intentLog.rule_name} (v{intentLog.rule_version})</span>
                </div>
                <div>
                  <span className="font-medium text-slate-600">Reasoning: </span>
                  <span className="text-slate-700">{intentLog.rationale}</span>
                </div>
                {intentLog.supporting_fact_ids.length > 0 && (
                  <div>
                    <span className="font-medium text-slate-600">Based on: </span>
                    <span className="text-slate-700">{intentLog.supporting_fact_ids.length} facts</span>
                  </div>
                )}
              </>
            )}
            {!intentLog && (
              <p className="text-slate-600 italic">
                {mission.rationale}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Empty state when no plan exists.
 */
function EmptyState({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <div className="text-center py-8">
      <div className="text-4xl mb-4">🧠</div>
      <h3 className="text-lg font-semibold text-slate-700 mb-2">
        No Research Plan Yet
      </h3>
      <p className="text-slate-500 mb-4 max-w-md mx-auto">
        Buddy will automatically plan research when business tax returns or other key documents are uploaded.
      </p>
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Check for Updates
        </button>
      )}
    </div>
  );
}

/**
 * Loading skeleton.
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 bg-slate-200 rounded w-2/3"></div>
      <div className="h-24 bg-slate-200 rounded"></div>
      <div className="h-24 bg-slate-200 rounded"></div>
    </div>
  );
}

/**
 * Main panel component.
 */
export default function ResearchPlannerPanel({
  plan,
  intentLogs,
  onApprove,
  onRefresh,
  isLoading,
}: ResearchPlannerPanelProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <span>🧠</span>
          <span>Research Plan</span>
        </h2>
        <LoadingSkeleton />
      </div>
    );
  }

  // Empty state
  if (!plan || plan.proposed_missions.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <span>🧠</span>
          <span>Research Plan</span>
        </h2>
        <EmptyState onRefresh={onRefresh} />
      </div>
    );
  }

  // Group missions by status
  const pending = plan.proposed_missions.filter((m) => m.status === "pending");
  const running = plan.proposed_missions.filter((m) => m.status === "executing" || m.status === "approved");
  const completed = plan.proposed_missions.filter((m) => m.status === "completed");
  const skipped = plan.proposed_missions.filter((m) => m.status === "rejected" || m.status === "failed");

  // Get intent log for a mission
  const getIntentLog = (missionType: string): ResearchIntentLog | undefined => {
    return intentLogs?.find(
      (log) => log.mission_type === missionType && log.intent_type === "mission_proposed"
    );
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <span>🧠</span>
          <span>Research Plan</span>
        </h2>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          {plan.approved_by === "system" ? (
            <span className="px-2 py-1 bg-slate-100 rounded-full text-xs">Auto-approved</span>
          ) : (
            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs">Banker approved</span>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-1.5 hover:bg-slate-100 rounded transition-colors"
              title="Refresh"
            >
              🔄
            </button>
          )}
        </div>
      </div>

      {/* Buddy says */}
      <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-100">
        <p className="text-slate-700">
          <span className="font-medium">Buddy says:</span>{" "}
          {completed.length === plan.proposed_missions.length
            ? "All planned research is complete. Review the findings in the Research tab."
            : running.length > 0
              ? `Researching: ${running.map((m) => formatMissionType(m.mission_type)).join(", ")}...`
              : `Based on the documents uploaded, I recommend ${plan.proposed_missions.length} research mission${plan.proposed_missions.length > 1 ? "s" : ""}.`
          }
        </p>
      </div>

      {/* Missions list */}
      <div className="space-y-4">
        {plan.proposed_missions.map((mission, index) => (
          <MissionCard
            key={`${mission.mission_type}-${index}`}
            mission={mission}
            index={index}
            onApprove={onApprove}
            intentLog={getIntentLog(mission.mission_type)}
          />
        ))}
      </div>

      {/* Summary stats */}
      <div className="mt-6 pt-4 border-t border-slate-200 flex gap-4 text-sm text-slate-500">
        {completed.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            {completed.length} complete
          </span>
        )}
        {running.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
            {running.length} running
          </span>
        )}
        {pending.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            {pending.length} pending
          </span>
        )}
        {skipped.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-slate-400"></span>
            {skipped.length} skipped
          </span>
        )}
      </div>

      {/* Trigger info */}
      <div className="mt-4 text-xs text-slate-400">
        Plan created: {new Date(plan.created_at).toLocaleString()} • Trigger: {plan.trigger_event.replace(/_/g, " ")}
      </div>
    </div>
  );
}
