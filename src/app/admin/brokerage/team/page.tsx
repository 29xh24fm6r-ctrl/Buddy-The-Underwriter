"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import { RefinedStamp } from "@/components/brokerage/StatusStamp";

type Member = {
  membershipId: string;
  clerkUserId: string;
  role: string;
  addedAt: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

type Candidate = {
  clerkUserId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

function displayName(p: { email: string | null; firstName: string | null; lastName: string | null }) {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  return name || p.email || "(unnamed)";
}

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

export default function BrokerageTeamPage() {
  const [team, setTeam] = useState<Member[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedUserId, setSelectedUserId] = useState("");
  const [role, setRole] = useState("bank_admin");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brokerage/team");
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setTeam(json.team ?? []);
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
  }, []);

  async function addTeammate() {
    if (!selectedUserId) return;
    setAdding(true);
    try {
      const res = await fetch("/api/admin/brokerage/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerkUserId: selectedUserId, role }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "add failed");
      setSelectedUserId("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "add failed");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div style={{ padding: "18px 24px 40px", maxWidth: 780 }}>
      <p style={{ fontSize: 12, color: c.textMuted, marginBottom: 16, lineHeight: 1.6 }}>
        Who has access to Deals, Lenders, CRM, and Billing for this tenant. A
        partner needs a Clerk account first (sign up at{" "}
        <code style={{ color: c.textSecondary }}>app.buddytheunderwriter.com</code>) —
        they'll show up below once they've signed in at least once.
      </p>

      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <div style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: c.textFaint, marginBottom: 10 }}>
          Add teammate
        </div>
        {candidates.length === 0 && !loading ? (
          <div style={{ fontSize: 12, color: c.textMuted }}>
            No signed-up accounts available to add — have your partner sign up first, then refresh this page.
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1.3fr", gap: 10 }}>
              <select style={inputStyle()} value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
                <option value="">Select a signed-up user…</option>
                {candidates.map((cand) => (
                  <option key={cand.clerkUserId} value={cand.clerkUserId}>
                    {displayName(cand)}
                    {cand.email ? ` (${cand.email})` : ""}
                  </option>
                ))}
              </select>
              <select style={inputStyle()} value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="bank_admin">Bank admin — full access</option>
                <option value="underwriter">Underwriter — works deals, no admin config</option>
              </select>
            </div>
            <button
              onClick={addTeammate}
              disabled={adding || !selectedUserId}
              style={{
                marginTop: 12,
                background: `linear-gradient(150deg, ${c.brassBright}, ${c.brass})`,
                color: c.brassOnBrass,
                border: "none",
                borderRadius: 6,
                padding: "9px 15px",
                fontWeight: 600,
                fontSize: 12.5,
                cursor: "pointer",
                opacity: adding || !selectedUserId ? 0.4 : 1,
              }}
            >
              {adding ? "Adding…" : "Add to Buddy Brokerage"}
            </button>
          </>
        )}
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 130px",
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
          <div>Team ({team.length})</div>
          <div>Access</div>
        </div>
        {loading ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: c.textMuted, fontSize: 12 }}>Loading…</div>
        ) : (
          team.map((m) => (
            <div
              key={m.membershipId}
              style={{ display: "grid", gridTemplateColumns: "1fr 130px", padding: "11px 16px", borderBottom: `1px solid ${c.divider}`, alignItems: "center" }}
            >
              <div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: c.paper }}>{displayName(m)}</span>
                {m.email && <span style={{ fontSize: 11, color: c.textMuted }}> · {m.email}</span>}
              </div>
              <div>
                <RefinedStamp
                  status={m.role === "bank_admin" ? "active" : "neutral"}
                  label={m.role === "bank_admin" ? "Bank admin" : m.role === "underwriter" ? "Underwriter" : m.role}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
