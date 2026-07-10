"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import { RefinedStamp } from "@/components/brokerage/StatusStamp";

/**
 * Lenders — rebuilt in the ink/brass system, real data via
 * /api/admin/brokerage/lenders. Table columns/grid ported exactly from
 * the Claude Design prototype's lenders view.
 *
 * Replaces the previous server-page + LendersClient split with a single
 * client component (that older LendersClient.tsx file is now unused —
 * left in place rather than deleted, out of scope for this pass).
 */

type Lender = {
  bankId: string;
  code: string;
  name: string;
  websiteUrl: string | null;
  isSandbox: boolean;
  agreement: {
    referral_fee_bps: number | null;
    accepts_sba_7a: boolean;
    signed_by_name: string | null;
  } | null;
  programs: Array<{
    program_name: string;
    min_dscr: number | null;
    geography: string[] | null;
    asset_types: string[] | null;
    score_threshold: number | null;
  }>;
};

const GRID = "1.5fr 90px 1fr 1.1fr 78px 92px 120px";

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

export default function LendersPage() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [minDscr, setMinDscr] = useState("1.25");
  const [geography, setGeography] = useState("NATIONWIDE");
  const [scoreThreshold, setScoreThreshold] = useState("60");
  const [referralFeeBps, setReferralFeeBps] = useState("100");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brokerage/lenders");
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setLenders(json.lenders ?? []);
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

  async function addLender() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brokerage/lenders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          program: { minDscr: Number(minDscr), geography, scoreThreshold: Number(scoreThreshold) },
          agreement: { referralFeeBps: Number(referralFeeBps) },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "create failed");
      setName("");
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
          {showForm ? "Cancel" : "+ Add lender"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
            <input style={inputStyle()} placeholder="Lender name" value={name} onChange={(e) => setName(e.target.value)} />
            <input style={inputStyle()} placeholder="Min DSCR" value={minDscr} onChange={(e) => setMinDscr(e.target.value)} />
            <input style={inputStyle()} placeholder="Geography" value={geography} onChange={(e) => setGeography(e.target.value)} />
            <input style={inputStyle()} placeholder="Score threshold" value={scoreThreshold} onChange={(e) => setScoreThreshold(e.target.value)} />
            <input style={inputStyle()} placeholder="Referral fee (bps)" value={referralFeeBps} onChange={(e) => setReferralFeeBps(e.target.value)} />
          </div>
          <button
            onClick={addLender}
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
            {saving ? "Saving…" : "Save lender"}
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
          <div>Lender</div>
          <div>Min DSCR</div>
          <div>Geography</div>
          <div>Asset types</div>
          <div>Score</div>
          <div style={{ textAlign: "right" }}>Ref. fee</div>
          <div>7(a)</div>
        </div>

        {loading ? (
          <div style={{ padding: "54px 20px", textAlign: "center", color: c.textMuted, fontSize: 12 }}>Loading…</div>
        ) : lenders.length === 0 ? (
          <div style={{ padding: "54px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 30, opacity: 0.35, marginBottom: 8 }}>▤</div>
            <div style={{ fontFamily: "var(--font-brokerage-display)", fontSize: 16, color: "#C9C3B6", marginBottom: 4 }}>
              No lenders added yet
            </div>
            <div style={{ fontSize: 12, color: c.textMuted }}>Add your first lender to start matching deals.</div>
          </div>
        ) : (
          lenders.map((l) => {
            const p = l.programs[0];
            return (
              <div
                key={l.bankId}
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID,
                  padding: "12px 16px",
                  borderBottom: `1px solid ${c.divider}`,
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0, paddingRight: 12 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: c.paper }}>{l.name}</div>
                  <div style={{ fontSize: 10.5, color: c.textMuted }}>Signer · {l.agreement?.signed_by_name ?? "—"}</div>
                </div>
                <div style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 12.5, color: "#C9C3B6" }}>
                  {p?.min_dscr ?? "—"}
                </div>
                <div style={{ fontSize: 11.5, color: "#C9C3B6", paddingRight: 10 }}>
                  {(p?.geography ?? []).join(", ") || "—"}
                </div>
                <div style={{ fontSize: 11.5, color: c.textSecondary, paddingRight: 10 }}>
                  {(p?.asset_types ?? []).join(", ") || "All"}
                </div>
                <div style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 12, color: "#C9C3B6" }}>
                  {p?.score_threshold ?? "—"}
                </div>
                <div style={{ textAlign: "right", fontFamily: "var(--font-brokerage-mono)", fontSize: 12.5, color: c.brassBright, paddingRight: 12 }}>
                  {l.agreement?.referral_fee_bps != null ? `${(l.agreement.referral_fee_bps / 100).toFixed(2)}%` : "—"}
                </div>
                <div>
                  <RefinedStamp status={l.agreement?.accepts_sba_7a ? "active" : "neutral"} label={l.agreement?.accepts_sba_7a ? "7(a) yes" : "no 7(a)"} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
