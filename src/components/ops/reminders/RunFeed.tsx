// src/components/ops/reminders/RunFeed.tsx
"use client";

import Link from "next/link";
import { useMemo } from "react";

export type ReminderRun = {
  id: string;
  subscription_id: string;
  due_at: string | null;
  ran_at: string;
  status: "sent" | "skipped" | "error";
  error: string | null;
  meta: any;
};

type Mode = "tail" | "grafana" | "movie";

function shortId(id: string) {
  if (!id) return "";
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function shortTs(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

function statusPill(mode: Mode, status: ReminderRun["status"]) {
  const base = "px-2 py-1 rounded-full text-[11px] font-semibold border";
  if (mode === "grafana") {
    if (status === "error") return `${base} bg-red-50 text-red-700 border-red-200`;
    if (status === "skipped") return `${base} bg-yellow-50 text-yellow-800 border-yellow-200`;
    return `${base} bg-green-50 text-green-700 border-green-200`;
  }
  if (status === "error") return `${base} bg-red-500/15 text-red-200 border-red-400/30`;
  if (status === "skipped") return `${base} bg-yellow-500/15 text-yellow-100 border-yellow-400/30`;
  return `${base} bg-green-500/15 text-green-100 border-green-400/30`;
}

async function postJson(url: string) {
  const res = await fetch(url, { method: "POST" });
  return res.json().catch(() => null);
}

export default function RunFeed({
  mode,
  runs,
  selectedId,
  onSelect,
  onRunActionComplete,
}: {
  mode: Mode;
  runs: ReminderRun[];
  selectedId: string | null;
  onSelect: (r: ReminderRun) => void;
  onRunActionComplete?: () => void;
}) {
  const chrome =
    mode === "grafana"
      ? "bg-white text-slate-900 border-slate-200 shadow-sm"
      : mode === "movie"
      ? "bg-black/20 text-white border-slate-800"
      : "bg-black/30 text-slate-100 border-slate-800";

  const headerTone = mode === "grafana" ? "text-slate-700" : "text-slate-200";

  const rendered = useMemo(() => runs, [runs]);

  return (
    <div className={`rounded-2xl border p-4 ${chrome}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">Live Feed</div>
          <div className={`text-sm ${headerTone}`}>
            Click an event to replay details
          </div>
        </div>
        <div className={`text-xs font-semibold ${headerTone}`}>{rendered.length} events</div>
      </div>

      <div className="mt-4 space-y-2 max-h-[70vh] overflow-auto pr-1">
        {rendered.length === 0 ? (
          <div className={`text-sm ${headerTone}`}>No events.</div>
        ) : (
          rendered.map((r) => {
            const active = selectedId === r.id;

            // Tail mode: terminal vibe
            if (mode === "tail") {
              return (
                <button
                  key={r.id}
                  onClick={() => onSelect(r)}
                  className={`w-full text-left rounded-xl border px-3 py-2 font-mono text-[12px] ${
                    active
                      ? "border-white/30 bg-white/10"
                      : "border-slate-800 bg-black/20 hover:bg-white/5"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={statusPill(mode, r.status)}>{r.status.toUpperCase()}</span>
                    <span className="text-slate-300">{shortTs(r.ran_at)}</span>
                    <span className="text-slate-400">sub:</span>
                    <span className="text-slate-200">{shortId(r.subscription_id)}</span>
                    {r.error ? <span className="text-red-200">err=&quot;{r.error}&quot;</span> : null}
                  </div>
                </button>
              );
            }

            // Movie mode: cinematic cards + inline actions
            if (mode === "movie") {
              const glow =
                r.status === "error"
                  ? "shadow-[0_0_0_1px_rgba(248,113,113,0.35),0_0_28px_rgba(248,113,113,0.12)]"
                  : r.status === "skipped"
                  ? "shadow-[0_0_0_1px_rgba(250,204,21,0.25),0_0_24px_rgba(250,204,21,0.08)]"
                  : "shadow-[0_0_0_1px_rgba(34,197,94,0.2),0_0_20px_rgba(34,197,94,0.06)]";

              return (
                <div
                  key={r.id}
                  className={`group rounded-2xl border transition-all ${
                    active
                      ? "border-white/30 bg-white/10 scale-[1.01]"
                      : "border-slate-800 bg-black/20 hover:bg-white/5 hover:border-slate-700"
                  } ${glow}`}
                >
                  <button
                    onClick={() => onSelect(r)}
                    className="w-full text-left px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className={statusPill(mode, r.status)}>{r.status.toUpperCase()}</span>
                        <div className="text-sm text-slate-200">{shortTs(r.ran_at)}</div>
                      </div>
                      <div className="text-xs text-slate-400">{shortId(r.id)}</div>
                    </div>

                    <div className="mt-2 text-sm text-slate-300">
                      subscription:{" "}
                      <span className="text-slate-100 font-semibold">
                        {shortId(r.subscription_id)}
                      </span>
                    </div>

                    {r.error ? (
                      <div className="mt-2 text-sm text-red-200">
                        {r.error}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-slate-400">
                        meta keys: {r.meta ? Object.keys(r.meta).slice(0, 6).join(", ") || "—" : "—"}
                      </div>
                    )}
                  </button>

                  {/* Inline actions */}
                  <div className="px-4 pb-3 flex flex-wrap gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Link
                      href={`/ops/reminders/subscriptions/${encodeURIComponent(r.subscription_id)}`}
                      className="px-3 py-2 rounded-xl text-xs font-semibold border border-white/15 bg-white/10 hover:bg-white/15 text-white"
                      title="Open subscription detail"
                    >
                      Open
                    </Link>

                    <button
                      onClick={async () => {
                        await postJson(
                          `/api/admin/reminders/tick-one?subscription_id=${encodeURIComponent(
                            r.subscription_id
                          )}&force=1`
                        );
                        onRunActionComplete?.();
                      }}
                      className="px-3 py-2 rounded-xl text-xs font-semibold border border-white/15 bg-white/10 hover:bg-white/15 text-white"
                      title="Force-run this subscription"
                    >
                      Force-run
                    </button>

                    <button
                      onClick={async () => {
                        await postJson(
                          `/api/admin/reminders/subscriptions/${encodeURIComponent(
                            r.subscription_id
                          )}/mute`
                        );
                        onRunActionComplete?.();
                      }}
                      className="px-3 py-2 rounded-xl text-xs font-semibold border border-red-400/40 bg-red-500/20 hover:bg-red-500/25 text-white"
                      title="Mute subscription (active=false)"
                    >
                      Mute
                    </button>
                  </div>
                </div>
              );
            }

            // Grafana mode: clean compact cards
            return (
              <button
                key={r.id}
                onClick={() => onSelect(r)}
                className={`w-full text-left rounded-xl border px-3 py-2 ${
                  active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={statusPill(mode, r.status)}>{r.status.toUpperCase()}</span>
                    <div className={`${active ? "text-white/90" : "text-slate-700"} text-sm`}>
                      {shortTs(r.ran_at)}
                    </div>
                  </div>
                  <div className={`${active ? "text-white/60" : "text-slate-400"} text-xs`}>
                    {shortId(r.id)}
                  </div>
                </div>
                {r.error ? (
                  <div className={`${active ? "text-red-200" : "text-red-700"} text-sm mt-1`}>
                    {r.error}
                  </div>
                ) : (
                  <div className={`${active ? "text-white/70" : "text-slate-500"} text-sm mt-1`}>
                    sub: {shortId(r.subscription_id)}
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
