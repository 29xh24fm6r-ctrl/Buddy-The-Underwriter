"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import { CrmTabs } from "@/components/brokerage/CrmTabs";

type Person = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  contact_status: "active" | "inactive" | "do_not_contact";
  organization_id: string | null;
  last_contacted_at: string | null;
};

function inputStyle() {
  return {
    background: c.ink,
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    padding: "8px 10px",
    color: c.paper,
    fontSize: 12,
    width: "100%",
  } as const;
}

export default function CrmPeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", jobTitle: "" });
  const [saving, setSaving] = useState(false);

  async function load(query?: string) {
    setLoading(true);
    try {
      const url = query ? `/api/admin/brokerage/crm/people?q=${encodeURIComponent(query)}` : "/api/admin/brokerage/crm/people";
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setPeople(json.people ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createPerson() {
    if (!form.firstName.trim() && !form.lastName.trim() && !form.email.trim()) {
      setError("A person needs at least a name or email.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName || undefined,
          lastName: form.lastName || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          jobTitle: form.jobTitle || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "create failed");
      setForm({ firstName: "", lastName: "", email: "", phone: "", jobTitle: "" });
      setShowForm(false);
      await load(q);
    } catch (e: any) {
      setError(e?.message ?? "create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      <CrmTabs />

      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <input
          style={{ ...inputStyle(), maxWidth: 320 }}
          placeholder="Search people by name or email…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            load(e.target.value);
          }}
        />
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowForm((s) => !s)}
          style={{ background: "#1B1E23", border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 6, padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          {showForm ? "Cancel" : "+ Add person"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input style={inputStyle()} placeholder="First name" value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
            <input style={inputStyle()} placeholder="Last name" value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
            <input style={inputStyle()} placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            <input style={inputStyle()} placeholder="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            <input style={inputStyle()} placeholder="Job title" value={form.jobTitle} onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))} />
          </div>
          <button
            onClick={createPerson}
            disabled={saving}
            style={{ marginTop: 10, background: "#1B1E23", border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: saving ? 0.4 : 1 }}
          >
            {saving ? "Saving…" : "Create person"}
          </button>
        </div>
      )}

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>Loading…</div>
        ) : people.length === 0 ? (
          <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>
            {q ? "No people match that search." : "No people yet. Add one, or link a person while attributing a deal or organization."}
          </div>
        ) : (
          people.map((p) => {
            const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "(unnamed)";
            return (
              <Link
                key={p.id}
                href={`/admin/brokerage/crm/people/${p.id}`}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${c.divider}`, textDecoration: "none" }}
              >
                <div>
                  <div style={{ fontSize: 12.5, color: c.paper, fontWeight: 500 }}>{name}</div>
                  <div style={{ fontSize: 10.5, color: c.textMuted, marginTop: 2 }}>
                    {p.job_title ?? "—"} · {p.email ?? "—"} · {p.phone ?? "—"}
                  </div>
                </div>
                {p.contact_status !== "active" && (
                  <span style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 10, textTransform: "uppercase", color: c.textMuted }}>
                    {p.contact_status.replace("_", " ")}
                  </span>
                )}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
