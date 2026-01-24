"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

type DealEvent = {
  id: string;
  kind: string;
  created_at: string;
  meta?: Record<string, unknown>;
};

type Props = {
  dealId: string;
  limit?: number;
};

/**
 * Get icon for an event kind.
 */
function getEventIcon(kind: string): string {
  // Document events
  if (kind.includes("doc.uploaded") || kind.includes("upload")) return "upload_file";
  if (kind.includes("doc.classified") || kind.includes("classification")) return "category";
  if (kind.includes("checklist.satisfied")) return "checklist";
  if (kind.includes("checklist")) return "fact_check";

  // Lifecycle events
  if (kind.includes("lifecycle_advanced") || kind.includes("lifecycle.advanced")) return "arrow_forward";
  if (kind.includes("created")) return "add_circle";
  if (kind.includes("ignited")) return "rocket_launch";

  // Financial events
  if (kind.includes("snapshot")) return "account_balance";
  if (kind.includes("pricing")) return "attach_money";

  // Decision events
  if (kind.includes("decision")) return "gavel";
  if (kind.includes("committee")) return "groups";
  if (kind.includes("packet")) return "folder";
  if (kind.includes("attestation")) return "verified_user";

  // Communication events
  if (kind.includes("reminder") || kind.includes("sms") || kind.includes("email")) return "send";
  if (kind.includes("borrower")) return "person";

  // Default
  return "event";
}

/**
 * Get color for an event kind.
 */
function getEventColor(kind: string): string {
  if (kind.includes("error") || kind.includes("failed")) {
    return "text-red-400 bg-red-500/10";
  }
  if (kind.includes("lifecycle_advanced") || kind.includes("lifecycle.advanced")) {
    return "text-emerald-400 bg-emerald-500/10";
  }
  if (kind.includes("satisfied") || kind.includes("complete")) {
    return "text-emerald-400 bg-emerald-500/10";
  }
  if (kind.includes("decision") || kind.includes("committee")) {
    return "text-purple-400 bg-purple-500/10";
  }
  if (kind.includes("upload") || kind.includes("doc")) {
    return "text-sky-400 bg-sky-500/10";
  }
  return "text-white/60 bg-white/5";
}

/**
 * Format event kind to human-readable text.
 */
