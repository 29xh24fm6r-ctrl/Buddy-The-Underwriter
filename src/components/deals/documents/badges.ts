/**
 * Pure badge logic for the Documents table.
 *
 * Extracted so the deterministic label/tone rules can be regression-tested
 * without mounting React components.
 */

// ---------------------------------------------------------------------------
// Minimal model — callers only need the fields that drive badge logic
// ---------------------------------------------------------------------------

export type DealDocumentBadgeModel = {
  checklist_key?: string | null;
  finalized_at?: string | null;
  artifact_status?: string | null;
  artifact_error?: string | null;
};

export type BadgeTone = "green" | "amber" | "gray" | "blue" | "red";

export type BadgeResult = {
  label: string;
  tone: BadgeTone;
  hoverText?: string;
};

// ---------------------------------------------------------------------------
// Tailwind class map (used by the production component)
// ---------------------------------------------------------------------------

export const TONE_CLS: Record<BadgeTone, string> = {
  green: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  amber: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  gray: "bg-white/10 text-white/50 border-white/10",
  blue: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  red: "bg-red-500/20 text-red-300 border-red-500/30",
};

// ---------------------------------------------------------------------------
// Checklist badge — 3 states
// ---------------------------------------------------------------------------

export function getChecklistBadge(doc: DealDocumentBadgeModel): BadgeResult {
  if (doc.checklist_key) {
    return {
      label: `Matched: ${doc.checklist_key.replace(/_/g, " ")}`,
      tone: "green",
    };
  }
  if (doc.finalized_at) {
    return { label: "Classified, not matched", tone: "amber" };
  }
  return { label: "Pending classification", tone: "gray" };
}

// ---------------------------------------------------------------------------
// Pipeline badge — artifact processing status
// ---------------------------------------------------------------------------

const PIPELINE_MAP: Record<string, { label: string; tone: BadgeTone }> = {
  matched: { label: "Complete", tone: "green" },
  extracted: { label: "Complete", tone: "green" },
  classified: { label: "Classified", tone: "blue" },
  processing: { label: "Processing", tone: "blue" },
  queued: { label: "Queued", tone: "gray" },
  failed: { label: "Failed", tone: "red" },
};

export function getPipelineBadge(doc: DealDocumentBadgeModel): BadgeResult {
  const s = doc.artifact_status;
  if (!s) return { label: "Unknown", tone: "gray" };

  const entry = PIPELINE_MAP[s];
  if (!entry) return { label: "Unknown", tone: "gray" };

  const result: BadgeResult = { label: entry.label, tone: entry.tone };

  if (s === "failed" && doc.artifact_error) {
    result.hoverText = doc.artifact_error;
  }

  return result;
}
