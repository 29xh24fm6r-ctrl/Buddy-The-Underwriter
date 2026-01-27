"use client";

import { useEffect, useState, useCallback } from "react";
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
  suggestedBorrower?: {
    legal_name: string | null;
    entity_type: string | null;
    ein: string | null;
    address: string | null;
    state_of_formation: string | null;
    source_doc_id: string | null;
    confidence: number | null;
  } | null;
};

type BorrowerSearchRow = {
  id: string;
  legal_name: string | null;
  entity_type: string | null;
  ein: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
};

type ActionError = {
  code: string;
  message: string;
  correlationId: string;
};

export default function BorrowerAttachmentCard({ dealId }: { dealId: string }) {
  const [summary, setSummary] = useState<BorrowerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
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
  const [autofilling, setAutofilling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const entityTypeOptions = [
    "LLC",
    "Corp",
    "S-Corp",
    "Partnership",
    "Sole Prop",
    "Individual",
    "Unknown",
  ];

  function toFriendlyError(code: string) {
    if (code === "entity_type_required") return "Entity type is required.";
    if (code === "legal_name_required") return "Legal name is required.";
    if (code === "primary_contact_required") {
      return "Primary contact name and email are required.";
    }
    if (code === "tenant_mismatch") return "Borrower belongs to a different bank.";
    if (code === "borrower_not_found") return "Borrower not found.";
    if (code === "deal_not_found") return "Deal not found.";
    return code || "Failed to complete action.";
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower/summary`, { cache: "no-store" });
      const json = (await res.json()) as BorrowerSummary;
      if (!json?.ok) {
        throw new Error((json as any)?.error?.message ?? (json as any)?.error ?? `HTTP ${res.status}`);
      }
      setSummary(json);
    } catch (e: any) {
      setErr(e?.message || "Failed to load borrower summary");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  function handleActionError(json: any) {
    const error = json?.error;
    if (error && typeof error === "object") {
      setActionError({
        code: error.code ?? "unknown",
        message: error.message ?? "Unknown error",
        correlationId: error.correlationId ?? json?.meta?.correlationId ?? "—",
      });
    } else {
      setActionError({
        code: "unknown",
        message: typeof error === "string" ? error : "Unknown error",
        correlationId: json?.meta?.correlationId ?? "—",
      });
    }
  }

  async function copyDiagnostics() {
    if (!actionError) return;
    const text = `Error: ${actionError.code}\nMessage: ${actionError.message}\nCorrelation ID: ${actionError.correlationId}\nDeal: ${dealId}`;
    try {
      await navigator.clipboard.writeText(text);
      setToast("Diagnostics copied.");
    } catch {
      setToast("Could not copy.");
    }
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setResults([]);
    setActionError(null);
    try {
      const res = await fetch(`/api/borrowers/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const json = await res.json();
      if (!json?.ok) {
        handleActionError(json);
        return;
      }
      setResults(json.borrowers || []);
      if ((json.borrowers || []).length === 0) {
        setToast("No borrowers found.");
      }
    } catch (e: any) {
      setActionError({ code: "network_error", message: e?.message || "Search failed", correlationId: "—" });
    } finally {
      setSearching(false);
    }
  }

  async function attachBorrower(borrowerId: string) {
    setAttachingId(borrowerId);
    setActionError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower/ensure`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "existing", borrowerId }),
      });
      const json = await res.json();
      if (!json?.ok) {
        handleActionError(json);
        return;
      }
      setToast(`Borrower attached. ${json.meta?.correlationId ? `(${json.meta.correlationId})` : ""}`);
      setMode("idle");
      setQuery("");
      setResults([]);
      await loadSummary();
    } catch (e: any) {
      setActionError({ code: "network_error", message: e?.message || "Failed to attach borrower", correlationId: "—" });
    } finally {
      setAttachingId(null);
    }
  }

  async function createBorrower() {
    if (!legalName.trim()) {
      setActionError({ code: "legal_name_required", message: "Legal name is required.", correlationId: "—" });
      return;
    }
    if (!entityType.trim()) {
      setActionError({ code: "entity_type_required", message: "Entity type is required.", correlationId: "—" });
      return;
    }
    if (!contactName.trim() || !contactEmail.trim()) {
      setActionError({ code: "primary_contact_required", message: "Primary contact name and email are required.", correlationId: "—" });
      return;
    }
    setCreating(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower/ensure`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "manual",
          legal_name: legalName.trim(),
          entity_type: entityType.trim() || null,
          primary_contact_name: contactName.trim() || null,
          primary_contact_email: contactEmail.trim() || null,
          ein: ein.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json?.ok) {
        handleActionError(json);
        return;
      }
      setToast(`Borrower created and attached. ${json.meta?.correlationId ? `(${json.meta.correlationId})` : ""}`);
      setMode("idle");
      setLegalName("");
      setEntityType("");
      setContactName("");
      setContactEmail("");
      setEin("");
      await loadSummary();
    } catch (e: any) {
      setActionError({ code: "network_error", message: e?.message || "Failed to create borrower", correlationId: "—" });
    } finally {
      setCreating(false);
    }
  }

  async function autofillFromDocs() {
    setAutofilling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower/ensure`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "autofill", include_owners: true }),
      });
      const json = await res.json();
      if (!json?.ok) {
        handleActionError(json);
        return;
      }
      const fieldsCount = json.fields_autofilled?.length ?? 0;
      const ownersCount = json.owners_created ?? 0;
      const warnings = json.warnings ?? [];
      let msg = json.action === "created"
        ? "Borrower created from documents."
        : `Autofilled ${fieldsCount} field${fieldsCount !== 1 ? "s" : ""}`;
      if (ownersCount > 0) msg += `, ${ownersCount} owner${ownersCount !== 1 ? "s" : ""} added`;
      msg += ".";
      if (warnings.length > 0) msg += ` (${warnings[0]})`;
      setToast(msg);
      await loadSummary();
    } catch (e: any) {
      setActionError({ code: "network_error", message: e?.message || "Autofill failed", correlationId: "—" });
    } finally {
      setAutofilling(false);
    }
  }

  const hasBorrower = Boolean(summary?.borrower);
  const suggestion = summary?.suggestedBorrower ?? null;

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

        {/* ── Action Error Region (correlationId + copy) ── */}
        {actionError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2">
            <div className="text-sm font-semibold text-rose-800">
              {toFriendlyError(actionError.code)}
            </div>
            <div className="text-xs text-rose-600">
              {actionError.message}
            </div>
            <div className="flex items-center gap-2 text-xs text-rose-500">
              <span className="font-mono">ID: {actionError.correlationId}</span>
              <button
                type="button"
                onClick={copyDiagnostics}
                className="rounded border border-rose-300 bg-white px-2 py-0.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
              >
                Copy diagnostics
              </button>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="text-xs font-semibold text-rose-500 hover:text-rose-700"
              >
                Dismiss
              </button>
            </div>
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
                <button
                  type="button"
                  onClick={autofillFromDocs}
                  disabled={autofilling}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                >
                  {autofilling ? "Auto-filling…" : "Auto-fill from Docs"}
                </button>
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
            {suggestion ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                <div className="font-semibold">Detected from uploaded documents</div>
                <div className="mt-1">
                  {suggestion.legal_name || "Unknown borrower"}
                  {suggestion.entity_type ? ` · ${suggestion.entity_type}` : ""}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLegalName(suggestion.legal_name || "");
                      setEntityType(suggestion.entity_type || "");
                      setEin(suggestion.ein || "");
                      setMode("create");
                    }}
                    className="rounded-xl border border-emerald-300 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("create");
                    }}
                    className="rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={autofillFromDocs}
                disabled={autofilling}
                className="rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {autofilling ? "Auto-filling from documents…" : "Auto-fill from Documents"}
              </button>
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
                onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
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
              onClick={() => { setMode("idle"); setActionError(null); }}
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
              <select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Select entity type</option>
                {entityTypeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
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
                onClick={() => { setMode("idle"); setActionError(null); }}
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
