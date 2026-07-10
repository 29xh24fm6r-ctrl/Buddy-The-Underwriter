"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { brokerageColors as c } from "@/components/brokerage/tokens";

type Organization = {
  id: string;
  name: string;
  organization_type: string;
  city: string | null;
  state: string | null;
  peopleCount: number;
};

const GRID = "1.6fr 1fr 1.4fr 90px 120px";

const TYPE_LABELS: Record<string, string> = {
  referral_source: "Referral source",
  professional_partner: "Professional partner",
  other: "Other",
};

function inputStyle(): CSSProperties {
  return {
    background: c.ink,
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    padding: "8px 10px",
    color: c.paper,
    fontSize: 12,
    fontFamily: "var(--font-brokerage-sans)",
    width: "100%",
  };
}

export default function BrokerageCrmPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState("referral_source");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/organizations");
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setOrgs(json.organizations ?? []);
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

  async function createOrg() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, organizationType: type, city: city || null, state: state || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "create failed");
      setName("");
      setCity("");
      setState("");
      setShowForm(false);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <button
          onClick={() => setShowForm((s) => !s)}
          style={{
            background: `linear-gradient(150deg, ${c.brassBright}, ${c.brass})`,
            color: c.brassOnBrass,
            border: "none",
            borderRadius: 6,
            padding: "9px 15px",
            fontWeight: 600,
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          {showForm ? "Cancel" : "+ Add organization"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1fr 1fr", gap: 10 }}>
            <input style={inputStyle()} placeholder="Organization name" value={name} onChange={(e) => setName(e.target.value)} />
            <select style={inputStyle()} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="referral_source">Referral source</option>
              <option value="professional_partner">Professional partner</option>
              <option value="other">Other</option>
            </select>
            <input style={inputStyle()} placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
            <input style={inputStyle()} placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <button
            onClick={createOrg}
            disabled={saving || !name.trim()}
            style={{
              marginTop: 12,
              background: c.borderStrong,
              color: c.paper,
              border: `1px solid ${c.borderStronger}`,
              borderRadius: 6,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              opacity: saving || !name.trim() ? 0.4 : 1,
            }}
          >
            {saving ? "Saving…" : "Save organization"}
          </button>
        </div>
      )}

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            padding: "9px 16px",
            borderBottom: `1px solid ${c.borderStrong}`,
            background: c.inkHeader,
            fontFamily: "var(--font-brokerage-mono)",
            fontSize: 9.5,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: c.textFaint,
          }}
        >
          <div>Organization</div>
          <div>Type</div>
          <div>Location</div>
          <div style={{ textAlign: "right" }}>Contacts</div>
          <div style={{ textAlign: "right" }}>Added</div>
        </div>

        {loading ? (
          <div style={{ padding: "54px 20px", textAlign: "center", color: c.textMuted, fontSize: 12 }}>Loading…</div>
        ) : orgs.length === 0 ? (
          <div style={{ padding: "54px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 30, opacity: 0.35, marginBottom: 8 }}>◇</div>
            <div style={{ fontFamily: "var(--font-brokerage-display)", fontSize: 16, color: "#C9C3B6", marginBottom: 4 }}>
              No referral sources yet
            </div>
            <div style={{ fontSize: 12, color: c.textMuted }}>Add the CPAs, attorneys, and brokers who send you deals.</div>
          </div>
        ) : (
          orgs.map((o) => (
            <Link
              key={o.id}
              href={`/admin/brokerage/crm/${o.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                padding: "12px 16px",
                borderBottom: `1px solid ${c.divider}`,
                alignItems: "center",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, color: c.paper }}>{o.name}</div>
              <div style={{ fontSize: 11.5, color: c.textSecondary }}>{TYPE_LABELS[o.organization_type] ?? o.organization_type}</div>
              <div style={{ fontSize: 11.5, color: "#C9C3B6" }}>{[o.city, o.state].filter(Boolean).join(", ") || "—"}</div>
              <div style={{ textAlign: "right", fontFamily: "var(--font-brokerage-mono)", fontSize: 12.5, color: c.brassBright }}>
                {o.peopleCount}
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: c.textMuted, fontFamily: "var(--font-brokerage-mono)" }}>—</div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
