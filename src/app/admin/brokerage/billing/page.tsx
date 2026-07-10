"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import { RefinedStamp } from "@/components/brokerage/StatusStamp";

type Invoice = {
  id: string;
  invoice_number: string | null;
  status: string;
  payment_status: string;
  amount: number;
  amount_paid: number;
  lender: { id: string; name: string; code: string } | null;
  memo: string | null;
  created_at: string;
};

type Lender = { id: string; name: string; code: string };

const GRID = "110px 1.4fr 1fr 110px 110px 96px";

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
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

export default function BrokerageBillingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [lenderBankId, setLenderBankId] = useState("");
  const [description, setDescription] = useState("Referral fee");
  const [amount, setAmount] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [invRes, lenderRes] = await Promise.all([
        fetch("/api/admin/brokerage/billing/invoices"),
        fetch("/api/admin/brokerage/lenders"),
      ]);
      const invJson = await invRes.json();
      const lenderJson = await lenderRes.json();
      if (!invRes.ok || !invJson.ok) throw new Error(invJson.error ?? "load failed");
      setInvoices(invJson.invoices ?? []);
      if (lenderRes.ok && lenderJson.ok) {
        setLenders((lenderJson.lenders ?? []).map((l: any) => ({ id: l.bankId, name: l.name, code: l.code })));
      }
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

  const totalOutstanding = invoices
    .filter((i) => i.status !== "paid" && i.status !== "void")
    .reduce((s, i) => s + (i.amount - i.amount_paid), 0);
  const totalPaid = invoices.reduce((s, i) => s + i.amount_paid, 0);
  const draftCount = invoices.filter((i) => i.status === "draft").length;

  async function createDraft() {
    const amt = Number(amount);
    if (!lenderBankId || !Number.isFinite(amt) || amt <= 0) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/brokerage/billing/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderBankId, lineItems: [{ description, amount: amt }] }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "create failed");
      setAmount("");
      setShowForm(false);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "create failed");
    } finally {
      setCreating(false);
    }
  }

  async function finalize(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/brokerage/billing/invoices/${id}/finalize`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "finalize failed");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "finalize failed");
    } finally {
      setBusyId(null);
    }
  }

  async function recordFullPayment(inv: Invoice) {
    const remaining = inv.amount - inv.amount_paid;
    if (remaining <= 0) return;
    setBusyId(inv.id);
    try {
      const res = await fetch(`/api/admin/brokerage/billing/invoices/${inv.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: remaining, method: "manual" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "payment failed");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "payment failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: c.textSecondary, marginBottom: 7 }}>Outstanding</div>
          <div style={{ fontFamily: "var(--font-brokerage-mono)", fontWeight: 600, fontSize: 22, color: c.brassBright }}>{money(totalOutstanding)}</div>
        </div>
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: c.textSecondary, marginBottom: 7 }}>Paid to date</div>
          <div style={{ fontFamily: "var(--font-brokerage-mono)", fontWeight: 600, fontSize: 22, color: c.sage }}>{money(totalPaid)}</div>
        </div>
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: c.textSecondary, marginBottom: 7 }}>Drafts</div>
          <div style={{ fontFamily: "var(--font-brokerage-mono)", fontWeight: 600, fontSize: 22, color: c.paper }}>{draftCount}</div>
        </div>
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: c.textSecondary, marginBottom: 7 }}>Total invoices</div>
          <div style={{ fontFamily: "var(--font-brokerage-mono)", fontWeight: 600, fontSize: 22, color: c.paper }}>{invoices.length}</div>
        </div>
      </div>

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
          {showForm ? "Cancel" : "+ New draft invoice"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.4fr 1fr", gap: 10 }}>
            <select style={inputStyle()} value={lenderBankId} onChange={(e) => setLenderBankId(e.target.value)}>
              <option value="">Select lender…</option>
              {lenders.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <input style={inputStyle()} placeholder="Line item description" value={description} onChange={(e) => setDescription(e.target.value)} />
            <input style={inputStyle()} placeholder="Amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <button
            onClick={createDraft}
            disabled={creating || !lenderBankId || !amount}
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
              opacity: creating || !lenderBankId || !amount ? 0.4 : 1,
            }}
          >
            {creating ? "Creating…" : "Create draft"}
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
          <div>Invoice</div>
          <div>Lender</div>
          <div>Memo</div>
          <div style={{ textAlign: "right" }}>Amount</div>
          <div>Status</div>
          <div style={{ textAlign: "right" }}>Action</div>
        </div>

        {loading ? (
          <div style={{ padding: "54px 20px", textAlign: "center", color: c.textMuted, fontSize: 12 }}>Loading…</div>
        ) : invoices.length === 0 ? (
          <div style={{ padding: "54px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 30, opacity: 0.35, marginBottom: 8 }}>▧</div>
            <div style={{ fontFamily: "var(--font-brokerage-display)", fontSize: 16, color: "#C9C3B6", marginBottom: 4 }}>No invoices yet</div>
            <div style={{ fontSize: 12, color: c.textMuted }}>Create a draft invoice once a lender owes you a referral fee.</div>
          </div>
        ) : (
          invoices.map((inv) => {
            const remaining = inv.amount - inv.amount_paid;
            return (
              <div
                key={inv.id}
                style={{ display: "grid", gridTemplateColumns: GRID, padding: "12px 16px", borderBottom: `1px solid ${c.divider}`, alignItems: "center" }}
              >
                <div style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 11.5, color: c.brass }}>
                  {inv.invoice_number ?? "draft"}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: c.paper }}>{inv.lender?.name ?? "Unknown lender"}</div>
                <div style={{ fontSize: 11.5, color: c.textSecondary }}>{inv.memo ?? "—"}</div>
                <div style={{ textAlign: "right", fontFamily: "var(--font-brokerage-mono)", fontSize: 12.5, color: c.paper, paddingRight: 12 }}>
                  {money(inv.amount)}
                </div>
                <div>
                  <RefinedStamp status={inv.status} />
                </div>
                <div style={{ textAlign: "right" }}>
                  {inv.status === "draft" && (
                    <button
                      onClick={() => finalize(inv.id)}
                      disabled={busyId === inv.id}
                      style={{ background: "transparent", border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 5, padding: "5px 10px", fontSize: 11, cursor: "pointer", opacity: busyId === inv.id ? 0.4 : 1 }}
                    >
                      Finalize
                    </button>
                  )}
                  {inv.status === "finalized" && remaining > 0 && (
                    <button
                      onClick={() => recordFullPayment(inv)}
                      disabled={busyId === inv.id}
                      style={{ background: "transparent", border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 5, padding: "5px 10px", fontSize: 11, cursor: "pointer", opacity: busyId === inv.id ? 0.4 : 1 }}
                    >
                      Mark paid
                    </button>
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
