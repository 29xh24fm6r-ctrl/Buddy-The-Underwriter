"use client";

// Existing business debt capture — SPEC-BROKERAGE-SBA-READY-V1
// debt-schedule-wiring follow-up. Before this card, a Brokerage borrower had
// no way — conversational, Plaid-driven, or manual — to get their existing
// business debt into the system, so DSCR/global-cash-flow calculations were
// always blind to it. Brokerage has no live Plaid connection yet, so this is
// the manual-entry path; writes land in the same deal_existing_debt_schedule
// table a future Plaid auto-builder will use (see
// src/lib/financialFacts/existingDebtSchedule.ts).

import { useEffect, useState } from "react";

type LoanType = "mortgage" | "credit_card" | "auto_loan" | "sba_loan" | "mca" | "other";

const LOAN_TYPES: Array<{ value: LoanType; label: string }> = [
  { value: "mortgage", label: "Mortgage" },
  { value: "credit_card", label: "Credit card" },
  { value: "auto_loan", label: "Auto/equipment loan" },
  { value: "sba_loan", label: "Existing SBA loan" },
  { value: "mca", label: "Merchant cash advance" },
  { value: "other", label: "Other" },
];

type DebtEntry = {
  id: string;
  lender_name: string;
  loan_type: string | null;
  current_balance: number | null;
  monthly_payment: number | null;
  is_being_refinanced: boolean;
};

function formatMoney(n: number | null): string {
  return n == null ? "—" : `$${n.toLocaleString()}`;
}

export function ExistingDebtCard({ dealId }: { dealId: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<DebtEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [confirmedNoDebt, setConfirmedNoDebt] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    lenderName: "",
    loanType: "other" as LoanType,
    currentBalance: "",
    monthlyPayment: "",
    isBeingRefinanced: false,
  });

  const load = async () => {
    try {
      const res = await fetch(`/api/brokerage/deals/${dealId}/existing-debt`, {
        credentials: "include",
      });
      const json = await res.json();
      if (json?.ok) {
        setEntries(json.entries ?? []);
      }
    } catch {
      // non-fatal — card just shows whatever it last had
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const addEntry = async () => {
    if (!form.lenderName.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/brokerage/deals/${dealId}/existing-debt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          lenderName: form.lenderName.trim(),
          loanType: form.loanType,
          currentBalance: form.currentBalance ? Number(form.currentBalance) : null,
          monthlyPayment: form.monthlyPayment ? Number(form.monthlyPayment) : null,
          isBeingRefinanced: form.isBeingRefinanced,
        }),
      });
      const json = await res.json();
      if (json?.ok) {
        setForm({ lenderName: "", loanType: "other", currentBalance: "", monthlyPayment: "", isBeingRefinanced: false });
        setAdding(false);
        setConfirmedNoDebt(false);
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (id: string) => {
    try {
      await fetch(`/api/brokerage/deals/${dealId}/existing-debt?id=${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      await load();
    } catch {
      // non-fatal
    }
  };

  const confirmNoDebt = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/brokerage/deals/${dealId}/existing-debt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirmNoDebt: true }),
      });
      const json = await res.json();
      if (json?.ok) setConfirmedNoDebt(true);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-3 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        <span>
          Existing business debt
          {entries.length > 0 ? ` (${entries.length})` : confirmedNoDebt ? " (none)" : ""}
        </span>
        <span className="text-slate-400">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-500">
            List any current loans, credit lines, or merchant cash advances your business already has.
            Lenders use this to calculate your true debt coverage — leaving it out doesn&apos;t make your
            package look stronger, it just makes the numbers wrong.
          </p>

          {entries.length > 0 && (
            <div className="divide-y divide-slate-100">
              {entries.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800">
                      {e.lender_name}
                      {e.loan_type ? ` · ${LOAN_TYPES.find((t) => t.value === e.loan_type)?.label ?? e.loan_type}` : ""}
                      {e.is_being_refinanced ? " · being refinanced by this loan" : ""}
                    </div>
                    <div className="text-xs text-slate-500">
                      Balance {formatMoney(e.current_balance)} · Monthly payment {formatMoney(e.monthly_payment)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEntry(e.id)}
                    className="shrink-0 text-xs text-slate-400 hover:text-red-500"
                    aria-label={`Remove ${e.lender_name}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {adding ? (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <input
                type="text"
                placeholder="Lender name"
                value={form.lenderName}
                onChange={(e) => setForm((f) => ({ ...f, lenderName: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
              />
              <select
                value={form.loanType}
                onChange={(e) => setForm((f) => ({ ...f, loanType: e.target.value as LoanType }))}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
              >
                {LOAN_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Current balance"
                  value={form.currentBalance}
                  onChange={(e) => setForm((f) => ({ ...f, currentBalance: e.target.value }))}
                  className="w-1/2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
                />
                <input
                  type="number"
                  placeholder="Monthly payment"
                  value={form.monthlyPayment}
                  onChange={(e) => setForm((f) => ({ ...f, monthlyPayment: e.target.value }))}
                  className="w-1/2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={form.isBeingRefinanced}
                  onChange={(e) => setForm((f) => ({ ...f, isBeingRefinanced: e.target.checked }))}
                />
                This debt is being paid off by the new SBA loan
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving || !form.lenderName.trim()}
                  onClick={addEntry}
                  className="rounded-lg bg-brand-blue-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="rounded-lg border border-brand-blue-500 px-3 py-1.5 text-xs font-semibold text-brand-blue-500 hover:bg-slate-50"
              >
                + Add existing debt
              </button>
              {entries.length === 0 && !confirmedNoDebt && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={confirmNoDebt}
                  className="text-xs text-slate-400 underline hover:text-slate-600 disabled:opacity-50"
                >
                  I don&apos;t have any other business debt
                </button>
              )}
              {confirmedNoDebt && entries.length === 0 && (
                <span className="text-xs text-slate-500">Confirmed — no other business debt on file.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
