"use client";

import { useEffect, useState } from "react";

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

const STATUS_COLOR: Record<string, string> = {
  draft: "text-neutral-400",
  finalized: "text-amber-400",
  paid: "text-emerald-400",
  void: "text-red-400",
};

function money(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
}

export default function BrokerageBillingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Draft form state
  const [lenderBankId, setLenderBankId] = useState("");
  const [description, setDescription] = useState("Referral fee");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
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
        setLenders(
          (lenderJson.lenders ?? []).map((l: any) => ({ id: l.bankId, name: l.name, code: l.code })),
        );
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

  async function createDraft() {
    const amt = Number(amount);
    if (!lenderBankId || !Number.isFinite(amt) || amt <= 0) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/brokerage/billing/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lenderBankId,
          memo: memo || null,
          lineItems: [{ description, amount: amt }],
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "create failed");
      setAmount("");
      setMemo("");
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
      const res = await fetch(`/api/admin/brokerage/billing/invoices/${id}/finalize`, {
        method: "POST",
      });
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
    <main className="px-8 py-10 max-w-5xl mx-auto text-neutral-100">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Billing — Lender invoices</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Invoice lenders for referral fees on funded deals. Draft → Finalize
          (assigns the invoice number) → record payment when the bank pays.
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-700 bg-red-900/30 text-red-200 text-sm p-4 mb-6">
          {error}
        </div>
      )}

      <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4 mb-8">
        <div className="text-xs uppercase tracking-wide text-neutral-400 mb-3">
          New draft invoice
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <select
            className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm"
            value={lenderBankId}
            onChange={(e) => setLenderBankId(e.target.value)}
          >
            <option value="">Select lender…</option>
            {lenders.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <input
            className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm"
            placeholder="Line item description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <input
            className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm"
            placeholder="Amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <input
            className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm"
            placeholder="Memo (optional)"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
        <button
          onClick={createDraft}
          disabled={creating || !lenderBankId || !amount}
          className="mt-3 rounded bg-white text-black text-sm font-medium px-4 py-2 disabled:opacity-40"
        >
          {creating ? "Creating…" : "Create draft"}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-neutral-500">Loading…</div>
      ) : invoices.length === 0 ? (
        <div className="text-sm text-neutral-500">No invoices yet.</div>
      ) : (
        <div className="grid gap-3">
          {invoices.map((inv) => {
            const remaining = inv.amount - inv.amount_paid;
            return (
              <div
                key={inv.id}
                className="rounded-md border border-neutral-800 bg-neutral-900 p-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {inv.invoice_number ?? "(draft — no number yet)"}
                    </div>
                    <div className="text-xs text-neutral-500 mt-1">
                      {inv.lender?.name ?? "Unknown lender"} · {money(inv.amount)}
                      {inv.amount_paid > 0 && ` · ${money(inv.amount_paid)} paid`}
                      {inv.memo && ` · ${inv.memo}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs uppercase tracking-wide ${STATUS_COLOR[inv.status] ?? ""}`}>
                      {inv.status}
                    </span>
                    {inv.status === "draft" && (
                      <button
                        onClick={() => finalize(inv.id)}
                        disabled={busyId === inv.id}
                        className="rounded border border-neutral-700 text-sm px-3 py-1.5 hover:border-neutral-500 disabled:opacity-40"
                      >
                        Finalize
                      </button>
                    )}
                    {inv.status === "finalized" && remaining > 0 && (
                      <button
                        onClick={() => recordFullPayment(inv)}
                        disabled={busyId === inv.id}
                        className="rounded border border-neutral-700 text-sm px-3 py-1.5 hover:border-neutral-500 disabled:opacity-40"
                      >
                        Mark paid ({money(remaining)})
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
