"use client";

import * as React from "react";
import Link from "next/link";
import { PortalChatCard } from "@/components/deals/PortalChatCard";
import { PortalReceiptsCard } from "@/components/deals/PortalReceiptsCard";
import { BorrowerPortalControls } from "@/components/deals/BorrowerPortalControls";

type RequestRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

function fmtDateShort(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function isDueSoon(iso?: string | null) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const ms = d.getTime() - Date.now();
  return ms > 0 && ms <= 7 * 24 * 60 * 60 * 1000;
}

function statusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "accepted" || s === "complete" || s === "submitted") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (s === "uploaded" || s === "received") {
    return "bg-blue-50 text-blue-700 border-blue-200";
  }
  if (s === "rejected") {
    return "bg-red-50 text-red-700 border-red-200";
  }
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function missingLike(status: string) {
  const s = (status || "").toLowerCase();
  return s === "requested" || s === "missing" || s === "rejected";
}

function needsReviewLike(status: string) {
  const s = (status || "").toLowerCase();
  return s === "uploaded" || s === "received";
}

export default function DealPortalInboxClient({
  dealId,
  bankerUserId,
}: {
  dealId: string;
  bankerUserId: string;
}) {
  const [requests, setRequests] = React.useState<RequestRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<"all" | "due" | "missing" | "review">("all");

  const [portalUrl, setPortalUrl] = React.useState<string | null>(null);
  const [creatingLink, setCreatingLink] = React.useState(false);
  const [copyStatus, setCopyStatus] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/portal/requests`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      const list = (json.requests ?? []) as RequestRow[];
      setRequests(list);
      if (!activeId && list.length) setActiveId(list[0].id);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load portal requests");
    } finally {
      setLoading(false);
    }
  }, [dealId, activeId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!copyStatus) return;
    const t = window.setTimeout(() => setCopyStatus(null), 2500);
    return () => window.clearTimeout(t);
  }, [copyStatus]);

  const filtered = React.useMemo(() => {
    const list = [...requests];
    if (filter === "due") return list.filter((r) => isDueSoon(r.due_at) && !missingLike(r.status));
    if (filter === "missing") return list.filter((r) => missingLike(r.status));
    if (filter === "review") return list.filter((r) => needsReviewLike(r.status));
    return list;
  }, [requests, filter]);

  const active = React.useMemo(
    () => requests.find((r) => r.id === activeId) ?? null,
    [requests, activeId],
  );

  async function createPortalLink() {
    setCreatingLink(true);
    try {
      const res = await fetch("/api/portal/create-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deal_id: dealId, label: "Borrower portal" }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setPortalUrl(json.portal_url as string);
      try {
        await navigator.clipboard.writeText(json.portal_url as string);
        setCopyStatus("Copied portal link");
      } catch {
        setCopyStatus("Portal link created");
      }
    } catch (e: any) {
      setCopyStatus(e?.message ?? "Failed to create portal link");
    } finally {
      setCreatingLink(false);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Borrower Portal Inbox</h1>
          <p className="mt-1 text-sm text-white/70">Track document requests and borrower activity.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={createPortalLink}
            disabled={creatingLink}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {creatingLink ? "Creating…" : "Create + Copy Portal Link"}
          </button>
          {portalUrl ? (
            <Link
              href={portalUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
            >
              Open Portal
            </Link>
          ) : null}
        </div>
      </div>

      {copyStatus ? <div className="mt-3 text-xs text-white/70">{copyStatus}</div> : null}
      {error ? <div className="mt-3 text-sm text-red-300">{error}</div> : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        {/* Left: request list */}
        <aside className="lg:col-span-3">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="flex flex-wrap gap-2">
              <button
                className={`rounded-full px-3 py-1.5 text-xs font-medium border ${
                  filter === "all" ? "bg-blue-600 text-white border-blue-500" : "bg-white/5 text-white/80 border-white/10 hover:bg-white/10"
                }`}
                onClick={() => setFilter("all")}
              >
                All
              </button>
              <button
                className={`rounded-full px-3 py-1.5 text-xs font-medium border ${
                  filter === "due" ? "bg-blue-600 text-white border-blue-500" : "bg-white/5 text-white/80 border-white/10 hover:bg-white/10"
                }`}
                onClick={() => setFilter("due")}
              >
                Due Soon
              </button>
              <button
                className={`rounded-full px-3 py-1.5 text-xs font-medium border ${
                  filter === "missing" ? "bg-blue-600 text-white border-blue-500" : "bg-white/5 text-white/80 border-white/10 hover:bg-white/10"
                }`}
                onClick={() => setFilter("missing")}
              >
                Missing
              </button>
              <button
                className={`rounded-full px-3 py-1.5 text-xs font-medium border ${
                  filter === "review" ? "bg-blue-600 text-white border-blue-500" : "bg-white/5 text-white/80 border-white/10 hover:bg-white/10"
                }`}
                onClick={() => setFilter("review")}
              >
                Needs Review
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {loading ? (
                <div className="text-sm text-white/60">Loading…</div>
              ) : filtered.length ? (
                filtered.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setActiveId(r.id)}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      r.id === activeId
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{r.title}</div>
                        <div className="mt-1 text-xs text-white/60">
                          {r.category ?? "Uncategorized"} • Due {fmtDateShort(r.due_at)}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadge(r.status)}`}>
                        {r.status || "requested"}
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-sm text-white/60">No requests</div>
              )}
            </div>
          </div>
        </aside>

        {/* Center: selected request */}
        <section className="lg:col-span-6">
          <div className="rounded-xl border border-white/10 bg-black/30 p-5">
            {!active ? (
              <div className="text-sm text-white/60">Select a request to view details.</div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold text-white">{active.title}</div>
                    <div className="mt-1 text-sm text-white/70">
                      {active.category ?? "Uncategorized"} • Due {fmtDateShort(active.due_at)}
                    </div>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadge(active.status)}`}>
                    {active.status || "requested"}
                  </span>
                </div>

                {active.description ? (
                  <div className="mt-4 text-sm text-white/80 whitespace-pre-wrap">{active.description}</div>
                ) : (
                  <div className="mt-4 text-sm text-white/60">No description provided.</div>
                )}

                <div className="mt-5 rounded-lg border border-white/10 bg-black/20 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-white/60">What to do next</div>
                  <ul className="mt-2 space-y-2 text-sm text-white/80">
                    <li>Use “Create + Copy Portal Link” to share upload access.</li>
                    <li>Use chat to message borrower about this item.</li>
                    <li>Review receipts as documents arrive.</li>
                  </ul>
                </div>

                <div className="mt-5">
                  <BorrowerPortalControls dealId={dealId} />
                </div>
              </>
            )}
          </div>
        </section>

        {/* Right: chat + receipts */}
        <aside className="lg:col-span-3 space-y-4">
          <PortalChatCard dealId={dealId} bankerUserId={bankerUserId} />
          <PortalReceiptsCard dealId={dealId} bankerUserId={bankerUserId} />
        </aside>
      </div>
    </div>
  );
}
