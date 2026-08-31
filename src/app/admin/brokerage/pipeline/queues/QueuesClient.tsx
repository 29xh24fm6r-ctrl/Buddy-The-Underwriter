"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import { STAGE_LABELS } from "@/lib/dealStage/board";
import type { BrokerageTeamMember } from "@/lib/brokerage/team";

/**
 * My work — what is on my desk, and (for whoever runs the desk) what is on
 * everyone else's.
 *
 * The queue endpoint has always returned real rows; this page rendered them
 * with `JSON.stringify(item).slice(0, 60)` when it could not guess a label,
 * so a queue of tasks looked like a wall of JSON. Rows are typed here
 * instead, and a task with a deal behind it can be reassigned in place
 * through the update_task action that already existed.
 */

type QueueId =
  | "my_work" | "team_work" | "overdue_tasks" | "deals_no_next_action" | "stalled_deals"
  | "missing_documents" | "ready_for_lender_strategy" | "submitted_no_lender_response"
  | "outstanding_conditions" | "closing_next_30_days" | "funded_awaiting_payment";

const QUEUES: Array<{ id: QueueId; label: string; blurb: string; needsRole?: boolean }> = [
  { id: "my_work", label: "My work", blurb: "Tasks assigned to you and still open." },
  { id: "team_work", label: "Team work", blurb: "Open tasks for one role across the desk.", needsRole: true },
  { id: "overdue_tasks", label: "Overdue", blurb: "Past their due date and still open." },
  { id: "deals_no_next_action", label: "No next action", blurb: "Open deals nobody has decided the next step for." },
  { id: "stalled_deals", label: "Stalled", blurb: "Sitting in one stage longer than it should." },
  { id: "missing_documents", label: "Missing documents", blurb: "Waiting on the borrower." },
  { id: "ready_for_lender_strategy", label: "Ready for banks", blurb: "Packaged and ready to go out." },
  { id: "submitted_no_lender_response", label: "Bank has gone quiet", blurb: "Sent, with no response recorded." },
  { id: "outstanding_conditions", label: "Open conditions", blurb: "Closing conditions still outstanding." },
  { id: "closing_next_30_days", label: "Closing soon", blurb: "Scheduled to close within 30 days." },
  { id: "funded_awaiting_payment", label: "Awaiting fee", blurb: "Funded, fee not yet collected." },
];

const control: React.CSSProperties = {
  background: c.inkHeader,
  border: `1px solid ${c.border}`,
  borderRadius: 5,
  padding: "6px 10px",
  color: c.paper,
  fontSize: 11.5,
};

type QueueItem = Record<string, any>;

function isTask(item: QueueItem): boolean {
  return typeof item.title === "string" && "status" in item && "priority" in item;
}

function dealIdOf(item: QueueItem): string | null {
  return item.deal_id ?? (isTask(item) ? null : item.id) ?? null;
}

function label(item: QueueItem): string {
  if (typeof item.title === "string" && item.title) return item.title;
  return item.display_name || item.borrower_name || item.name || "Untitled";
}

