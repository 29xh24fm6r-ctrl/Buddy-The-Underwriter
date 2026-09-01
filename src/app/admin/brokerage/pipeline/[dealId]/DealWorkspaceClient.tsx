"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import { STAGE_LABELS } from "@/lib/dealStage/board";
import { ExistingDebtCard } from "@/components/brokerage/ExistingDebtCard";
import type { BrokerageTeamMember } from "@/lib/brokerage/team";

/**
 * The deal's brokerage workspace: who owns it, what stage it is in, what is
 * on someone's list, and which banks have it.
 *
 * Every endpoint here already existed and had no caller:
 *   PATCH …/execution                     assign an owner
 *   POST  …/execution/actions             transition_stage / create_task / update_task
 *   POST  …/crm/organizations/buyers      record a bank distribution
 *   GET   …/brokerage/deals/:id/existing-debt  the borrower's current debt
 * The one new endpoint is GET …/crm/deals/:id/lender-matches, which ranks
 * banks against this deal so the shortlist is chosen rather than remembered.
 */

type Task = {
  id: string;
  title: string;
  category: string;
  status: string;
  priority: string;
  blocking: boolean;
  due_at: string | null;
  assigned_to_clerk_user_id: string | null;
};

type Transition = { toStage: string; canAdvance: boolean; missingRequirements: string[] };

type Match = {
  lenderProfileId: string;
  organizationId: string;
  name: string;
  eligible: boolean;
  score: number;
  reasons: string[];
  disqualifiers: string[];
  warnings: string[];
  alreadySent: boolean;
  history: { sent: number; responded: number; approved: number; avgDaysToRespond: number | null } | null;
};

type Submission = {
  id: string;
  deal_id: string;
  lender_profile_id: string;
  status: string;
  sent_at: string | null;
  next_follow_up_at: string | null;
  decline_reason: string | null;
  lender?: { name?: string | null } | null;
};

const BUYERS_ENDPOINT = "/api/admin/brokerage/crm/organizations/buyers";
const STATUS_LABELS: Record<string, string> = {
  planned: "Planned", sent: "Sent", reviewing: "Reviewing", interested: "Interested",
  term_sheet: "Term sheet", approved: "Approved", declined: "Declined",
  withdrawn: "Withdrawn", lost: "Lost", closed: "Closed",
};

const control: React.CSSProperties = {
  background: c.inkHeader,
  border: `1px solid ${c.border}`,
  borderRadius: 5,
  padding: "8px 10px",
  color: c.paper,
  fontSize: 12,
};

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "11px 15px", borderBottom: `1px solid ${c.border}` }}>
        <strong style={{ color: c.paper, fontSize: 13 }}>{title}</strong>
        {action}
      </header>
      <div style={{ padding: 15 }}>{children}</div>
    </section>
  );
}

function inThreeDays(): string {
  return new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 16);
}

