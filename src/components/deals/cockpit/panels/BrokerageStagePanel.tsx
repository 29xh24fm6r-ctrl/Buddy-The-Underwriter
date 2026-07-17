"use client";

import { useEffect, useState } from "react";
import { brokerageColors as c } from "@/components/brokerage/tokens";

type CandidateTransition = { toStage: string; canAdvance: boolean; missingRequirements: string[] };
type Task = { id: string; title: string; category: string; status: string; blocking: boolean; due_at: string | null };
type NextAction = { actionType: string; title: string; why: string; blocking: boolean; sourceRule: string };

type Workspace = {
  deal: { id: string; name: string; brokerageStage: string; stageEnteredAt: string | null; stageAgeDays: number | null };
  candidateTransitions: CandidateTransition[];
  tasks: Task[];
  nextActions: NextAction[];
};

/**
 * Deal execution panel — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR3 §5.6.
 *
 * Self-contained (fetches its own data), mounted inside the existing
 * DealCockpitClient rather than a second, duplicate cockpit page — per the
 * spec's own "Do not build a separate duplicate cockpit" instruction.
 */
export function BrokerageStagePanel({ dealId }: { dealId: string }) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toStage, setToStage] = useState("");
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/brokerage/deals/${dealId}/execution`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        // 404 here just means this isn't a brokerage-pipeline deal yet — not an error worth surfacing.
        setWs(null);
        setError(null);
        return;
      }
      setWs({ deal: json.deal, candidateTransitions: json.candidateTransitions, tasks: json.tasks, nextActions: json.nextActions });
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function doTransition() {
    if (!toStage) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/brokerage/deals/${dealId}/execution/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "transition_stage", toStage, reason: reason || undefined, override }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "transition failed");
      setToStage("");
      setReason("");
      setOverride(false);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "transition failed");
    } finally {
      setBusy(false);
    }
  }

  async function quickAddTask() {
    if (!newTaskTitle.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/brokerage/deals/${dealId}/execution/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_task", title: newTaskTitle.trim(), category: "other" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "create task failed");
      setNewTaskTitle("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "create task failed");
    } finally {
      setBusy(false);
    }
  }

  async function completeTask(taskId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/brokerage/deals/${dealId}/execution/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_task", taskId, status: "completed" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "complete task failed");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "complete task failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !ws) return null;

  const openTasks = ws.tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const selectedCandidate = ws.candidateTransitions.find((ct) => ct.toStage === toStage);

  return (
    <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.03)", padding: 16, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 700, fontSize: 15, color: c.paper }}>
          Brokerage Pipeline
        </div>
        <div style={{ fontSize: 11, color: c.textMuted }}>
          Stage: <strong style={{ color: c.brassBright }}>{ws.deal.brokerageStage.replace(/_/g, " ")}</strong>
          {ws.deal.stageAgeDays != null && ` · ${ws.deal.stageAgeDays}d in stage`}
        </div>
      </div>

      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 11.5, padding: 10, borderRadius: 6, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        {/* Next actions */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: c.textSecondary, marginBottom: 6 }}>Next actions</div>
          {ws.nextActions.length === 0 ? (
            <div style={{ fontSize: 11, color: c.textMuted }}>None outstanding.</div>
          ) : (
            ws.nextActions.slice(0, 6).map((a, i) => (
              <div key={i} style={{ fontSize: 11, color: c.paper, padding: "5px 0", borderBottom: `1px solid rgba(255,255,255,.05)` }}>
                {a.blocking && <span style={{ color: c.brick }}>● </span>}
                {a.title}
              </div>
            ))
          )}
        </div>

        {/* Tasks */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: c.textSecondary, marginBottom: 6 }}>Open tasks ({openTasks.length})</div>
          {openTasks.slice(0, 6).map((t) => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: c.paper, padding: "5px 0", borderBottom: `1px solid rgba(255,255,255,.05)` }}>
              <span>{t.blocking ? "● " : ""}{t.title}</span>
              <button onClick={() => completeTask(t.id)} disabled={busy} style={{ background: "transparent", border: "none", color: c.textMuted, fontSize: 10, cursor: "pointer" }}>
                done
              </button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
            <input
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Quick add task…"
              style={{ flex: 1, background: "rgba(0,0,0,.2)", border: `1px solid rgba(255,255,255,.08)`, borderRadius: 4, padding: "4px 6px", color: c.paper, fontSize: 10.5 }}
            />
            <button onClick={quickAddTask} disabled={busy || !newTaskTitle.trim()} style={{ background: "rgba(255,255,255,.06)", border: "none", borderRadius: 4, color: c.paper, fontSize: 10.5, padding: "4px 8px", cursor: "pointer" }}>
              +
            </button>
          </div>
        </div>

        {/* Stage move */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: c.textSecondary, marginBottom: 6 }}>Move stage</div>
          <select
            value={toStage}
            onChange={(e) => setToStage(e.target.value)}
            style={{ width: "100%", background: "rgba(0,0,0,.2)", border: `1px solid rgba(255,255,255,.08)`, borderRadius: 4, padding: "5px 6px", color: c.paper, fontSize: 10.5 }}
          >
            <option value="">Select stage…</option>
            {ws.candidateTransitions.map((ct) => (
              <option key={ct.toStage} value={ct.toStage}>
                {ct.toStage.replace(/_/g, " ")}{!ct.canAdvance ? " (blocked)" : ""}
              </option>
            ))}
          </select>
          {selectedCandidate && !selectedCandidate.canAdvance && (
            <div style={{ fontSize: 10, color: c.brick, marginTop: 4 }}>
              {selectedCandidate.missingRequirements.join("; ")}
            </div>
          )}
          {selectedCandidate && !selectedCandidate.canAdvance && (
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: c.textMuted, marginTop: 4 }}>
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Override (requires bank_admin/super_admin + reason)
            </label>
          )}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required for override / hold / decline)"
            style={{ width: "100%", marginTop: 4, background: "rgba(0,0,0,.2)", border: `1px solid rgba(255,255,255,.08)`, borderRadius: 4, padding: "5px 6px", color: c.paper, fontSize: 10.5 }}
          />
          <button
            onClick={doTransition}
            disabled={busy || !toStage}
            style={{ marginTop: 6, width: "100%", background: "rgba(184,144,91,.15)", border: `1px solid rgba(184,144,91,.4)`, borderRadius: 4, color: c.brassBright, fontSize: 11, fontWeight: 600, padding: "6px", cursor: "pointer", opacity: busy ? 0.5 : 1 }}
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
