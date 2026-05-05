"use client";

import { StatusListPanel, useJsonFetch, type StatusRow } from "../_shared/StatusListPanel";

type PostCloseApi = {
  ok?: boolean;
  obligations?: Array<{
    id: string;
    title: string;
    obligationType?: string;
    cadence?: string | null;
    status?: string | null;
  }>;
  cycles?: Array<{
    id: string;
    title?: string;
    dueAt?: string | null;
    status?: string;
    severity?: string;
  }>;
  annualReview?: { status?: string; dueAt?: string | null } | null;
  renewalPrep?: { status?: string; prepStartAt?: string | null } | null;
};

const STATUS_TONE: Record<string, "success" | "warn" | "danger" | "info" | "neutral"> = {
  complete: "success",
  on_track: "success",
  due_soon: "info",
  overdue: "danger",
  blocked: "warn",
  pending: "info",
};

/**
 * Post-close obligations + cycle checklist surface. Pulls from
 * /api/deals/[dealId]/post-close and lists upcoming/overdue cycles.
 */
export function PostCloseChecklistPanel({ dealId }: { dealId: string }) {
  const { data, loading, error } = useJsonFetch<PostCloseApi>(
    `/api/deals/${dealId}/post-close`,
  );

  const cycles = data?.cycles ?? [];
  const overdue = cycles.filter((c) => c.status === "overdue");
  const dueSoon = cycles.filter((c) => c.status === "due_soon" || c.status === "blocked");

  const rows: StatusRow[] = cycles.slice(0, 8).map((c) => ({
    id: c.id,
    label: c.title ?? "Obligation cycle",
    detail: c.dueAt ? `Due ${new Date(c.dueAt).toLocaleDateString()}` : null,
    tone: STATUS_TONE[c.status ?? ""] ?? "neutral",
    badge: (c.status ?? "PENDING").toUpperCase().replace(/_/g, " "),
  }));

  return (
    <StatusListPanel
      testId="closing-post-close-checklist-panel"
      title="Post-Close Checklist"
      icon="event_repeat"
      badge={
        loading && !data
          ? null
          : cycles.length === 0
            ? "NONE"
            : overdue.length > 0
              ? `${overdue.length} OVERDUE`
              : dueSoon.length > 0
                ? `${dueSoon.length} DUE SOON`
                : "ON TRACK"
      }
      badgeTone={
        overdue.length > 0
          ? "danger"
          : dueSoon.length > 0
            ? "warn"
            : "success"
      }
      summary={
        loading && !data
          ? "Loading post-close obligations…"
          : cycles.length === 0
            ? "No post-close obligations defined yet."
            : `${cycles.length} cycles tracked · ${overdue.length} overdue · ${dueSoon.length} due soon.`
      }
      loading={loading}
      error={error}
      rows={rows}
      emptyMessage="No post-close obligations."
      links={[{ label: "Post-Close", href: `/deals/${dealId}/post-close` }]}
    />
  );
}
