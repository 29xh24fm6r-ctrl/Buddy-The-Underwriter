"use client";

import * as React from "react";

type Listing = {
  id: string;
  score: number | null;
  band: string | null;
  published_rate_bps: number | null;
  sba_program: string | null;
  loan_amount: number | null;
  term_months: number | null;
  status: string;
  claim_closes_at: string | null;
  claimedByYou: boolean;
  kfs: Record<string, unknown> | null;
};

function money(n: number | null): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

export function LenderListingsClient() {
  const [listings, setListings] = React.useState<Listing[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/lender/marketplace/listings", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error === "not_a_lender" ? "not_a_lender" : json?.error || `HTTP ${res.status}`);
      }
      setListings((json.listings ?? []) as Listing[]);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function claim(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/lender/marketplace/listings/${id}/claim`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="p-8 text-sm text-neutral-500">Loading marketplace…</div>;

  if (err === "not_a_lender") {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">Buddy Marketplace</h1>
        <p className="mt-2 text-sm text-neutral-600">
          This account is not linked to a lender with an active marketplace agreement.
          Contact Buddy to onboard your institution.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Buddy Marketplace — open deals</h1>
        <button onClick={load} className="text-sm text-neutral-600 hover:text-neutral-900">
          Refresh
        </button>
      </div>

      {err && <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-900">{err}</div>}

      {listings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
          No open listings match your institution right now.
        </div>
      ) : (
        <ul className="space-y-3">
          {listings.map((l) => (
            <li key={l.id} className="rounded-xl border border-neutral-200 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold">
                    {l.sba_program?.toUpperCase() ?? "SBA"} · {money(l.loan_amount)} · {l.term_months ?? "—"} mo
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Buddy score {l.score ?? "—"} (band {l.band ?? "—"}) · indicative spread{" "}
                    {l.published_rate_bps != null ? `${l.published_rate_bps} bps over prime` : "—"} · claim closes{" "}
                    {l.claim_closes_at ? new Date(l.claim_closes_at).toLocaleString() : "—"}
                  </div>
                </div>
                <div className="shrink-0">
                  {l.claimedByYou ? (
                    <span className="inline-flex items-center rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-800">
                      Claimed
                    </span>
                  ) : (
                    <button
                      onClick={() => claim(l.id)}
                      disabled={busyId === l.id}
                      className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                    >
                      {busyId === l.id ? "Claiming…" : "Claim"}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
