"use client";

import { useEffect, useRef, useState } from "react";
import { crmColors as c } from "@/components/brokerage/tokens";
import { useCrmWorkspace } from "@/components/brokerage/CrmWorkspaceFrame";
import { CrmTabs } from "@/components/brokerage/CrmTabs";

type Candidate<T> = { a: T; b: T; confidence: number; reasons: string[] };

function personLabel(p: any) {
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || p.id;
}

export default function CrmDedupPage() {
  const workspace = useCrmWorkspace();
  const lock = useRef(false);
  const [tab, setTab] = useState<"people" | "organizations">("people");
  const [candidates, setCandidates] = useState<Array<Candidate<any>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/dedup?type=${tab}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setCandidates(json.candidates ?? []);
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
  }, [tab]);

  async function merge(sourceId: string, targetId: string) {
    if (lock.current) return;
    const pair = candidates.find(c => [c.a.id, c.b.id].includes(sourceId));
    const survivor = pair && (pair.a.id === targetId ? pair.a : pair.b);
    if (!window.confirm(`Keep ${survivor ? label(survivor) : "the selected record"} and merge the other record into it? Review both records first. This changes their connections; the source remains in merge history.`)) return;
    lock.current = true;
    setMerging(sourceId);
    try {
      const res = await fetch("/api/admin/brokerage/crm/dedup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: tab === "people" ? "person" : "organization", sourceId, targetId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "merge failed");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "merge failed");
    } finally {
      lock.current = false; setMerging(null);
    }
  }

  const label = (row: any) => (tab === "people" ? personLabel(row) : row.name);

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      <CrmTabs />
      {workspace && <header className="crm-page-intro"><div><p className="crm-eyebrow">A NETWORK YOU CAN TRUST</p><h1>Duplicate review</h1><p>Compare the evidence. Choose the record to keep. You stay in control.</p></div></header>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["people", "organizations"] as const).map((t) => (
          <button
            key={t}
            disabled={!!merging} onClick={() => setTab(t)}
            style={{
              fontSize: 12,
              padding: "6px 12px",
              borderRadius: 5,
              border: `1px solid ${tab === t ? "rgba(184,144,91,.5)" : c.border}`,
              background: tab === t ? "rgba(184,144,91,.12)" : "transparent",
              color: tab === t ? c.brassBright : c.textSecondary,
              cursor: "pointer",
            }}
          >
            {t === "people" ? "People" : "Organizations"}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 12.5, color: c.textSecondary, marginBottom: 16 }}>
        Suggested duplicates only — nothing merges automatically. Confidence and matching reasons are shown so you can make the call.
      </div>

      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>Loading…</div>
        ) : error ? <p role="alert">Duplicate review is unavailable. <button onClick={load}>Retry</button></p> : candidates.length === 0 ? (
          <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>No likely duplicates found.</div>
        ) : (
          candidates.map((cand, i) => (
            <div className="crm-duplicate-card" key={i} style={{ padding: "13px 16px", borderBottom: `1px solid ${c.divider}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 12.5, color: c.paper }}>
                  <strong>{label(cand.a)}</strong> ↔ <strong>{label(cand.b)}</strong>
                </div>
                <span style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 10.5, color: c.brassBright }}>
                  {Math.round(cand.confidence * 100)}% confidence
                </span>
              </div>
              <div style={{ fontSize: 10.5, color: c.textMuted, marginTop: 4 }}>{cand.reasons.join(", ")}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {workspace && [cand.a,cand.b].map(row => <button key={row.id} onClick={() => workspace.openRecord({id:row.id, name:label(row), kind:tab === "people" ? "person" : "organization"})}>Review {label(row)} ↗</button>)}
                <button
                  onClick={() => merge(cand.b.id, cand.a.id)}
                  disabled={!!merging}
                  style={{ background: c.borderStrong, border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 5, padding: "5px 10px", fontSize: 11, cursor: "pointer", opacity: merging === cand.b.id ? 0.4 : 1 }}
                >
                  Merge into {label(cand.a)}
                </button>
                <button
                  onClick={() => merge(cand.a.id, cand.b.id)}
                  disabled={!!merging}
                  style={{ background: c.borderStrong, border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 5, padding: "5px 10px", fontSize: 11, cursor: "pointer", opacity: merging === cand.a.id ? 0.4 : 1 }}
                >
                  Merge into {label(cand.b)}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
