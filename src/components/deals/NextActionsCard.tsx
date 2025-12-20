"use client";

import { useEffect, useMemo, useState } from "react";

type NextActionItem =
  | { kind: "condition"; id: string; title: string; status: string; due_at: string | null }
  | { kind: "mitigant"; id: string; title: string; status: string; due_at: string | null }
  | { kind: "reminder"; id: string; title: string; next_run_at: string | null };

type NextActionsResponse = {
  dealId: string;
  counts: { conditionsOpen: number; mitigantsOpen: number; remindersDue: number };
  items: NextActionItem[];
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function urgencyLabel(iso: string | null | undefined) {
  if (!iso) return { label: "No due date", tone: "neutral" as const };
  const due = new Date(iso).getTime();
  const now = Date.now();
  const diffDays = Math.floor((due - now) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { label: "Overdue", tone: "bad" as const };
  if (diffDays === 0) return { label: "Due today", tone: "warn" as const };
  if (diffDays <= 7) return { label: "Due soon", tone: "warn" as const };
  return { label: "Scheduled", tone: "neutral" as const };
}

function toneClasses(tone: "neutral" | "warn" | "bad") {
  switch (tone) {
    case "bad":
      return "border border-red-200 bg-red-50 text-red-700";
    case "warn":
      return "border border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border border-slate-200 bg-slate-50 text-slate-700";
  }
}

function kindBadge(kind: NextActionItem["kind"]) {
  if (kind === "condition") return "Condition";
  if (kind === "mitigant") return "Mitigant";
  return "Reminder";
}

export default function NextActionsCard({
  dealId,
  limit = 7,
}: {
  dealId: string;
  limit?: number;
}) {
  const [data, setData] = useState<NextActionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/deals/${dealId}/next-actions`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as NextActionsResponse;
        if (!alive) return;
        setData(json);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load");
        setData(null);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [dealId]);

  const topItems = useMemo(() => {
    if (!data?.items) return [];
    return data.items.slice(0, limit);
  }, [data, limit]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-900">Next Actions</div>
          <div className="text-sm text-slate-600">
            What Buddy thinks should happen next — based on conditions, mitigants, and reminders.
          </div>
        </div>

        <div className="flex gap-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-600">Open</div>
            <div className="text-sm font-semibold text-slate-900">
              {(data?.counts.conditionsOpen ?? 0) + (data?.counts.mitigantsOpen ?? 0)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-600">Due</div>
            <div className="text-sm font-semibold text-slate-900">{data?.counts.remindersDue ?? 0}</div>
          </div>
        </div>
      </div>

      <div className="px-4 pb-4">
        {loading && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            Loading next actions…
          </div>
        )}

        {!loading && err && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Failed to load Next Actions: {err}
          </div>
        )}

        {!loading && !err && topItems.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            No open conditions/mitigants, and no due reminders.
          </div>
        )}

        {!loading && !err && topItems.length > 0 && (
          <div className="space-y-2">
            {topItems.map((it) => {
              const when = it.kind === "reminder" ? it.next_run_at : it.due_at;
              const u = urgencyLabel(when);
              const date = fmtDate(when);

              return (
                <div
                  key={`${it.kind}:${it.id}`}
                  className="rounded-xl border border-slate-200 bg-white p-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {kindBadge(it.kind)}
                      </span>

                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses(u.tone)}`}>
                        {u.label}
                      </span>

                      {date && (
                        <span className="text-xs text-slate-500">
                          {it.kind === "reminder" ? "Next" : "Due"}: {date}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 text-sm font-semibold text-slate-900 truncate">{it.title}</div>

                    {"status" in it && (
                      <div className="mt-0.5 text-xs text-slate-600">Status: {it.status}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => navigator.clipboard.writeText(it.id)}
                      title="Copy item id"
                    >
                      Copy ID
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && !err && data?.items?.length && data.items.length > limit && (
          <div className="mt-3 text-xs text-slate-500">
            Showing {limit} of {data.items.length}.
          </div>
        )}
      </div>
    </div>
  );
}
