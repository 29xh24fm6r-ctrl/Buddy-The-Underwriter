"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import { CrmTabs } from "@/components/brokerage/CrmTabs";

type Lead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  loan_amount_requested: number | null;
  status: string;
  priority: string;
  owner_clerk_user_id: string | null;
  source: string | null;
  created_at: string;
  stage_entered_at: string;
  next_action: string | null;
  next_action_due_at: string | null;
  last_attempted_contact_at: string | null;
};

const QUEUES: Array<{ id: string; label: string }> = [
  { id: "all", label: "All leads" },
  { id: "my_leads", label: "My leads" },
  { id: "unassigned", label: "Unassigned" },
  { id: "overdue_follow_up", label: "Overdue follow-up" },
  { id: "no_contact_attempted", label: "No contact attempted" },
  { id: "stale", label: "Stale" },
  { id: "qualified_not_converted", label: "Qualified, not converted" },
  { id: "nurture", label: "Nurture" },
  { id: "recently_converted", label: "Recently converted" },
  { id: "lost_and_disqualified", label: "Lost / disqualified" },
];

const KANBAN_STAGES = [
  "new",
  "attempting_contact",
  "contacted",
  "preliminary_qualification",
  "qualified",
  "engagement_pending",
  "engagement_accepted",
  "application_started",
];

function leadName(l: Lead): string {
  return l.business_name || [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || l.phone || "(unnamed lead)";
}

function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000)));
}

function pillStyle(bg: string, fg: string) {
  return { fontSize: 10, padding: "2px 7px", borderRadius: 4, background: bg, color: fg, whiteSpace: "nowrap" as const };
}

function priorityPill(priority: string) {
  const map: Record<string, [string, string]> = {
    urgent: ["rgba(168,93,82,.18)", c.brick],
    high: ["rgba(184,144,91,.18)", c.brassBright],
    medium: ["rgba(255,255,255,.06)", c.textSecondary],
    low: ["rgba(255,255,255,.04)", c.textMuted],
  };
  const [bg, fg] = map[priority] ?? map.medium;
  return <span style={pillStyle(bg, fg)}>{priority}</span>;
}

