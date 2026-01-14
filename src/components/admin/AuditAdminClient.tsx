"use client";

import React, { useEffect, useMemo, useState } from "react";

type AuditEvent = {
  id: string;
  deal_id: string | null;
  actor_user_id: string | null;
  scope: string | null;
  action: string | null;
  kind: string | null;
  input_json: any;
  output_json: any;
  confidence: number | null;
  evidence_json: any;
  requires_human_review: boolean | null;
  created_at: string | null;
};

type LoadResponse =
  | { ok: true; events: AuditEvent[]; nextCursor: string | null }
  | { ok: false; error: string };

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeString(v: unknown) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function formatTs(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function AuditAdminClient() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [dealId, setDealId] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [scope, setScope] = useState("");
  const [action, setAction] = useState("");
  const [kind, setKind] = useState("");
  const [requiresHumanReview, setRequiresHumanReview] = useState<"" | "true" | "false">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => {
    return selectedId ? events.find((e) => e.id === selectedId) ?? null : null;
  }, [events, selectedId]);

  const distinct = useMemo(() => {
    const scopes = new Set<string>();
    const actions = new Set<string>();
    const kinds = new Set<string>();
    for (const e of events) {
      if (e.scope) scopes.add(e.scope);
      if (e.action) actions.add(e.action);
      if (e.kind) kinds.add(e.kind);
    }
    return {
      scopes: Array.from(scopes).sort(),
      actions: Array.from(actions).sort(),
      kinds: Array.from(kinds).sort(),
    };
  }, [events]);

  async function load(opts?: { append?: boolean; cursor?: string | null }) {
    setBusy(true);
    setError(null);
    try {
      const url = new URL("/api/admin/audit/list", window.location.origin);
      url.searchParams.set("limit", "50");
      if (opts?.cursor) url.searchParams.set("cursor", opts.cursor);
      if (q.trim()) url.searchParams.set("q", q.trim());
      if (dealId.trim()) url.searchParams.set("dealId", dealId.trim());
      if (actorUserId.trim()) url.searchParams.set("actorUserId", actorUserId.trim());
      if (scope.trim()) url.searchParams.set("scope", scope.trim());
      if (action.trim()) url.searchParams.set("action", action.trim());
      if (kind.trim()) url.searchParams.set("kind", kind.trim());
      if (requiresHumanReview) url.searchParams.set("requiresHumanReview", requiresHumanReview);

      const r = await fetch(url.toString(), { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as LoadResponse | null;
      if (!j?.ok) throw new Error(j?.error ?? `Failed to load (${r.status})`);

      setNextCursor(j.nextCursor ?? null);
      setEvents((prev) => (opts?.append ? [...prev, ...(j.events ?? [])] : j.events ?? []));

      if (!opts?.append) {
        setSelectedId((j.events?.[0]?.id as string | undefined) ?? null);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      if (!opts?.append) {
        setEvents([]);
        setSelectedId(null);
        setNextCursor(null);
      }
    } finally {
      setBusy(false);
    }
  }

  function clearFilters() {
    setQ("");
    setDealId("");
    setActorUserId("");
    setScope("");
    setAction("");
    setKind("");
    setRequiresHumanReview("");
  }

  function exportCsv() {
    const header = [
      "id",
      "created_at",
      "deal_id",
      "actor_user_id",
      "scope",
      "action",
      "kind",
      "requires_human_review",
      "confidence",
    ].join(",");

    const lines = events.map((e) =>
      [
        JSON.stringify(e.id),
        JSON.stringify(e.created_at ?? ""),
        JSON.stringify(e.deal_id ?? ""),
        JSON.stringify(e.actor_user_id ?? ""),
        JSON.stringify(e.scope ?? ""),
        JSON.stringify(e.action ?? ""),
        JSON.stringify(e.kind ?? ""),
        e.requires_human_review ? "1" : "0",
        JSON.stringify(e.confidence ?? ""),
      ].join(","),
    );

    downloadText(
      `buddy-audit-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
      [header, ...lines].join("\n"),
      "text/csv",
    );
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedInput = useMemo(() => {
    return selected ? JSON.stringify(selected.input_json ?? null, null, 2) : "";
  }, [selected]);

  const selectedOutput = useMemo(() => {
    return selected ? JSON.stringify(selected.output_json ?? null, null, 2) : "";
  }, [selected]);

  const selectedEvidence = useMemo(() => {
    return selected ? JSON.stringify(selected.evidence_json ?? null, null, 2) : "";
  }, [selected]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xl font-semibold">Audit & Compliance Ledger</div>
          <div className="text-sm text-muted-foreground">
            Canonical read source: <span className="font-mono">audit_ledger</span>. Super-admin only.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="border rounded px-3 py-1" onClick={() => load()} disabled={busy}>
            {busy ? "Loading…" : "Refresh"}
          </button>
          <button className="border rounded px-3 py-1" onClick={exportCsv} disabled={busy || events.length === 0}>
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-red-500/40 bg-red-500/10 text-red-200 rounded p-3 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-3 space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Search (deal id / actor / scope / action / kind)</label>
            <input className="w-full border rounded px-3 py-2" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Deal ID</label>
            <input
              className="w-full border rounded px-3 py-2 font-mono text-xs"
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
              placeholder="uuid"
            />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Actor user id</label>
            <input
              className="w-full border rounded px-3 py-2 font-mono text-xs"
              value={actorUserId}
              onChange={(e) => setActorUserId(e.target.value)}
              placeholder="clerk user id"
            />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Scope</label>
            <select className="w-full border rounded px-3 py-2" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">(any)</option>
              {distinct.scopes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Action</label>
            <select className="w-full border rounded px-3 py-2" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">(any)</option>
              {distinct.actions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Kind</label>
            <select className="w-full border rounded px-3 py-2" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">(any)</option>
              {distinct.kinds.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Requires human review</label>
            <select
              className="w-full border rounded px-3 py-2"
              value={requiresHumanReview}
              onChange={(e) => setRequiresHumanReview(e.target.value as any)}
            >
              <option value="">(any)</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button className="border rounded px-3 py-2 flex-1" onClick={() => load()} disabled={busy}>
              Apply
            </button>
            <button
              className="border rounded px-3 py-2"
              onClick={() => {
                clearFilters();
                setTimeout(() => void load(), 0);
              }}
              disabled={busy}
            >
              Clear
            </button>
          </div>

          <div className="text-xs text-muted-foreground border rounded p-3">
            <div>Loaded: {events.length}</div>
            <div>Next cursor: {nextCursor ? formatTs(nextCursor) : "—"}</div>
          </div>
        </div>

        <div className="lg:col-span-6 space-y-3">
          <div className="border rounded overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium bg-muted/40">
              <div className="col-span-3">Time</div>
              <div className="col-span-3">Deal</div>
              <div className="col-span-3">Actor</div>
              <div className="col-span-3">Scope / Action</div>
            </div>
            <div className="divide-y">
              {events.map((e) => {
                const active = e.id === selectedId;
                return (
                  <button
                    key={e.id}
                    className={`w-full text-left grid grid-cols-12 gap-2 px-3 py-2 text-sm hover:bg-muted/30 ${
                      active ? "bg-muted/30" : ""
                    }`}
                    onClick={() => setSelectedId(e.id)}
                  >
                    <div className="col-span-3 text-xs">{formatTs(e.created_at)}</div>
                    <div className="col-span-3 font-mono text-xs truncate" title={safeString(e.deal_id)}>
                      {e.deal_id ?? "—"}
                    </div>
                    <div className="col-span-3 font-mono text-xs truncate" title={safeString(e.actor_user_id)}>
                      {e.actor_user_id ?? "—"}
                    </div>
                    <div className="col-span-3 min-w-0">
                      <div className="text-xs truncate">{e.scope ?? "—"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {e.action ?? "—"} {e.kind ? `(${e.kind})` : ""}
                      </div>
                    </div>
                  </button>
                );
              })}

              {!busy && events.length === 0 && (
                <div className="px-3 py-6 text-sm text-muted-foreground">No audit events found.</div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              className="border rounded px-3 py-2"
              onClick={() => void load({ append: true, cursor: nextCursor })}
              disabled={busy || !nextCursor}
            >
              Load more
            </button>
            <div className="text-xs text-muted-foreground">Uses created_at cursor (older events).</div>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-3">
          <div className="border rounded p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">Event details</div>
                <div className="text-xs text-muted-foreground truncate">{selected?.id ?? "—"}</div>
              </div>
              <button
                className="border rounded px-2 py-1 text-xs"
                disabled={!selected}
                onClick={async () => {
                  if (!selected) return;
                  await copyToClipboard(selected.id);
                }}
              >
                Copy ID
              </button>
            </div>

            <div className="mt-2 text-xs text-muted-foreground space-y-1">
              <div>
                <span className="font-medium text-foreground">Requires review:</span> {selected?.requires_human_review ? "Yes" : "No"}
              </div>
              <div>
                <span className="font-medium text-foreground">Confidence:</span> {selected?.confidence ?? "—"}
              </div>
            </div>
          </div>

          <div className="border rounded p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-sm">Input JSON</div>
              <button
                className="border rounded px-2 py-1 text-xs"
                disabled={!selected}
                onClick={async () => {
                  if (!selected) return;
                  await copyToClipboard(selectedInput);
                }}
              >
                Copy
              </button>
            </div>
            <pre className="mt-2 text-xs whitespace-pre-wrap break-words font-mono text-muted-foreground max-h-56 overflow-auto">
              {selected ? selectedInput : "—"}
            </pre>
          </div>

          <div className="border rounded p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-sm">Output JSON</div>
              <button
                className="border rounded px-2 py-1 text-xs"
                disabled={!selected}
                onClick={async () => {
                  if (!selected) return;
                  await copyToClipboard(selectedOutput);
                }}
              >
                Copy
              </button>
            </div>
            <pre className="mt-2 text-xs whitespace-pre-wrap break-words font-mono text-muted-foreground max-h-56 overflow-auto">
              {selected ? selectedOutput : "—"}
            </pre>
          </div>

          <div className="border rounded p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-sm">Evidence JSON</div>
              <button
                className="border rounded px-2 py-1 text-xs"
                disabled={!selected}
                onClick={async () => {
                  if (!selected) return;
                  await copyToClipboard(selectedEvidence);
                }}
              >
                Copy
              </button>
            </div>
            <pre className="mt-2 text-xs whitespace-pre-wrap break-words font-mono text-muted-foreground max-h-56 overflow-auto">
              {selected ? selectedEvidence : "—"}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
