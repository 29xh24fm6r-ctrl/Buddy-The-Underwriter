"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { brokerageColors as c } from "@/components/brokerage/tokens";

const QUEUES: Array<{ id: string; label: string; needsActor?: boolean; needsRole?: boolean }> = [
  { id: "my_work", label: "My work", needsActor: true },
  { id: "team_work", label: "Team work", needsRole: true },
  { id: "overdue_tasks", label: "Overdue tasks" },
  { id: "deals_no_next_action", label: "Deals with no next action" },
  { id: "stalled_deals", label: "Stalled deals" },
  { id: "missing_documents", label: "Missing documents" },
  { id: "ready_for_lender_strategy", label: "Ready for lender strategy" },
  { id: "submitted_no_lender_response", label: "Submitted, no lender response" },
  { id: "outstanding_conditions", label: "Outstanding conditions" },
  { id: "closing_next_30_days", label: "Closing in next 30 days" },
  { id: "funded_awaiting_payment", label: "Funded, awaiting payment" },
];

function itemLabel(item: any): string {
  return item.title ?? item.name ?? item.id ?? JSON.stringify(item).slice(0, 60);
}

function itemDealId(item: any): string | null {
  return item.deal_id ?? item.id ?? null;
}

export default function ManagementQueuesPage() {
  const searchParams = useSearchParams();
  const requestedQueue = searchParams.get("queue");
  const [queue, setQueue] = useState(
    requestedQueue && QUEUES.some((q) => q.id === requestedQueue) ? requestedQueue : "overdue_tasks",
  );
  const [role, setRole] = useState("broker");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const active = QUEUES.find((q) => q.id === queue);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ queue });
      if (active?.needsRole) params.set("role", role);
      const res = await fetch(`/api/admin/brokerage/queues?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setItems(json.items ?? []);
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
  }, [queue, role]);

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      <Link href="/admin/brokerage/pipeline" style={{ fontSize: 11.5, color: c.textMuted, marginBottom: 14, display: "inline-block" }}>
        ← Deals pipeline
      </Link>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
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

      {active?.needsRole && (
        <div style={{ marginBottom: 14 }}>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ background: c.ink, border: `1px solid ${c.border}`, borderRadius: 5, padding: "6px 10px", color: c.paper, fontSize: 11.5 }}>
            {["broker", "underwriter", "processor", "closer"].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>Nothing in this queue.</div>
        ) : (
          items.map((item, i) => {
            const dealId = itemDealId(item);
            return (
              <div key={i} style={{ padding: "11px 16px", borderBottom: `1px solid ${c.divider}`, fontSize: 12, color: c.paper, display: "flex", justifyContent: "space-between" }}>
                <span>{itemLabel(item)}</span>
                {dealId && (
                  <Link href={`/deals/${dealId}/cockpit`} style={{ fontSize: 11, color: c.brassBright }}>
                    Open deal →
                  </Link>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