export default function CrmLeadsPage() {
  const searchParams = useSearchParams();
  const requestedQueue = searchParams.get("queue");
  const [queue, setQueue] = useState(
    requestedQueue && QUEUES.some((q) => q.id === requestedQueue) ? requestedQueue : "all",
  );
  const [view, setView] = useState<"table" | "kanban">("table");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/leads?queue=${queue}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setLeads(json.leads ?? []);
      setError(null);
      setSelected(new Set());
    } catch (e: any) {
      setError(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  function toggleSelected(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function transition(leadId: string, toStage: string, reason?: string) {
    const res = await fetch(`/api/admin/brokerage/crm/leads/${leadId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "transition_stage", toStage, reason }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error ?? "transition failed");
  }

  async function bulkClose() {
    if (selected.size === 0) return;
    const reason = window.prompt(`Disqualify ${selected.size} lead(s) — reason (required):`);
    if (!reason) return;
    try {
      await Promise.all(Array.from(selected).map((id) => transition(id, "disqualified", reason)));
      await load();
    } catch (e: any) {
      setError(e?.message ?? "bulk close failed");
    }
  }

  async function bulkNurture() {
    if (selected.size === 0) return;
    try {
      await Promise.all(Array.from(selected).map((id) => transition(id, "nurture")));
      await load();
    } catch (e: any) {
      setError(e?.message ?? "bulk nurture failed");
    }
  }

  async function bulkAssign() {
    if (selected.size === 0) return;
    const ownerId = window.prompt(`Assign ${selected.size} lead(s) to Clerk user id:`);
    if (!ownerId) return;
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/admin/brokerage/crm/leads/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ownerClerkUserId: ownerId }),
          }),
        ),
      );
      await load();
    } catch (e: any) {
      setError(e?.message ?? "bulk assign failed");
    }
  }

  async function onDrop(leadId: string, toStage: string) {
    try {
      await transition(leadId, toStage);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "stage move failed");
    }
  }

  const grouped = useMemo(() => {
    const map: Record<string, Lead[]> = {};
    for (const stage of KANBAN_STAGES) map[stage] = [];
    for (const l of leads) {
      if (map[l.status]) map[l.status].push(l);
    }
    return map;
  }, [leads]);

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      <CrmTabs />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {QUEUES.map((q) => (
            <button
              key={q.id}
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
        <div style={{ display: "flex", gap: 6 }}>
          {(["table", "kanban"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                fontSize: 11.5,
                padding: "5px 10px",
                borderRadius: 5,
                border: `1px solid ${view === v ? "rgba(184,144,91,.5)" : c.border}`,
                background: view === v ? "rgba(184,144,91,.12)" : "transparent",
                color: view === v ? c.brassBright : c.textSecondary,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {selected.size > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, fontSize: 11.5, color: c.textSecondary }}>
          <span>{selected.size} selected</span>
          <button onClick={bulkAssign} style={{ background: "transparent", border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 5, padding: "4px 9px", fontSize: 11, cursor: "pointer" }}>
            Bulk assign
          </button>
          <button onClick={bulkNurture} style={{ background: "transparent", border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 5, padding: "4px 9px", fontSize: 11, cursor: "pointer" }}>
            Bulk nurture
          </button>
          <button onClick={bulkClose} style={{ background: "transparent", border: `1px solid ${c.brick}`, color: c.brick, borderRadius: 5, padding: "4px 9px", fontSize: 11, cursor: "pointer" }}>
            Bulk disqualify
          </button>
        </div>
      )}

      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>Loading…</div>
      ) : leads.length === 0 ? (
        <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center", border: `1px solid ${c.border}`, borderRadius: 8 }}>
          No leads in this queue.
        </div>
      ) : view === "table" ? (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${c.border}`, textAlign: "left", color: c.textMuted, fontSize: 10.5 }}>
                <th style={{ padding: "9px 10px" }}></th>
                <th style={{ padding: "9px 10px" }}>Lead</th>
                <th style={{ padding: "9px 10px" }}>Requested</th>
                <th style={{ padding: "9px 10px" }}>Stage</th>
                <th style={{ padding: "9px 10px" }}>Priority</th>
                <th style={{ padding: "9px 10px" }}>Owner</th>
                <th style={{ padding: "9px 10px" }}>Age</th>
                <th style={{ padding: "9px 10px" }}>Next action</th>
                <th style={{ padding: "9px 10px" }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} style={{ borderBottom: `1px solid ${c.divider}` }}>
                  <td style={{ padding: "9px 10px" }}>
                    <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelected(l.id)} />
                  </td>
                  <td style={{ padding: "9px 10px" }}>
                    <Link href={`/admin/brokerage/crm/leads/${l.id}`} style={{ color: c.paper, textDecoration: "none" }}>
                      {leadName(l)}
                    </Link>
                    <div style={{ fontSize: 10, color: c.textMuted }}>{l.email ?? l.phone ?? "—"}</div>
                  </td>
                  <td style={{ padding: "9px 10px" }}>{l.loan_amount_requested ? `$${l.loan_amount_requested.toLocaleString()}` : "—"}</td>
                  <td style={{ padding: "9px 10px" }}>
                    <span style={pillStyle("rgba(255,255,255,.06)", c.textSecondary)}>{l.status.replace(/_/g, " ")}</span>
                  </td>
                  <td style={{ padding: "9px 10px" }}>{priorityPill(l.priority)}</td>
                  <td style={{ padding: "9px 10px", color: c.textSecondary }}>{l.owner_clerk_user_id ?? "—"}</td>
                  <td style={{ padding: "9px 10px", color: c.textSecondary }}>{ageDays(l.created_at)}d</td>
                  <td style={{ padding: "9px 10px", color: c.textSecondary }}>
                    {l.next_action ?? "—"}
                    {l.next_action_due_at && <div style={{ fontSize: 10, color: c.textMuted }}>{new Date(l.next_action_due_at).toLocaleDateString()}</div>}
                  </td>
                  <td style={{ padding: "9px 10px", color: c.textSecondary }}>{l.source ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 10 }}>
          {KANBAN_STAGES.map((stage) => (
            <div
              key={stage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const leadId = e.dataTransfer.getData("text/lead-id");
                if (leadId) onDrop(leadId, stage);
              }}
              style={{ minWidth: 220, background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 8 }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: c.textSecondary, marginBottom: 8, textTransform: "capitalize" }}>
                {stage.replace(/_/g, " ")} ({grouped[stage]?.length ?? 0})
              </div>
              {(grouped[stage] ?? []).map((l) => (
                <div
                  key={l.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/lead-id", l.id)}
                  style={{ background: "rgba(255,255,255,.03)", border: `1px solid ${c.border}`, borderRadius: 6, padding: 8, marginBottom: 6, cursor: "grab" }}
                >
                  <Link href={`/admin/brokerage/crm/leads/${l.id}`} style={{ fontSize: 11.5, color: c.paper, textDecoration: "none" }}>
                    {leadName(l)}
                  </Link>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: c.textMuted }}>{ageDays(l.created_at)}d</span>
                    {priorityPill(l.priority)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
