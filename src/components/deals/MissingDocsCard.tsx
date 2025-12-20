"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useDealRealtimeRefresh } from "@/hooks/useDealRealtimeRefresh";

type MissingDoc = {
  key: string;
  label: string;
  reason?: string | null;
  severity?: "high" | "medium" | "low" | null;
};

type MissingDocsResponse = {
  ok: boolean;
  missing?: MissingDoc[];
  error?: string;
};

type SendResponse = {
  ok: boolean;
  sent?: boolean;
  error?: string;
};

export default function MissingDocsCard({ dealId }: { dealId: string }) {
  const { refreshKey } = useDealRealtimeRefresh(dealId);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<MissingDoc[]>([]);

  const count = items.length;

  const grouped = useMemo(() => {
    const hi: MissingDoc[] = [];
    const mid: MissingDoc[] = [];
    const lo: MissingDoc[] = [];
    const unk: MissingDoc[] = [];

    for (const d of items) {
      if (d.severity === "high") hi.push(d);
      else if (d.severity === "medium") mid.push(d);
      else if (d.severity === "low") lo.push(d);
      else unk.push(d);
    }

    return { hi, mid, lo, unk };
  }, [items]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      // If your GET route exists, this will populate the list.
      // If it doesn't exist yet, we fail gracefully and show empty state.
      const res = await fetch(`/api/deals/${dealId}/missing-docs`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      if (!res.ok) {
        // Graceful: treat missing route as "no missing docs" instead of hard error
        if (res.status === 404) {
          setItems([]);
          return;
        }
        const text = await res.text();
        throw new Error(text || `Failed to load (status ${res.status})`);
      }

      const json = (await res.json()) as MissingDocsResponse;
      if (!json.ok) throw new Error(json.error || "missing_docs_load_failed");
      setItems(json.missing ?? []);
    } catch (e: any) {
      // Don’t brick the page—show error but keep UI alive
      setError(e?.message || "missing_docs_load_failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function sendReminder() {
    setSending(true);
    setError(null);

    try {
      const res = await fetch(`/api/deals/${dealId}/missing-docs/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Your send route can ignore body if it wants; this is safe.
        body: JSON.stringify({ dealId }),
      });

      const json = (await res.json().catch(() => null)) as SendResponse | null;

      if (!res.ok) {
        const msg =
          (json && "error" in json && json.error) ||
          `Send failed (status ${res.status})`;
        throw new Error(msg);
      }

      if (json && json.ok === false) {
        throw new Error(json.error || "missing_docs_send_failed");
      }

      // Reload after send so UI stays truthful
      await load();
    } catch (e: any) {
      setError(e?.message || "missing_docs_send_failed");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (!dealId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, refreshKey]);

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Missing docs</h3>
          <p className="mt-1 text-xs text-neutral-600">
            {loading ? "Checking…" : count === 0 ? "None detected" : `${count} missing`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading || sending}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={sendReminder}
            disabled={loading || sending || count === 0}
            className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            title={count === 0 ? "No missing documents to chase" : "Send reminder"}
          >
            {sending ? "Sending…" : "Send reminder"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="text-xs text-neutral-600">Loading missing docs…</div>
        ) : count === 0 ? (
          <div className="rounded-lg border bg-neutral-50 p-3 text-xs text-neutral-700">
            Everything we expect is present (or the missing-docs endpoint isn’t wired yet).
          </div>
        ) : (
          <>
            <MissingList title="High" items={grouped.hi} />
            <MissingList title="Medium" items={grouped.mid} />
            <MissingList title="Low" items={grouped.lo} />
            <MissingList title="Other" items={grouped.unk} />
          </>
        )}
      </div>
    </section>
  );
}

function MissingList({
  title,
  items,
}: {
  title: string;
  items: { key: string; label: string; reason?: string | null }[];
}) {
  if (!items.length) return null;

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold">{title}</div>
        <div className="text-[11px] text-neutral-600">{items.length}</div>
      </div>

      <ul className="space-y-2">
        {items.map((d) => (
          <li key={d.key} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">{d.label}</div>
              {d.reason ? (
                <div className="mt-0.5 text-[11px] text-neutral-600">{d.reason}</div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
