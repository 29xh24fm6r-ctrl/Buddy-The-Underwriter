"use client";

import * as React from "react";
import { FixAnchor } from "@/components/fixmode/FixAnchor";

type LoanReq = {
  id: string;
  deal_id: string;
  product_type: string;

  requested_amount: number | null;
  requested_term_months: number | null;
  requested_amort_months: number | null;
  requested_rate_type: "FIXED" | "VARIABLE" | null;
  requested_rate_index: string | null;
  requested_spread_bps: number | null;
  requested_interest_only_months: number | null;

  purpose: string | null;
  notes: string | null;

  created_at: string;
};

type UW = {
  id: string;
  deal_id: string;
  proposed_product_type: string;

  proposed_amount: number | null;
  proposed_term_months: number | null;
  proposed_amort_months: number | null;
  proposed_rate_type: "FIXED" | "VARIABLE" | null;
  proposed_rate_index: string | null;
  proposed_spread_bps: number | null;
  proposed_interest_only_months: number | null;

  guarantee_percent: number | null;
  ltv_target: number | null;
  dscr_target: number | null;
  global_dscr_target: number | null;
  pricing_floor_rate: number | null;

  internal_notes: string | null;

  created_at: string;
};

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function fmtNum(n: number | null) {
  if (n === null || n === undefined) return "—";
  if (Number.isNaN(Number(n))) return "—";
  return String(n);
}

