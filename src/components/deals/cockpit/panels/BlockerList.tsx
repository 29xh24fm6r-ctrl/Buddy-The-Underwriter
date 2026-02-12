"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { LifecycleBlocker } from "@/buddy/lifecycle/model";
import { getBlockerFixAction } from "@/buddy/lifecycle/nextAction";

const BLOCKER_ICONS: Record<string, string> = {
  missing_required_docs: "folder_off",
  checklist_not_seeded: "playlist_add",
  financial_snapshot_missing: "monitoring",
  committee_packet_missing: "description",
  decision_missing: "gavel",
  attestation_missing: "verified",
  closing_docs_missing: "folder_open",
  loan_request_missing: "request_page",
  loan_request_incomplete: "edit_note",
  ai_pipeline_incomplete: "smart_toy",
  spreads_incomplete: "table_chart",
  pricing_assumptions_required: "tune",
  structural_pricing_missing: "payments",
  pricing_quote_missing: "request_quote",
  risk_pricing_not_finalized: "price_check",
  deal_not_found: "error",
  internal_error: "warning",
};

/** Convert checklist key to human-readable label */
function formatChecklistKey(key: string): string {
  // Grouped consecutive-year keys (canonical)
  if (key === "IRS_PERSONAL_3Y") return "Personal Tax Returns (3 consecutive years)";
  if (key === "IRS_BUSINESS_3Y") return "Business Tax Returns (3 consecutive years)";
  if (key === "IRS_PERSONAL_2Y") return "Personal Tax Returns (2 years)";
  if (key === "IRS_BUSINESS_2Y") return "Business Tax Returns (2 years)";

  // Individual year tax returns (legacy): IRS_PERSONAL_2024 → "2024 Personal Tax Return"
  const personalYearMatch = key.match(/^IRS_PERSONAL_(\d{4})$/);
  if (personalYearMatch) return `${personalYearMatch[1]} Personal Tax Return`;

  const businessYearMatch = key.match(/^IRS_BUSINESS_(\d{4})$/);
  if (businessYearMatch) return `${businessYearMatch[1]} Business Tax Return`;

  // Default: replace underscores with spaces
  return key.replace(/_/g, " ");
}

type Props = {
  blockers: LifecycleBlocker[];
  dealId: string;
  onServerAction?: (action: string) => void;
  busyAction?: string | null;
};

export function BlockerList({ blockers, dealId, onServerAction, busyAction }: Props) {
  const router = useRouter();

  if (blockers.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-white/50 uppercase tracking-wider">
        Blockers ({blockers.length})
      </div>
      {blockers.map((blocker, idx) => {
        const fix = getBlockerFixAction(blocker, dealId);
        const icon = BLOCKER_ICONS[blocker.code] || "block";
        const isFetchError = blocker.code.endsWith("_fetch_failed") || blocker.code === "internal_error" || blocker.code === "data_fetch_failed";

        return (
          <div
            key={`${blocker.code}-${idx}`}
            className={cn(
              "rounded-lg border px-3 py-2.5",
              isFetchError
                ? "border-white/10 bg-white/[0.02]"
                : "border-amber-500/20 bg-amber-500/5",
            )}
          >
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  "material-symbols-outlined text-[16px] mt-0.5 shrink-0",
                  isFetchError ? "text-white/30" : "text-amber-400",
                )}
              >
                {icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className={cn("text-xs font-medium", isFetchError ? "text-white/50" : "text-white/80")}>
                  {blocker.message}
                </div>

                {/* Show missing doc keys if available */}
                {blocker.code === "missing_required_docs" && Array.isArray(blocker.evidence?.missing) ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(blocker.evidence!.missing as string[]).slice(0, 5).map((key: string) => (
                      <span
                        key={key}
                        className="inline-flex px-1.5 py-0.5 rounded bg-amber-500/10 text-[10px] text-amber-300/70"
                      >
                        {formatChecklistKey(key)}
                      </span>
                    ))}
                    {(blocker.evidence!.missing as string[]).length > 5 && (
                      <span className="text-[10px] text-white/30">
                        +{(blocker.evidence!.missing as string[]).length - 5} more
                      </span>
                    )}
                  </div>
                ) : null}
              </div>

              {/* Fix action button */}
              {fix && (
                <div className="flex items-center gap-1 shrink-0">
                  {fix.secondary && onServerAction && (
                    <button
                      onClick={() => onServerAction(fix.secondary!.action)}
                      className="px-2 py-1 rounded text-[10px] font-medium text-white/50 hover:text-white/70 border border-white/10 hover:border-white/20 transition-colors"
                    >
                      {fix.secondary.label}
                    </button>
                  )}
                  {fix.action ? (
                    <button
                      onClick={() => onServerAction?.(fix.action!)}
                      disabled={busyAction === fix.action}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors",
                        busyAction === fix.action
                          ? "opacity-60 cursor-wait"
                          : "",
                        isFetchError
                          ? "text-white/50 hover:text-white/70 border border-white/10 hover:border-white/20"
                          : "bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 border border-amber-500/30",
                      )}
                    >
                      {busyAction === fix.action ? "Generating\u2026" : fix.label}
                    </button>
                  ) : (
                    <Link
                      href={fix.href!}
                      onClick={(e) => {
                        try {
                          // If targeting documents section on current page, scroll instead
                          if (fix.href!.includes("focus=documents")) {
                            const el = document.getElementById("cockpit-documents");
                            if (el) {
                              e.preventDefault();
                              el.scrollIntoView({ behavior: "smooth", block: "nearest" });
                              return;
                            }
                          }
                          // For tab-based navigation on same cockpit page, let Link handle it
                          // but also scroll to the tabs panel after navigation
                          if (fix.href!.includes("?tab=")) {
                            requestAnimationFrame(() => {
                              try {
                                document.getElementById("secondary-tabs-panel")
                                  ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                              } catch { /* DOM node may be unmounted */ }
                            });
                          }
                        } catch { /* guard against parentNode null during React unmount */ }
                      }}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors",
                        isFetchError
                          ? "text-white/50 hover:text-white/70 border border-white/10 hover:border-white/20"
                          : "bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 border border-amber-500/30",
                      )}
                    >
                      {fix.label}
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