function formatEventKind(kind: string, meta?: Record<string, unknown>): string {
  // Handle lifecycle advancement
  if (kind.includes("lifecycle_advanced") || kind.includes("lifecycle.advanced")) {
    const from = meta?.from as string;
    const to = meta?.to as string;
    if (from && to) {
      return `Advanced: ${formatStage(from)} → ${formatStage(to)}`;
    }
    return "Lifecycle advanced";
  }

  // Handle document events
  if (kind.includes("doc.uploaded") || kind.includes("upload.received")) {
    const filename = meta?.filename || meta?.file_name || meta?.documentName;
    if (filename) {
      return `Document uploaded: ${filename}`;
    }
    return "Document uploaded";
  }

  if (kind.includes("doc.classified") || kind.includes("classification.complete")) {
    const docType = meta?.document_type || meta?.classified_as || meta?.type;
    if (docType) {
      return `Document classified as ${docType}`;
    }
    return "Document classified";
  }

  if (kind.includes("checklist.satisfied")) {
    return "All required documents received";
  }

  if (kind.includes("checklist.seeded")) {
    return "Checklist created";
  }

  // Handle snapshot events
  if (kind.includes("snapshot.created") || kind.includes("financial_snapshot")) {
    return "Financial snapshot generated";
  }

  // Handle deal events
  if (kind.includes("deal.created")) {
    return "Deal created";
  }

  if (kind.includes("deal.ignited") || kind.includes("ignited")) {
    const source = meta?.source as string;
    if (source === "banker_invite") return "Intake started (borrower invited)";
    if (source === "banker_upload") return "Intake started (banker upload)";
    return "Intake started";
  }

  // Handle committee events
  if (kind.includes("committee.packet.generated")) {
    return "Committee packet generated";
  }

  if (kind.includes("committee.decision")) {
    const decision = meta?.decision as string;
    if (decision) {
      return `Committee decision: ${decision}`;
    }
    return "Committee decision recorded";
  }

  // Handle reminder events
  if (kind.includes("reminder.sent")) {
    return "Reminder sent to borrower";
  }

  // Default: clean up the kind string
  return kind
    .replace(/^deal\./, "")
    .replace(/\./g, " ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Format stage name to human-readable text.
 */
function formatStage(stage: string): string {
  const labels: Record<string, string> = {
    intake_created: "Created",
    docs_requested: "Docs Requested",
    docs_in_progress: "Collecting",
    docs_satisfied: "Docs Complete",
    underwrite_ready: "Ready for UW",
    underwrite_in_progress: "Underwriting",
    committee_ready: "Ready for Committee",
    committee_decisioned: "Decisioned",
    closing_in_progress: "Closing",
    closed: "Closed",
    workout: "Workout",
  };
  return labels[stage] || stage;
}

/**
 * Format timestamp to relative time.
 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function DealStoryTimeline({ dealId, limit = 10 }: Props) {
  const [events, setEvents] = useState<DealEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    async function fetchEvents() {
      try {
        const res = await fetch(`/api/deals/${dealId}/events?limit=${limit}`);
        if (!res.ok) {
          throw new Error("Failed to fetch events");
        }
        const data = await res.json();
        if (data.ok) {
          setEvents(data.events || []);
        } else {
          setError(data.error || "Failed to load events");
        }
      } catch (e) {
        console.error("[DealStoryTimeline] Fetch error:", e);
        setError("Failed to load timeline");
      } finally {
        setIsLoading(false);
      }
    }

    fetchEvents();
  }, [dealId, limit]);

  // Filter and prioritize important events
  const displayEvents = events
    .filter((e) => {
      // Filter out noisy events
      if (e.kind.includes("ping") || e.kind.includes("heartbeat")) return false;
      return true;
    })
    .slice(0, isExpanded ? events.length : 5);

  if (isLoading) {
    return (
      <div className={cn(glassPanel, "overflow-hidden")}>
        <div className={glassHeader}>
          <span className="text-xs font-bold uppercase tracking-widest text-white/50">Deal Story</span>
        </div>
        <div className="p-4 text-center text-white/40 text-sm">
          Loading timeline...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn(glassPanel, "overflow-hidden")}>
        <div className={glassHeader}>
          <span className="text-xs font-bold uppercase tracking-widest text-white/50">Deal Story</span>
        </div>
        <div className="p-4 text-center text-white/40 text-sm">
          {error}
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className={cn(glassPanel, "overflow-hidden")}>
        <div className={glassHeader}>
          <span className="text-xs font-bold uppercase tracking-widest text-white/50">Deal Story</span>
        </div>
        <div className="p-4 text-center text-white/40 text-sm">
          No events yet
        </div>
      </div>
    );
  }

  return (
    <div className={cn(glassPanel, "overflow-hidden")}>
      <div className={glassHeader}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-white/50">Deal Story</span>
          <span className="text-[10px] text-white/30">{events.length} events</span>
        </div>
      </div>

      <div className="p-4">
        <div className="space-y-3">
          {displayEvents.map((event, idx) => {
            const isLast = idx === displayEvents.length - 1;
            const colorClass = getEventColor(event.kind);

            return (
              <div key={event.id} className="flex gap-3">
                {/* Timeline line */}
                <div className="flex flex-col items-center">
                  <div className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full",
                    colorClass
                  )}>
                    <span className="material-symbols-outlined text-[14px]">
                      {getEventIcon(event.kind)}
                    </span>
                  </div>
                  {!isLast && (
                    <div className="w-px flex-1 bg-white/10 mt-1" />
                  )}
                </div>

                {/* Event content */}
                <div className="flex-1 pb-3">
                  <p className="text-sm text-white/80">
                    {formatEventKind(event.kind, event.meta)}
                  </p>
                  <p className="text-[10px] text-white/40 mt-0.5">
                    {formatRelativeTime(event.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Expand/Collapse */}
        {events.length > 5 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="mt-3 w-full text-center text-xs text-white/40 hover:text-white/60 transition-colors"
          >
            {isExpanded ? "Show less" : `Show ${events.length - 5} more events`}
          </button>
        )}
      </div>
    </div>
  );
}
