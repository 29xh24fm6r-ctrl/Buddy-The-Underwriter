"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type BorrowerSummary = {
  ok: boolean;
  borrower: {
    id: string;
    legal_name: string | null;
    entity_type: string | null;
    ein: string | null;
    primary_contact_name: string | null;
    primary_contact_email: string | null;
  } | null;
  principals: Array<{ id: string; name: string | null }>;
  dealBorrowerName: string | null;
};

type BorrowerSearchRow = {
  id: string;
  legal_name: string | null;
  entity_type: string | null;
  ein: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
};

export default function BorrowerAttachmentCard({ dealId }: { dealId: string }) {
  const [summary, setSummary] = useState<BorrowerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "search" | "create">("idle");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BorrowerSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [attachingId, setAttachingId] = useState<string | null>(null);

  const [legalName, setLegalName] = useState("");
  const [entityType, setEntityType] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [ein, setEin] = useState("");
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadSummary() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower/summary`, { cache: "no-store" });
      const json = (await res.json()) as BorrowerSummary;
      if (!res.ok || !json?.ok) {
        throw new Error((json as any)?.error || `HTTP ${res.status}`);
      }
      setSummary(json);
    } catch (e: any) {
      setErr(e?.message || "Failed to load borrower summary");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setResults([]);
    setErr(null);
    try {
      const res = await fetch(`/api/borrowers/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setResults(json.borrowers || []);
      if ((json.borrowers || []).length === 0) {
        setToast("No borrowers found.");
      }
    } catch (e: any) {
      setErr(e?.message || "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function attachBorrower(borrowerId: string) {
    setAttachingId(borrowerId);
    setErr(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower/attach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ borrowerId }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setToast("Borrower attached.");
      setMode("idle");
      setQuery("");
      setResults([]);
      await loadSummary();
    } catch (e: any) {
      setErr(e?.message || "Failed to attach borrower");
    } finally {
      setAttachingId(null);
    }
  }

  async function createBorrower() {
    if (!legalName.trim()) {
      setErr("Legal name is required.");
      return;
    }
    setCreating(true);
    setErr(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          legal_name: legalName.trim(),
          entity_type: entityType.trim() || null,
          primary_contact_name: contactName.trim() || null,
          primary_contact_email: contactEmail.trim() || null,
          ein: ein.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setToast("Borrower created and attached.");
      setMode("idle");
      setLegalName("");
      setEntityType("");
      setContactName("");
      setContactEmail("");
      setEin("");
      await loadSummary();
    } catch (e: any) {
      setErr(e?.message || "Failed to create borrower");
    } finally {
      setCreating(false);
    }
  }

  const hasBorrower = Boolean(summary?.borrower);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-900">Borrower</div>
          <div className="text-sm text-slate-600">
            Attach or create the borrower entity for this deal.
          </div>
        </div>
        {toast ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {toast}
          </div>
        ) : null}
      </div>

      <div className="px-4 pb-4 space-y-4">
        {loading && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            Loading borrower status…
          </div>
        )}

        {!loading && err && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {err}
          </div>
        )}

        {!loading && !err && hasBorrower && summary?.borrower ? (
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {summary.borrower.legal_name || summary.dealBorrowerName || "Borrower"}
                </div>
                <div className="text-xs text-slate-600">
                  {summary.borrower.entity_type || "Entity type unknown"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/borrowers/${summary.borrower.id}`}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  onClick={() => setMode("search")}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Replace
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 text-xs text-slate-600 md:grid-cols-2">
              <div>
                <span className="font-semibold text-slate-700">Primary contact:</span>{" "}
                {summary.borrower.primary_contact_name || "—"}
              </div>
              <div>
                <span className="font-semibold text-slate-700">Contact email:</span>{" "}
                {summary.borrower.primary_contact_email || "—"}
              </div>
              <div>
                <span className="font-semibold text-slate-700">EIN:</span>{" "}
                {summary.borrower.ein || "—"}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-700">Principals</div>
              {summary.principals?.length ? (
                <ul className="mt-1 space-y-1 text-xs text-slate-600">
                  {summary.principals.map((p) => (
                    <li key={p.id}>{p.name || "Unnamed principal"}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-slate-500">No principals recorded yet.</div>
              )}
            </div>
          </div>
        ) : null}

        {!loading && !err && !hasBorrower ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-4 space-y-3">
            <div className="text-sm text-slate-700">
              No borrower attached yet.
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode("search")}
                className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Attach Existing Borrower
              </button>
              <button
                type="button"
                onClick={() => setMode("create")}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Create New Borrower
              </button>
            </div>
          </div>
        ) : null}

        {mode === "search" ? (
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-900">Attach existing borrower</div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, EIN, or email"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={runSearch}
                disabled={searching}
                className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {searching ? "Searching…" : "Search"}
              </button>
            </div>

            {results.length > 0 ? (
              <div className="space-y-2">
                {results.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {row.legal_name || "Unnamed borrower"}
                      </div>
                      <div className="text-xs text-slate-600">
                        {row.entity_type || "Entity type unknown"} · {row.primary_contact_email || "No email"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => attachBorrower(row.id)}
                      disabled={attachingId === row.id}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {attachingId === row.id ? "Attaching…" : "Attach"}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setMode("idle")}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        ) : null}

        {mode === "create" ? (
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-900">Create new borrower</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <input
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Legal name"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                placeholder="Entity type (LLC, Corp, Individual)"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Primary contact name"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Primary contact email"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                value={ein}
                onChange={(e) => setEin(e.target.value)}
                placeholder="EIN (optional)"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={createBorrower}
                disabled={creating}
                className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {creating ? "Creating…" : "Create & Attach"}
              </button>
              <button
                type="button"
                onClick={() => setMode("idle")}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
