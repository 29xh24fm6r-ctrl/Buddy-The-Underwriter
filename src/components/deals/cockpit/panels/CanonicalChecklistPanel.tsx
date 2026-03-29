"use client";

import { useCockpitStateContext } from "@/hooks/useCockpitState";

/**
 * Checklist panel wired to cockpit-state canonical endpoint.
 * Count = satisfied applicable required requirements ONLY.
 * Must match readiness document category count.
 */
export function CanonicalChecklistPanel() {
  const { state, loading } = useCockpitStateContext();

  if (loading || !state) {
    return <div className="animate-pulse h-32 bg-white/5 rounded" />;
  }

  const { requirements } = state.documentState;
  const applicable = requirements.filter((r) => r.required);
  const satisfied = applicable.filter(
    (r) => r.checklistStatus === "satisfied" || r.checklistStatus === "waived",
  );

  const groups = new Map<string, typeof requirements>();
  for (const req of requirements) {
    const group = req.group || "other";
    const list = groups.get(group) ?? [];
    list.push(req);
    groups.set(group, list);
  }

  return (
    <div className="space-y-4">
      {/* Header count */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/80">Checklist</h3>
        <span className="text-sm font-mono text-white/60">
          {satisfied.length}/{applicable.length} required satisfied
        </span>
      </div>

      {/* Requirement groups */}
      {Array.from(groups.entries()).map(([group, reqs]) => (
        <div key={group}>
          <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
            {group.replace(/_/g, " ")}
          </h4>
          <div className="space-y-1.5">
            {reqs.map((req) => (
              <div
                key={req.code}
                className="flex items-start gap-2 text-sm"
              >
                <span className="shrink-0 mt-0.5">
                  {req.checklistStatus === "satisfied" || req.checklistStatus === "waived" ? (
                    <span className="text-emerald-400">&#x2713;</span>
                  ) : req.checklistStatus === "missing" ? (
                    <span className="text-red-400">&#x2717;</span>
                  ) : (
                    <span className="text-amber-400">&#x25CB;</span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-white/80">{req.label}</span>
                    <span className={`text-xs ${
                      req.checklistStatus === "satisfied" ? "text-emerald-400" :
                      req.checklistStatus === "waived" ? "text-white/40" :
                      req.checklistStatus === "received" ? "text-amber-400" :
                      "text-red-400"
                    }`}>
                      {req.checklistStatus === "satisfied" ? "Satisfied" :
                       req.checklistStatus === "waived" ? "Waived" :
                       req.checklistStatus === "received" && req.readinessStatus === "warning"
                         ? "Review Required" :
                       req.checklistStatus === "received" ? "Received" :
                       "Missing"}
                    </span>
                  </div>
                  {req.matchedYears.length > 0 && (
                    <span className="text-xs text-white/40">
                      Matched: {req.matchedYears.join(" · ")}
                    </span>
                  )}
                  {req.matchedDocumentIds.length > 0 && req.checklistStatus === "received" && (
                    <span className="text-xs text-white/40">
                      {req.matchedDocumentIds.length} doc{req.matchedDocumentIds.length > 1 ? "s" : ""} awaiting confirmation
                    </span>
                  )}
                  {req.reasons.length > 0 && req.checklistStatus !== "satisfied" && (
                    <p className="text-xs text-white/30">{req.reasons[0]}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
