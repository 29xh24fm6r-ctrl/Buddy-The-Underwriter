// src/components/ops/reminders/IncidentTimeline.tsx
"use client";

import type { ReminderRun } from "@/components/ops/reminders/RunFeed";

type Mode = "tail" | "grafana" | "movie";

export type Severity = "SEV-1" | "SEV-2" | "SEV-3";
export type Incident = {
  id: string;
  startAt: string; // ISO
  endAt: string;   // ISO
  count: number;
  subscriptionIds: string[];
  latestRun: ReminderRun;
  latestError: string;
  severity: Severity;
  resolvedAt: string | null; // ISO if resolved
};

function fmt(ts: string) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function shortId(id: string) {
  if (!id) return "";
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function sevPill(mode: Mode, sev: Severity) {
  const base = "px-2 py-1 rounded-full text-[11px] font-semibold border";
  if (mode === "grafana") {
    if (sev === "SEV-1") return `${base} bg-red-50 text-red-700 border-red-200`;
    if (sev === "SEV-2") return `${base} bg-yellow-50 text-yellow-800 border-yellow-200`;
    return `${base} bg-slate-50 text-slate-700 border-slate-200`;
  }
  if (sev === "SEV-1") return `${base} bg-red-500/15 text-red-200 border-red-400/30`;
  if (sev === "SEV-2") return `${base} bg-yellow-500/15 text-yellow-100 border-yellow-400/30`;
  return `${base} bg-white/10 text-slate-200 border-white/15`;
}

export default function IncidentTimeline({
  mode,
  incidents,
  selectedIncidentId,
  onSelectIncident,
}: {
  mode: Mode;
  incidents: Incident[];
  selectedIncidentId: string | null;
  onSelectIncident: (inc: Incident) => void;
}) {
  const chrome =
    mode === "grafana"
      ? "bg-white text-slate-900 border-slate-200 shadow-sm"
      : mode === "movie"
      ? "bg-black/20 text-white border-slate-800"
      : "bg-black/30 text-slate-100 border-slate-800";

  const headerTone = mode === "grafana" ? "text-slate-700" : "text-slate-200";

  return (
    <div className={`rounded-2xl border p-4 ${chrome}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">Incident Timeline</div>
          <div className={`text-sm ${headerTone}`}>
            Error bursts grouped into incidents
          </div>
        </div>
        <div className={`text-xs font-semibold ${headerTone}`}>{incidents.length} incidents</div>
      </div>

      <div className="mt-4 space-y-2 max-h-[70vh] overflow-auto pr-1">
        {incidents.length === 0 ? (
          <div className={`text-sm ${headerTone}`}>No incidents in this window.</div>
        ) : (
          incidents.map((inc) => {
            const active = selectedIncidentId === inc.id;

            const resolvedRibbon =
              inc.resolvedAt ? (
                <div className="absolute top-3 right-3 px-3 py-1 rounded-full border text-[11px] font-semibold bg-green-500/15 text-green-100 border-green-400/30">
                  RESOLVED
                </div>
              ) : null;

            if (mode === "movie") {
              const glow =
                inc.severity === "SEV-1"
                  ? "shadow-[0_0_0_1px_rgba(248,113,113,0.35),0_0_28px_rgba(248,113,113,0.12)]"
                  : inc.severity === "SEV-2"
                  ? "shadow-[0_0_0_1px_rgba(250,204,21,0.25),0_0_24px_rgba(250,204,21,0.08)]"
                  : "shadow-[0_0_0_1px_rgba(148,163,184,0.2),0_0_18px_rgba(148,163,184,0.05)]";

              return (
                <button
                  key={inc.id}
                  onClick={() => onSelectIncident(inc)}
                  className={`relative w-full text-left rounded-2xl border px-4 py-3 transition-all ${
                    active
                      ? "border-white/30 bg-white/10 scale-[1.01]"
                      : "border-slate-800 bg-black/20 hover:bg-white/5 hover:border-slate-700"
                  } ${glow}`}
                >
                  {resolvedRibbon}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={sevPill(mode, inc.severity)}>{inc.severity}</span>
                      <div className="text-sm text-slate-200">
                        {inc.count} errors · {inc.subscriptionIds.length} subs
                      </div>
                    </div>
                    <div className="text-xs text-slate-400">{fmt(inc.endAt)}</div>
                  </div>

                  <div className="mt-2 text-sm text-slate-300">
                    window: <span className="text-slate-100 font-semibold">{fmt(inc.startAt)}</span>{" "}
                    → <span className="text-slate-100 font-semibold">{fmt(inc.endAt)}</span>
                  </div>

                  <div className="mt-2 text-sm text-red-200">
                    latest: {inc.latestError || "unknown error"}
                  </div>

                  <div className="mt-2 text-sm text-slate-400">
                    example sub: {shortId(inc.subscriptionIds[0] || "")}
                  </div>
                </button>
              );
            }

            // Grafana/Tail
            return (
              <button
                key={inc.id}
                onClick={() => onSelectIncident(inc)}
                className={`relative w-full text-left rounded-xl border px-3 py-2 ${
                  active
                    ? mode === "grafana"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-white/30 bg-white/10"
                    : mode === "grafana"
                    ? "border-slate-200 bg-white hover:bg-slate-50"
                    : "border-slate-800 bg-black/20 hover:bg-white/5"
                }`}
              >
                {mode !== "grafana" && resolvedRibbon}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={sevPill(mode, inc.severity)}>{inc.severity}</span>
                    <div className="text-sm font-semibold">
                      {inc.count} errors · {inc.subscriptionIds.length} subs
                    </div>
                  </div>
                  <div className={`text-xs ${headerTone}`}>{fmt(inc.endAt)}</div>
                </div>
                <div className={`text-sm mt-1 ${mode === "grafana" ? "text-slate-600" : "text-slate-300"}`}>
                  {fmt(inc.startAt)} → {fmt(inc.endAt)}
                </div>
                <div className={`text-sm mt-1 ${mode === "grafana" ? "text-red-700" : "text-red-200"}`}>
                  {inc.latestError || "unknown error"}
                </div>
                {inc.resolvedAt && mode === "grafana" ? (
                  <div className="mt-2 text-xs font-semibold text-green-700">
                    RESOLVED @ {fmt(inc.resolvedAt)}
                  </div>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