function subtitle(item: QueueItem, nameById: Record<string, string>): string {
  const parts: string[] = [];
  if (isTask(item)) {
    parts.push(item.assigned_to_clerk_user_id ? (nameById[item.assigned_to_clerk_user_id] ?? "Assigned") : "Unassigned");
    if (item.due_at) parts.push(`due ${new Date(item.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
    if (item.priority && item.priority !== "medium") parts.push(item.priority);
  } else {
    if (item.borrower_name) parts.push(item.borrower_name);
    if (item.brokerage_stage) parts.push(STAGE_LABELS[item.brokerage_stage] ?? item.brokerage_stage);
    if (item.loan_amount) parts.push("$" + Math.round(Number(item.loan_amount)).toLocaleString("en-US"));
  }
  return parts.filter(Boolean).join(" · ");
}

function isOverdue(item: QueueItem): boolean {
  return isTask(item) && !!item.due_at && new Date(item.due_at) < new Date();
}

export default function QueuesClient({ team }: { team: BrokerageTeamMember[] }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get("queue") as QueueId | null;
  const [queue, setQueue] = useState<QueueId>(
    requested && QUEUES.some((q) => q.id === requested) ? requested : "my_work",
  );
  const [role, setRole] = useState("broker");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const active = QUEUES.find((q) => q.id === queue)!;
  const nameById = useMemo(() => Object.fromEntries(team.map((m) => [m.clerkUserId, m.name])), [team]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ queue });
      if (active.needsRole) params.set("role", role);
      const res = await fetch(`/api/admin/brokerage/queues?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not load this queue.");
      setItems(json.items ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [queue, role, active.needsRole]);

  useEffect(() => { void load(); }, [load]);

  async function reassign(task: QueueItem, assignedToClerkUserId: string | null) {
    if (!task.deal_id) return;
    setBusyId(task.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/brokerage/deals/${task.deal_id}/execution/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_task", taskId: task.id, assignedToClerkUserId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Could not reassign.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function complete(task: QueueItem) {
    if (!task.deal_id) return;
    setBusyId(task.id);
    try {
      await fetch(`/api/admin/brokerage/deals/${task.deal_id}/execution/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_task", taskId: task.id, status: "completed" }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      <Link href="/admin/brokerage/pipeline" style={{ fontSize: 11.5, color: c.textMuted, textDecoration: "none" }}>← Pipeline</Link>

      <h1 style={{ margin: "14px 0 4px", color: c.paper, fontFamily: "var(--font-brokerage-display)", fontSize: 22 }}>My work</h1>
      <p style={{ margin: "0 0 16px", color: c.textMuted, fontSize: 12 }}>{active.blurb}</p>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {QUEUES.map((q) => (
          <button
            key={q.id}
            type="button"
            onClick={() => setQueue(q.id)}
            style={{
              fontSize: 11.5,
              padding: "5px 10px",
              borderRadius: 5,
              border: `1px solid ${queue === q.id ? "rgba(184,144,91,.5)" : c.border}`,
              background: queue === q.id ? "rgba(184,144,91,.12)" : "transparent",
              color: queue === q.id ? c.brassBright : c.textSecondary,
              cursor: "pointer",
            }}
          >
            {q.label}
          </button>
        ))}
      </div>

      {active.needsRole && (
        <div style={{ marginBottom: 14 }}>
          <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} style={control}>
            {["broker", "underwriter", "processor", "closer"].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      )}

      {error && (
        <div role="alert" style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        {loading ? (
          <p style={{ margin: 0, padding: 24, fontSize: 12, color: c.textMuted, textAlign: "center" }}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={{ margin: 0, padding: 30, fontSize: 12, color: c.textMuted, textAlign: "center" }}>Nothing here — that is the good outcome.</p>
        ) : (
          items.map((item, i) => {
            const dealId = dealIdOf(item);
            const task = isTask(item);
            return (
              <div
                key={item.id ?? i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) auto",
                  gap: 14,
                  alignItems: "center",
                  padding: "11px 16px",
                  borderBottom: `1px solid ${c.divider}`,
                  borderLeft: `3px solid ${isOverdue(item) ? c.brick : "transparent"}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: c.paper, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(item)}</div>
                  <div style={{ color: isOverdue(item) ? c.brick : c.textMuted, fontSize: 10.5 }}>{subtitle(item, nameById)}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                  {task && item.deal_id && (
                    <>
                      <select
                        aria-label={`Reassign ${label(item)}`}
                        value={item.assigned_to_clerk_user_id ?? ""}
                        disabled={busyId === item.id}
                        onChange={(e) => void reassign(item, e.target.value || null)}
                        style={{ ...control, fontSize: 10.5, padding: "3px 6px", maxWidth: 140 }}
                      >
                        <option value="">Unassigned</option>
                        {team.map((m) => <option key={m.clerkUserId} value={m.clerkUserId}>{m.name}</option>)}
                      </select>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void complete(item)}
                        style={{ ...control, fontSize: 10.5, padding: "3px 8px", cursor: "pointer" }}
                      >
                        Done
                      </button>
                    </>
                  )}
                  {dealId && (
                    <Link href={`/admin/brokerage/pipeline/${dealId}`} style={{ fontSize: 11, color: c.brassBright, textDecoration: "none", whiteSpace: "nowrap" }}>
                      Open →
                    </Link>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
