"use client";

import * as React from "react";

type LoanReq = {
  id: string;
  product_type: string;
  requested_amount: number | null;
  requested_term_months: number | null;
  purpose: string | null;
  created_at: string;
};

const PRODUCTS = [
  { value: "SBA_7A", label: "SBA 7(a)" },
  { value: "SBA_504", label: "SBA 504" },
  { value: "CRE_TERM", label: "Commercial Real Estate Term" },
  { value: "C_AND_I_TERM", label: "C&I Term" },
  { value: "LINE_OF_CREDIT", label: "Line of Credit" },
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "REFINANCE", label: "Refinance" },
  { value: "OTHER", label: "Other" },
];

export function BorrowerLoanRequests(props: { dealId: string; token: string }) {
  const [rows, setRows] = React.useState<LoanReq[]>([]);
  const [productType, setProductType] = React.useState("SBA_7A");
  const [amount, setAmount] = React.useState<string>("");
  const [term, setTerm] = React.useState<string>("");
  const [purpose, setPurpose] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function load() {
    const res = await fetch(`/api/portal/deals/${props.dealId}/loan-requests`, {
      headers: { authorization: `Bearer ${props.token}` },
    });
    const json = await res.json();
    if (!json?.ok) {
      setError(json?.error ?? "Failed to load loan requests");
      return;
    }
    setRows(json.loanRequests ?? []);
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dealId]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/deals/${props.dealId}/loan-requests`, {
        method: "POST",
        headers: { 
          "content-type": "application/json",
          authorization: `Bearer ${props.token}`,
        },
        body: JSON.stringify({
          product_type: productType,
          requested_amount: amount ? Number(amount) : null,
          requested_term_months: term ? Number(term) : null,
          purpose: purpose.trim() ? purpose.trim() : null,
        }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Save failed");
      setAmount("");
      setTerm("");
      setPurpose("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-semibold">Loan request</div>
        <div className="text-xs text-gray-500">Tell us what you're looking for</div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <div>
          <div className="text-xs text-gray-600">Product</div>
          <select
            className="mt-1 h-10 w-full rounded-md border px-2 text-sm"
            value={productType}
            onChange={(e) => setProductType(e.target.value)}
            disabled={saving}
          >
            {PRODUCTS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="text-xs text-gray-600">Amount (optional)</div>
          <input
            className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 750000"
            disabled={saving}
          />
        </div>

        <div>
          <div className="text-xs text-gray-600">Term months (optional)</div>
          <input
            className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="e.g. 120"
            disabled={saving}
          />
        </div>
      </div>

      <div className="mt-2">
        <div className="text-xs text-gray-600">Purpose (optional)</div>
        <input
          className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="Purchase building, refinance debt, working capital…"
          disabled={saving}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Add request"}
        </button>

        <div className="text-xs text-gray-500">
          You can add multiple requests (example: SBA 7(a) + Line of Credit).
        </div>
      </div>

      {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}

      <div className="mt-4">
        <div className="text-sm font-semibold">Submitted</div>
        <div className="mt-2 space-y-2">
          {rows.length ? (
            rows.map((r) => (
              <div key={r.id} className="rounded-lg border p-3">
                <div className="text-sm font-medium">{r.product_type}</div>
                <div className="mt-1 text-xs text-gray-600">
                  {r.requested_amount ? `Amount: ${r.requested_amount}` : "Amount: —"} •{" "}
                  {r.requested_term_months ? `Term: ${r.requested_term_months} mo` : "Term: —"}
                </div>
                {r.purpose ? <div className="mt-1 text-sm text-gray-700">{r.purpose}</div> : null}
              </div>
            ))
          ) : (
            <div className="text-sm text-gray-600">No requests yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
