"use client";

import React, { useEffect, useMemo, useState } from "react";

type Item = {
  id: string;
  checklist_key: string;
  title: string;
  description: string | null;
  required: boolean;
  status: "missing" | "pending" | "needs_review" | "received" | "satisfied" | "waived";
  received_at: string | null;
  satisfied_at?: string | null;
  required_years?: number[] | null;
  satisfied_years?: number[] | null;
  created_at: string;
};

function badgeTone(status: Item["status"]) {
  if (status === "received" || status === "satisfied") {
    return "border-emerald-900/40 bg-emerald-950/20 text-emerald-200";
  }
  if (status === "needs_review") {
    return "border-yellow-900/40 bg-yellow-950/20 text-yellow-200";
  }
  if (status === "waived") return "border-neutral-700 bg-neutral-900/40 text-neutral-200";
  return "border-amber-900/40 bg-amber-950/20 text-amber-200";
}

export default function DealChecklistCard({ dealId }: { dealId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [newKey, setNewKey] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newRequired, setNewRequired] = useState(true);

  const missingCount = useMemo(
    () => items.filter((x) => x.required && x.status === "missing").length,
    [items]
  );

  async function refresh() {
    setMsg(null);
    const res = await fetch(`/api/deals/${dealId}/checklist/list`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.ok) {
      setMsg(json?.error || "Failed to load checklist.");
      return;
    }
    setItems(json.items || []);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function seed(preset: "core" | "sba7a" | "sba504") {
    setBusy(true);
    setMsg(`Seeding ${preset}…`);
    try {
      const res = await fetch(`/api/deals/${dealId}/checklist/seed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preset }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Failed to seed.");
        return;
      }
      setMsg(`Seeded ${json.count || 0} items.`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function addItem() {
    const checklistKey = newKey.trim();
    const title = newTitle.trim();
    if (!checklistKey || !title) {
      setMsg("Checklist key and title are required.");
      return;
    }

    setBusy(true);
    setMsg("Adding…");
    try {
      const res = await fetch(`/api/deals/${dealId}/checklist/upsert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checklistKey, title, required: newRequired }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Failed to add.");
        return;
      }
      setNewKey("");
      setNewTitle("");
      setNewRequired(true);
      setMsg("Added.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(checklistKey: string, status: Item["status"]) {
    setBusy(true);
    setMsg("Updating…");
    try {
      const res = await fetch(`/api/deals/${dealId}/checklist/set-status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checklistKey, status }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Failed to update.");
        return;
      }
      setMsg(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-neutral-50">
            Checklist{" "}
            <span className="ml-2 rounded-full border border-neutral-700 bg-neutral-900/40 px-2 py-0.5 text-xs text-neutral-200">
              Missing required: {missingCount}
            </span>
          </div>
          <div className="mt-1 text-sm text-neutral-400">
            Reminders reference only checklist keys. Borrower uploads can auto-mark "received" when a checklist key is provided.
          </div>
        </div>
        <button
          onClick={refresh}
          className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800"
          disabled={busy}
        >
          Refresh
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => seed("core")}
          disabled={busy}
          className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
        >
          Seed Core
        </button>
        <button
          onClick={() => seed("sba7a")}
          disabled={busy}
          className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
        >
          Seed SBA 7(a)
        </button>
        <button
          onClick={() => seed("sba504")}
          disabled={busy}
          className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
        >
          Seed SBA 504
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950/30 p-3">
        <div className="text-xs font-semibold text-neutral-400">Add item</div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-6">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="md:col-span-2 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="CHECKLIST_KEY"
          />
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="md:col-span-3 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            placeholder="Title"
          />
          <div className="md:col-span-1 flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={newRequired}
                onChange={(e) => setNewRequired(e.target.checked)}
                className="h-4 w-4"
              />
              Required
            </label>
          </div>
          <button
            onClick={addItem}
            disabled={busy}
            className="md:col-span-6 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-neutral-900 disabled:opacity-50"
          >
            Add / Upsert
          </button>
        </div>
      </div>

      {msg ? (
        <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 text-sm text-neutral-200">
          {msg}
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-3 text-sm text-neutral-400">
            No checklist items yet. Seed a preset or add your own.
          </div>
        ) : null}

        {items.map((it) => (
          <div
            key={it.id}
            className={`rounded-xl border p-3 ${badgeTone(it.status)} flex flex-col gap-2`}
          >
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">{it.status.toUpperCase()}</span>
                  {it.required ? (
                    <span className="rounded-full border border-neutral-700 bg-neutral-900/40 px-2 py-0.5 text-[11px] text-neutral-200">
                      Required
                    </span>
                  ) : (
                    <span className="rounded-full border border-neutral-800 bg-neutral-950/20 px-2 py-0.5 text-[11px] text-neutral-300">
                      Optional
                    </span>
                  )}
                </div>
                <div className="mt-1 text-sm text-neutral-100">{it.title}</div>

                {Array.isArray(it.required_years) && it.required_years.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {it.required_years
                      .map((y) => Number(y))
                      .filter((y) => Number.isFinite(y))
                      .sort((a, b) => b - a)
                      .map((y) => {
                        const satisfied = Array.isArray(it.satisfied_years)
                          ? it.satisfied_years.includes(y)
                          : false;
                        return (
                          <span
                            key={String(y)}
                            className={
                              satisfied
                                ? "rounded-full border border-emerald-900/40 bg-emerald-950/20 px-2 py-0.5 text-[11px] text-emerald-200"
                                : "rounded-full border border-amber-900/40 bg-amber-950/20 px-2 py-0.5 text-[11px] text-amber-200"
                            }
                          >
                            {y}
                          </span>
                        );
                      })}
                  </div>
                ) : null}

                <div className="mt-1 text-xs opacity-80">
                  Key: <span className="font-mono">{it.checklist_key}</span>
                  {it.received_at ? ` • Received: ${new Date(it.received_at).toLocaleString()}` : ""}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setStatus(it.checklist_key, "missing")}
                  disabled={busy}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
                >
                  Mark Missing
                </button>
                <button
                  onClick={() => setStatus(it.checklist_key, "waived")}
                  disabled={busy}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
                >
                  Waive
                </button>
                <button
                  onClick={() => setStatus(it.checklist_key, "received")}
                  disabled={busy}
                  className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-neutral-900 disabled:opacity-50"
                >
                  Mark Received
                </button>
              </div>
            </div>

            {it.description ? (
              <div className="text-xs text-neutral-300">{it.description}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
