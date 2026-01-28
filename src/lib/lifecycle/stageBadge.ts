/**
 * Stage Badge Utility
 *
 * Shared badge styling for both internal (5-stage) and unified (11-stage)
 * lifecycle representations. Used by DealCockpitClient and panel components.
 */

type StageBadge = {
  label: string;
  className: string;
};

/**
 * Get badge label + Tailwind class for a deal's lifecycle stage.
 * Handles both internal stages (created, intake, collecting, underwriting, ready)
 * and unified stages (intake_created, docs_requested, ..., closed, workout).
 */
export function getStageBadge(stage: string | null | undefined): StageBadge {
  if (!stage || stage === "created") {
    return { label: "New", className: "bg-slate-500/20 text-slate-300 border-slate-400/30" };
  }

  // Internal stages
  if (stage === "intake" || stage === "ignited" || stage === "collecting") {
    return { label: "Intake", className: "bg-sky-500/20 text-sky-300 border-sky-400/30" };
  }
  if (stage === "underwriting") {
    return { label: "Underwriting", className: "bg-amber-500/20 text-amber-300 border-amber-400/30" };
  }
  if (stage === "approved" || stage === "funded" || stage === "ready") {
    return { label: stage === "ready" ? "Ready" : stage, className: "bg-emerald-500/20 text-emerald-300 border-emerald-400/30" };
  }

  // Unified stages
  switch (stage) {
    case "intake_created":
      return { label: "New", className: "bg-slate-500/20 text-slate-300 border-slate-400/30" };
    case "docs_requested":
    case "docs_in_progress":
      return { label: "Collecting Docs", className: "bg-sky-500/20 text-sky-300 border-sky-400/30" };
    case "docs_satisfied":
    case "underwrite_ready":
      return { label: "Docs Complete", className: "bg-blue-500/20 text-blue-300 border-blue-400/30" };
    case "underwrite_in_progress":
      return { label: "Underwriting", className: "bg-amber-500/20 text-amber-300 border-amber-400/30" };
    case "committee_ready":
      return { label: "Committee Ready", className: "bg-purple-500/20 text-purple-300 border-purple-400/30" };
    case "committee_decisioned":
      return { label: "Decisioned", className: "bg-indigo-500/20 text-indigo-300 border-indigo-400/30" };
    case "closing_in_progress":
      return { label: "Closing", className: "bg-teal-500/20 text-teal-300 border-teal-400/30" };
    case "closed":
      return { label: "Closed", className: "bg-emerald-500/20 text-emerald-300 border-emerald-400/30" };
    case "workout":
      return { label: "Workout", className: "bg-red-500/20 text-red-300 border-red-400/30" };
    default:
      return { label: stage, className: "bg-white/10 text-white/70 border-white/20" };
  }
}
