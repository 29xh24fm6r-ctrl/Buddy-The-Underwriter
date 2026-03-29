"use client";

import { useCockpitStateContext } from "@/hooks/useCockpitState";
import type { CockpitStateRequirement } from "@/hooks/useCockpitState";

// ─── Approved status chip vocabulary ──────────────────────────────────────────
// Kill list: "Validated" is BANNED. "Needs Review" alongside "Validated" is BANNED.

type StatusChip =
  | "Uploaded"
  | "Classified"
  | "Matched"
  | "Review Required"
  | "Confirmed"
  | "Satisfied"
  | "Waived"
  | "Unmatched"
  | "Rejected"
  | "Missing";

function deriveStatusChip(req: CockpitStateRequirement): StatusChip {
  if (req.checklistStatus === "waived") return "Waived";
  if (req.checklistStatus === "satisfied") return "Satisfied";
  if (req.checklistStatus === "received") {
    if (req.readinessStatus === "warning") return "Review Required";
    return "Matched";
  }
  if (req.matchedDocumentIds.length === 0) return "Missing";
  return "Matched";
}

const CHIP_STYLES: Record<StatusChip, string> = {
  Uploaded: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Classified: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Matched: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "Review Required": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  Confirmed: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  Satisfied: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  Waived: "bg-white/10 text-white/50 border-white/10",
  Unmatched: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  Rejected: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  Missing: "bg-rose-500/20 text-rose-300 border-rose-500/30",
};

/**
 * Core Documents panel wired to cockpit-state canonical endpoint.
 * Never fetches independently. Never uses "Validated" chip.
 */
export function CanonicalCoreDocumentsPanel() {
  const { state, loading } = useCockpitStateContext();

  if (loading || !state) {
    return (
      <div className="animate-pulse space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 bg-white/5 rounded" />
        ))}
      </div>
    );
  }

  const { requirements } = state.documentState;
  const groups = new Map<string, CockpitStateRequirement[]>();
  for (const req of requirements) {
    const group = req.group || "other";
    const list = groups.get(group) ?? [];
    list.push(req);
    groups.set(group, list);
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([group, reqs]) => (
        <div key={group}>
          <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
            {group.replace(/_/g, " ")}
          </h4>
          <div className="space-y-1">
            {reqs.map((req) => {
              const chip = deriveStatusChip(req);
              return (
                <div
                  key={req.code}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-sm text-white/80">{req.label}</span>
                    {req.matchedYears.length > 0 && (
                      <span className="text-xs text-white/40 ml-2">
                        {req.matchedYears.join(" · ")}
                      </span>
                    )}
                    {req.reasons.length > 0 && chip !== "Satisfied" && chip !== "Waived" && (
                      <p className="text-xs text-white/40 mt-0.5">
                        {req.reasons[0]}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium border ${CHIP_STYLES[chip]}`}
                  >
                    {chip}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