export default function DealWorkspaceClient({
  dealId,
  team,
  currentUserId,
}: {
  dealId: string;
  team: BrokerageTeamMember[];
  currentUserId: string | null;
}) {
  const [owner, setOwner] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [stageAgeDays, setStageAgeDays] = useState<number | null>(null);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [followUpAt, setFollowUpAt] = useState(inThreeDays());
  const [showIneligible, setShowIneligible] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", assignedToClerkUserId: "", dueAt: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const nameById = useMemo(() => Object.fromEntries(team.map((m) => [m.clerkUserId, m.name])), [team]);

  const load = useCallback(async () => {
    const [execRes, matchRes, buyersRes] = await Promise.all([
      fetch(`/api/admin/brokerage/deals/${dealId}/execution`, { cache: "no-store" }),
      fetch(`/api/admin/brokerage/crm/deals/${dealId}/lender-matches`, { cache: "no-store" }),
      fetch(BUYERS_ENDPOINT, { cache: "no-store" }),
    ]);

    if (execRes.ok && execRes.status !== 204) {
      const json = await execRes.json();
      if (json.ok) {
        setOwner(json.deal.stageOwnerClerkUserId ?? null);
        setStage(json.deal.brokerageStage ?? null);
        setStageAgeDays(json.deal.stageAgeDays ?? null);
        setTransitions(json.candidateTransitions ?? []);
        setTasks(json.tasks ?? []);
      }
    }
    if (matchRes.ok) {
      const json = await matchRes.json();
      if (json.ok) setMatches(json.matches ?? []);
    }
    if (buyersRes.ok) {
      const json = await buyersRes.json();
      if (json.ok) setSubmissions((json.submissions ?? []).filter((s: Submission) => s.deal_id === dealId));
    }
  }, [dealId]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  async function post(url: string, body: unknown, method: "POST" | "PATCH" = "POST") {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error ?? "That did not save.");
    return json;
  }

  async function run(work: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await work();
      if (message) setNotice(message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const eligible = matches.filter((m) => m.eligible);
  const ineligible = matches.filter((m) => !m.eligible);
  const shortlist = showIneligible ? matches : eligible;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {error && <div role="alert" style={{ border: `1px solid ${c.brick}`, color: c.brick, borderRadius: 6, padding: 11, fontSize: 12 }}>{error}</div>}
      {notice && <div role="status" style={{ border: `1px solid ${c.sage}`, color: c.sage, borderRadius: 6, padding: 11, fontSize: 12 }}>{notice}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        <Panel title="Ownership and stage">
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, color: c.textSecondary, fontSize: 11.5 }}>
              Owner
              <select
                style={control}
                value={owner ?? ""}
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.value || null;
                  void run(async () => {
                    await post(`/api/admin/brokerage/deals/${dealId}/execution`, { ownerClerkUserId: value }, "PATCH");
                    return value ? `Assigned to ${nameById[value] ?? "teammate"}.` : "Owner cleared.";
                  });
                }}
              >
                <option value="">Unassigned</option>
                {team.map((m) => <option key={m.clerkUserId} value={m.clerkUserId}>{m.name}</option>)}
              </select>
            </label>

            <div style={{ fontSize: 12, color: c.textSecondary }}>
              Stage: <strong style={{ color: c.paper }}>{STAGE_LABELS[stage ?? ""] ?? "Unstaged"}</strong>
              {stageAgeDays !== null && <span style={{ color: c.textMuted }}> · {stageAgeDays}d here</span>}
            </div>

            {transitions.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ color: c.textMuted, fontSize: 10.5 }}>Move to</span>
                {transitions.map((t) => (
                  <button
                    key={t.toStage}
                    type="button"
                    disabled={busy}
                    title={t.canAdvance ? undefined : `Blocked: ${t.missingRequirements.join(", ")}`}
                    onClick={() =>
                      run(async () => {
                        await post(`/api/admin/brokerage/deals/${dealId}/execution/actions`, {
                          action: "transition_stage",
                          toStage: t.toStage,
                        });
                        return `Moved to ${STAGE_LABELS[t.toStage] ?? t.toStage}.`;
                      })
                    }
                    style={{
                      ...control,
                      textAlign: "left",
                      cursor: busy ? "wait" : "pointer",
                      opacity: t.canAdvance ? 1 : 0.5,
                      borderColor: t.canAdvance ? c.border : "rgba(199,127,115,.4)",
                    }}
                  >
                    {STAGE_LABELS[t.toStage] ?? t.toStage}
                    {!t.canAdvance && (
                      <span style={{ color: c.brick, fontSize: 10.5 }}> · {t.missingRequirements[0] ?? "gate not met"}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel title={`Tasks (${tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled").length} open)`}>
          <div style={{ display: "grid", gap: 10 }}>
            {tasks.length === 0 ? (
              <p style={{ margin: 0, color: c.textMuted, fontSize: 12 }}>Nothing on anyone&apos;s list for this deal yet.</p>
            ) : (
              tasks.map((task) => (
                <div key={task.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", paddingBottom: 8, borderBottom: `1px solid ${c.divider}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: c.paper, fontSize: 12, textDecoration: task.status === "completed" ? "line-through" : "none" }}>{task.title}</div>
                    <div style={{ color: c.textMuted, fontSize: 10.5 }}>
                      {task.assigned_to_clerk_user_id ? (nameById[task.assigned_to_clerk_user_id] ?? "Assigned") : "Unassigned"}
                      {task.due_at ? ` · due ${new Date(task.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                    </div>
                  </div>
                  {task.status !== "completed" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await post(`/api/admin/brokerage/deals/${dealId}/execution/actions`, {
                            action: "update_task", taskId: task.id, status: "completed",
                          });
                          return "Task completed.";
                        })
                      }
                      style={{ ...control, padding: "4px 9px", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                    >
                      Done
                    </button>
                  )}
                </div>
              ))
            )}

            <div style={{ display: "grid", gap: 7, paddingTop: 4 }}>
              <input
                aria-label="New task"
                placeholder="Add a task…"
                value={newTask.title}
                onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                style={control}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 7 }}>
                <select
                  aria-label="Assign the task"
                  value={newTask.assignedToClerkUserId}
                  onChange={(e) => setNewTask({ ...newTask, assignedToClerkUserId: e.target.value })}
                  style={control}
                >
                  <option value="">{currentUserId ? "Assign to me" : "Unassigned"}</option>
                  {team.map((m) => <option key={m.clerkUserId} value={m.clerkUserId}>{m.name}</option>)}
                </select>
                <input
                  aria-label="Task due date"
                  type="date"
                  value={newTask.dueAt}
                  onChange={(e) => setNewTask({ ...newTask, dueAt: e.target.value })}
                  style={control}
                />
                <button
                  type="button"
                  disabled={busy || !newTask.title.trim()}
                  onClick={() =>
                    run(async () => {
                      await post(`/api/admin/brokerage/deals/${dealId}/execution/actions`, {
                        action: "create_task",
                        title: newTask.title.trim(),
                        category: "internal_review",
                        assignedToClerkUserId: newTask.assignedToClerkUserId || currentUserId,
                        dueAt: newTask.dueAt ? new Date(`${newTask.dueAt}T17:00:00`).toISOString() : null,
                      });
                      setNewTask({ title: "", assignedToClerkUserId: "", dueAt: "" });
                      return "Task added.";
                    })
                  }
                  style={{ ...control, background: c.brass, color: c.brassOnBrass, border: "none", fontWeight: 700, cursor: "pointer", opacity: newTask.title.trim() ? 1 : 0.5 }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        title="Send to banks"
        action={
          <span style={{ color: c.textMuted, fontSize: 11 }}>
            {eligible.length} of {matches.length} bank{matches.length === 1 ? "" : "s"} fit this deal
          </span>
        }
      >
        {matches.length === 0 ? (
          <p style={{ margin: 0, color: c.textMuted, fontSize: 12 }}>
            No bank relationships yet. Add one under CRM → Bank buyers and its appetite will be matched here.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 7 }}>
              {shortlist.map((match) => (
                <label
                  key={match.lenderProfileId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 11,
                    alignItems: "start",
                    padding: "10px 12px",
                    border: `1px solid ${selected.has(match.lenderProfileId) ? c.brass : c.border}`,
                    borderRadius: 6,
                    background: selected.has(match.lenderProfileId) ? "rgba(184,144,91,.07)" : "transparent",
                    cursor: match.eligible ? "pointer" : "default",
                    opacity: match.eligible ? 1 : 0.65,
                  }}
                >
                  <input
                    type="checkbox"
                    disabled={!match.eligible || match.alreadySent}
                    checked={selected.has(match.lenderProfileId)}
                    onChange={() => toggle(match.lenderProfileId)}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", color: c.paper, fontSize: 12.5, fontWeight: 600 }}>{match.name}</span>
                    <span style={{ display: "block", color: c.textSecondary, fontSize: 11, marginTop: 2 }}>
                      {match.eligible ? match.reasons.join(" · ") || "No stated appetite" : match.disqualifiers.join(" · ")}
                    </span>
                    {match.warnings.length > 0 && (
                      <span style={{ display: "block", color: c.brassBright, fontSize: 10.5, marginTop: 2 }}>{match.warnings.join(" · ")}</span>
                    )}
                  </span>
                  <span style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 12, color: match.eligible ? c.sage : c.brick, whiteSpace: "nowrap" }}>
                    {match.eligible ? match.score : "ruled out"}
                  </span>
                </label>
              ))}
            </div>

            {ineligible.length > 0 && (
              <button
                type="button"
                onClick={() => setShowIneligible((v) => !v)}
                style={{ ...control, justifySelf: "start", cursor: "pointer", color: c.textSecondary }}
              >
                {showIneligible ? "Hide" : `Show ${ineligible.length}`} ruled out
              </button>
            )}

            <div style={{ display: "flex", gap: 9, alignItems: "end", flexWrap: "wrap" }}>
              <label style={{ display: "grid", gap: 5, color: c.textMuted, fontSize: 10.5 }}>
                Follow up on
                <input type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} style={control} />
              </label>
              <button
                type="button"
                disabled={busy || selected.size === 0}
                onClick={() =>
                  run(async () => {
                    const rationales = Object.fromEntries(
                      matches
                        .filter((m) => selected.has(m.lenderProfileId))
                        .map((m) => [m.lenderProfileId, m.reasons.join(" · ")]),
                    );
                    const json = await post(BUYERS_ENDPOINT, {
                      action: "create_submissions",
                      dealId,
                      lenderProfileIds: Array.from(selected),
                      status: "sent",
                      nextFollowUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
                      fitRationales: rationales,
                    });
                    const count = json.submissions?.length ?? 0;
                    const skipped = json.skipped?.length ?? 0;
                    setSelected(new Set());
                    return `Recorded ${count} bank${count === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}. Follow-up tasks created.`;
                  })
                }
                style={{
                  ...control,
                  background: c.brass,
                  color: c.brassOnBrass,
                  border: "none",
                  fontWeight: 700,
                  cursor: selected.size ? "pointer" : "default",
                  opacity: selected.size ? 1 : 0.45,
                }}
              >
                Send to {selected.size || "…"} bank{selected.size === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}
      </Panel>

      <Panel title={`Banks that have this deal (${submissions.length})`}>
        {submissions.length === 0 ? (
          <p style={{ margin: 0, color: c.textMuted, fontSize: 12 }}>Nothing sent yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {submissions.map((s) => (
              <div key={s.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 120px 150px", gap: 11, alignItems: "center", paddingBottom: 8, borderBottom: `1px solid ${c.divider}` }}>
                <div>
                  <div style={{ color: c.paper, fontSize: 12 }}>{s.lender?.name ?? "Unknown bank"}</div>
                  <div style={{ color: c.textMuted, fontSize: 10.5 }}>
                    {s.sent_at ? `Sent ${new Date(s.sent_at).toLocaleDateString("en-US")}` : "Not sent"}
                    {s.decline_reason ? ` · ${s.decline_reason}` : ""}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: s.next_follow_up_at && new Date(s.next_follow_up_at) < new Date() ? c.brick : c.textMuted,
                  }}
                >
                  {s.next_follow_up_at ? new Date(s.next_follow_up_at).toLocaleDateString("en-US") : "No follow-up"}
                </div>
                <select
                  aria-label={`Status for ${s.lender?.name ?? "bank"}`}
                  value={s.status}
                  disabled={busy}
                  onChange={(e) => {
                    const status = e.target.value;
                    const payload: Record<string, unknown> = { id: s.id, status };
                    if (status === "declined") {
                      const reason = window.prompt("Why did the bank decline?");
                      if (!reason) return;
                      payload.declineReason = reason;
                    }
                    if (status === "lost") {
                      const reason = window.prompt("Why was this lost?");
                      if (!reason) return;
                      payload.lostReason = reason;
                    }
                    if (status === "closed") {
                      const amount = window.prompt("Final closed amount");
                      if (!amount) return;
                      payload.closedAmount = Number(amount);
                      payload.closedAt = new Date().toISOString();
                    }
                    void run(async () => {
                      await post(BUYERS_ENDPOINT, payload, "PATCH");
                      return `${s.lender?.name ?? "Bank"} marked ${STATUS_LABELS[status] ?? status}.`;
                    });
                  }}
                  style={control}
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <ExistingDebtCard dealId={dealId} />
    </div>
  );
}