export function BankerLoanProductsCard(props: { dealId: string; bankerUserId: string }) {
  const [loading, setLoading] = React.useState(true);
  const [loanRequests, setLoanRequests] = React.useState<LoanReq[]>([]);
  const [underwriteInputs, setUnderwriteInputs] = React.useState<UW[]>([]);
  const [activeUwId, setActiveUwId] = React.useState<string | null>(null);

  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  const activeUw = activeUwId ? underwriteInputs.find((u) => u.id === activeUwId) ?? null : (underwriteInputs[0] ?? null);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/banker/deals/${props.dealId}/loan-products`, {
        method: "GET",
        headers: { "x-user-id": props.bankerUserId },
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load loan products");

      setLoanRequests(json.loanRequests ?? []);
      setUnderwriteInputs(json.underwriteInputs ?? []);

      // keep selection stable if possible
      if (activeUwId && (json.underwriteInputs ?? []).some((x: UW) => x.id === activeUwId)) {
        // ok
      } else {
        setActiveUwId((json.underwriteInputs?.[0]?.id as string) ?? null);
      }
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dealId]);

  async function exportVars() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/banker/deals/${props.dealId}/underwrite/inputs?format=flat`, {
        method: "GET",
        headers: { "x-user-id": props.bankerUserId },
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Export failed");

      const ok = await copyToClipboard(JSON.stringify(json.underwrite ?? {}, null, 2));
      setToast(ok ? "Copied underwriting variables to clipboard." : "Could not copy to clipboard.");
      window.setTimeout(() => setToast(null), 1800);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function copyRequestToUnderwrite(requestId: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/banker/deals/${props.dealId}/loan-products`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": props.bankerUserId },
        body: JSON.stringify({ kind: "copy_request_to_underwrite", requestId }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to create underwrite draft");

      await load();
      const newId = json?.underwriteInput?.id as string | undefined;
      if (newId) setActiveUwId(newId);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function saveUnderwritePatch(patch: Partial<UW>) {
    if (!activeUw) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/banker/deals/${props.dealId}/loan-products`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": props.bankerUserId },
        body: JSON.stringify({
          kind: "underwrite",
          data: { ...patch, id: activeUw.id, proposed_product_type: patch.proposed_product_type ?? activeUw.proposed_product_type },
        }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Save failed");

      await load();
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="rounded-xl border bg-white p-4 text-sm text-gray-600">Loading loan products…</div>;

  return (
    <FixAnchor
      kind="banker_loan_products"
      focusMap={{
        product: 'select[data-focus="product"]',
        amount: 'input[data-focus="amount"]',
        termMonths: 'input[data-focus="termMonths"]',
      }}
    >
      <div className="rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Loan Products</div>
          <div className="text-xs text-gray-500">Borrower requests → Banker proposed structure</div>
        </div>

        <div className="flex gap-2">
          <button
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            onClick={exportVars}
            disabled={saving}
            title="Copy normalized underwriting input variables"
          >
            Export variables
          </button>

          <button
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            onClick={load}
            disabled={saving}
          >
            Refresh
          </button>
        </div>
      </div>

      {toast ? <div className="mt-3 rounded-lg border bg-gray-50 p-2 text-sm">{toast}</div> : null}
      {error ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {/* Left: borrower requests */}
        <div className="rounded-xl border p-3">
          <div className="text-sm font-semibold">Borrower Requests</div>
          <div className="mt-2 space-y-2">
            {loanRequests.length ? (
              loanRequests.map((r) => (
                <div key={r.id} className="rounded-lg border bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{r.product_type}</div>
                      <div className="mt-1 text-xs text-gray-600">
                        Amount: {fmtNum(r.requested_amount)} • Term: {fmtNum(r.requested_term_months)} mo • Amort:{" "}
                        {fmtNum(r.requested_amort_months)} mo
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        Rate: {r.requested_rate_type ?? "—"} {r.requested_rate_index ? `(${r.requested_rate_index})` : ""}{" "}
                        {r.requested_spread_bps !== null && r.requested_spread_bps !== undefined ? `+${r.requested_spread_bps} bps` : ""}
                      </div>
                      {r.purpose ? <div className="mt-2 text-sm text-gray-700">{r.purpose}</div> : null}
                      {r.notes ? <div className="mt-1 text-sm text-gray-700">{r.notes}</div> : null}
                    </div>

                    <button
                      className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => copyRequestToUnderwrite(r.id)}
                      disabled={saving}
                      title="Create banker draft from this request"
                    >
                      Create draft
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-600">No borrower requests yet.</div>
            )}
          </div>
        </div>

        {/* Right: banker underwrite inputs */}
        <div className="rounded-xl border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Proposed Structure (Banker)</div>
              <div className="text-xs text-gray-500">These fields feed underwriting models</div>
            </div>

            {underwriteInputs.length ? (
              <select
                className="h-9 rounded-md border px-2 text-sm"
                value={activeUw?.id ?? ""}
                onChange={(e) => setActiveUwId(e.target.value)}
                disabled={saving}
              >
                {underwriteInputs.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.proposed_product_type} • {new Date(u.created_at).toLocaleDateString()}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {!underwriteInputs.length ? (
            <div className="mt-3 text-sm text-gray-600">
              No banker drafts yet. Click <span className="font-medium">Create draft</span> on a borrower request.
            </div>
          ) : activeUw ? (
            <div className="mt-3 space-y-3">
              {/* Proposed terms */}
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <div className="text-xs text-gray-600">Product</div>
                  <select
                    data-focus="product"
                    className="mt-1 h-10 w-full rounded-md border px-2 text-sm"
                    value={activeUw.proposed_product_type}
                    onChange={(e) => saveUnderwritePatch({ proposed_product_type: e.target.value as any })}
                    disabled={saving}
                  >
                    {[
                      "SBA_7A",
                      "SBA_504",
                      "CRE_TERM",
                      "C_AND_I_TERM",
                      "LINE_OF_CREDIT",
                      "EQUIPMENT",
                      "REFINANCE",
                      "OTHER",
                    ].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="text-xs text-gray-600">Amount</div>
                  <input
                    data-focus="amount"
                    className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                    defaultValue={activeUw.proposed_amount ?? ""}
                    onBlur={(e) => saveUnderwritePatch({ proposed_amount: e.target.value ? Number(e.target.value) : null })}
                    disabled={saving}
                    placeholder="e.g. 750000"
                  />
                </div>

                <div>
                  <div className="text-xs text-gray-600">Term (months)</div>
                  <input
                    data-focus="termMonths"
                    className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                    defaultValue={activeUw.proposed_term_months ?? ""}
                    onBlur={(e) => saveUnderwritePatch({ proposed_term_months: e.target.value ? Number(e.target.value) : null })}
                    disabled={saving}
                    placeholder="e.g. 120"
                  />
                </div>

                <div>
                  <div className="text-xs text-gray-600">Amort (months)</div>
                  <input
                    className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                    defaultValue={activeUw.proposed_amort_months ?? ""}
                    onBlur={(e) => saveUnderwritePatch({ proposed_amort_months: e.target.value ? Number(e.target.value) : null })}
                    disabled={saving}
                    placeholder="e.g. 300"
                  />
                </div>

                <div>
                  <div className="text-xs text-gray-600">Rate type</div>
                  <select
                    className="mt-1 h-10 w-full rounded-md border px-2 text-sm"
                    value={activeUw.proposed_rate_type ?? ""}
                    onChange={(e) => saveUnderwritePatch({ proposed_rate_type: (e.target.value || null) as any })}
                    disabled={saving}
                  >
                    <option value="">—</option>
                    <option value="FIXED">FIXED</option>
                    <option value="VARIABLE">VARIABLE</option>
                  </select>
                </div>

                <div>
                  <div className="text-xs text-gray-600">Index</div>
                  <input
                    className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                    defaultValue={activeUw.proposed_rate_index ?? ""}
                    onBlur={(e) => saveUnderwritePatch({ proposed_rate_index: e.target.value.trim() ? e.target.value.trim() : null })}
                    disabled={saving}
                    placeholder="Prime / SOFR / etc"
                  />
                </div>

                <div>
                  <div className="text-xs text-gray-600">Spread (bps)</div>
                  <input
                    className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                    defaultValue={activeUw.proposed_spread_bps ?? ""}
                    onBlur={(e) => saveUnderwritePatch({ proposed_spread_bps: e.target.value ? Number(e.target.value) : null })}
                    disabled={saving}
                    placeholder="e.g. 250"
                  />
                </div>

                <div>
                  <div className="text-xs text-gray-600">Interest-only (months)</div>
                  <input
                    className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                    defaultValue={activeUw.proposed_interest_only_months ?? ""}
                    onBlur={(e) =>
                      saveUnderwritePatch({ proposed_interest_only_months: e.target.value ? Number(e.target.value) : null })
                    }
                    disabled={saving}
                    placeholder="e.g. 12"
                  />
                </div>
              </div>

              {/* Underwrite knobs */}
              <div className="rounded-lg border bg-gray-50 p-3">
                <div className="text-sm font-semibold">Underwrite Targets</div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="text-xs text-gray-600">Guarantee %</div>
                    <input
                      className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                      defaultValue={activeUw.guarantee_percent ?? ""}
                      onBlur={(e) => saveUnderwritePatch({ guarantee_percent: e.target.value ? Number(e.target.value) : null })}
                      disabled={saving}
                      placeholder="e.g. 75"
                    />
                  </div>

                  <div>
                    <div className="text-xs text-gray-600">Pricing floor rate</div>
                    <input
                      className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                      defaultValue={activeUw.pricing_floor_rate ?? ""}
                      onBlur={(e) => saveUnderwritePatch({ pricing_floor_rate: e.target.value ? Number(e.target.value) : null })}
                      disabled={saving}
                      placeholder="e.g. 8.25"
                    />
                  </div>

                  <div>
                    <div className="text-xs text-gray-600">DSCR target</div>
                    <input
                      className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                      defaultValue={activeUw.dscr_target ?? ""}
                      onBlur={(e) => saveUnderwritePatch({ dscr_target: e.target.value ? Number(e.target.value) : null })}
                      disabled={saving}
                      placeholder="e.g. 1.25"
                    />
                  </div>

                  <div>
                    <div className="text-xs text-gray-600">Global DSCR target</div>
                    <input
                      className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                      defaultValue={activeUw.global_dscr_target ?? ""}
                      onBlur={(e) => saveUnderwritePatch({ global_dscr_target: e.target.value ? Number(e.target.value) : null })}
                      disabled={saving}
                      placeholder="e.g. 1.20"
                    />
                  </div>

                  <div>
                    <div className="text-xs text-gray-600">LTV target</div>
                    <input
                      className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                      defaultValue={activeUw.ltv_target ?? ""}
                      onBlur={(e) => saveUnderwritePatch({ ltv_target: e.target.value ? Number(e.target.value) : null })}
                      disabled={saving}
                      placeholder="e.g. 80"
                    />
                  </div>

                  <div>
                    <div className="text-xs text-gray-600">Internal notes</div>
                    <input
                      className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                      defaultValue={activeUw.internal_notes ?? ""}
                      onBlur={(e) => saveUnderwritePatch({ internal_notes: e.target.value.trim() ? e.target.value.trim() : null })}
                      disabled={saving}
                      placeholder="Banker-only"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
    </FixAnchor>
  );
}
