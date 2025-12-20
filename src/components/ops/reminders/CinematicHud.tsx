// src/components/ops/reminders/CinematicHud.tsx
"use client";

export type TimeWindow = "1m" | "5m" | "1h" | "24h" | "all";

export default function CinematicHud({
  enabled,
  status,
  live,
  alarmOn,
  onToggleLive,
  onToggleAlarm,
  onSetStatus,
  onChaos,
  onTick,
  streamStatus,
  lastEventLabel,
  timeWindow,
  onSetTimeWindow,
  leftTab,
  onSetLeftTab,
}: {
  enabled: boolean;
  status: "" | "sent" | "skipped" | "error";
  live: boolean;
  alarmOn: boolean;
  onToggleLive: () => void;
  onToggleAlarm: () => void;
  onSetStatus: (s: "" | "sent" | "skipped" | "error") => void;
  onChaos: () => void;
  onTick: () => void;
  streamStatus: "connecting" | "open" | "closed" | "error";
  lastEventLabel: string;
  timeWindow: TimeWindow;
  onSetTimeWindow: (w: TimeWindow) => void;
  leftTab: "feed" | "incidents";
  onSetLeftTab: (t: "feed" | "incidents") => void;
}) {
  if (!enabled) return null;

  const liveBadge =
    streamStatus === "open"
      ? "bg-green-500/15 text-green-100 border-green-400/30"
      : streamStatus === "connecting"
      ? "bg-yellow-500/15 text-yellow-100 border-yellow-400/30"
      : streamStatus === "error"
      ? "bg-red-500/15 text-red-100 border-red-400/30"
      : "bg-slate-500/15 text-slate-200 border-slate-400/30";

  const winBtn = (w: TimeWindow, label: string, hotkey: string) => {
    const active = timeWindow === w;
    return (
      <button
        onClick={() => onSetTimeWindow(w)}
        className={`px-3 py-2 rounded-xl text-xs font-semibold border ${
          active
            ? "border-white/25 bg-white/15 text-white"
            : "border-white/15 bg-white/10 hover:bg-white/15 text-white"
        }`}
        title={`Hotkey: ${hotkey}`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="fixed inset-x-0 top-0 z-50 pointer-events-none">
      <div className="mx-auto max-w-7xl px-6 pt-4">
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-black/35 backdrop-blur-xl shadow-xl overflow-hidden">
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="text-white font-semibold tracking-wide">
                OPS CINEMATIC MODE
              </div>
              <div className={`px-3 py-1 rounded-full border text-xs font-semibold ${liveBadge}`}>
                {live ? `LIVE · ${streamStatus.toUpperCase()}` : "POLLING"}
              </div>
              <div className="text-xs text-slate-300">{lastEventLabel}</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={onTick}
                className="px-3 py-2 rounded-xl text-xs font-semibold border border-white/15 bg-white/10 hover:bg-white/15 text-white"
              >
                TICK (T)
              </button>
              <button
                onClick={onChaos}
                className="px-3 py-2 rounded-xl text-xs font-semibold border border-red-400/40 bg-red-500/20 hover:bg-red-500/25 text-white"
              >
                CHAOS (C)
              </button>
              <button
                onClick={onToggleLive}
                className="px-3 py-2 rounded-xl text-xs font-semibold border border-white/15 bg-white/10 hover:bg-white/15 text-white"
              >
                LIVE (L): {live ? "ON" : "OFF"}
              </button>
              <button
                onClick={onToggleAlarm}
                className="px-3 py-2 rounded-xl text-xs font-semibold border border-white/15 bg-white/10 hover:bg-white/15 text-white"
              >
                ALARM: {alarmOn ? "ON" : "OFF"}
              </button>

              <div className="h-10 w-px bg-white/10 mx-1" />

              <button
                onClick={() => onSetLeftTab("feed")}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border ${
                  leftTab === "feed"
                    ? "border-white/25 bg-white/15 text-white"
                    : "border-white/15 bg-white/10 hover:bg-white/15 text-white"
                }`}
              >
                FEED
              </button>
              <button
                onClick={() => onSetLeftTab("incidents")}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border ${
                  leftTab === "incidents"
                    ? "border-red-300/60 bg-red-500/25 text-white"
                    : "border-white/15 bg-white/10 hover:bg-white/15 text-white"
                }`}
              >
                INCIDENTS
              </button>

              <div className="h-10 w-px bg-white/10 mx-1" />

              <button
                onClick={() => onSetStatus("")}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border ${
                  status === ""
                    ? "border-white/25 bg-white/15 text-white"
                    : "border-white/15 bg-white/10 hover:bg-white/15 text-white"
                }`}
              >
                ALL (A)
              </button>
              <button
                onClick={() => onSetStatus("error")}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border ${
                  status === "error"
                    ? "border-red-300/60 bg-red-500/25 text-white"
                    : "border-white/15 bg-white/10 hover:bg-white/15 text-white"
                }`}
              >
                ERRORS (E)
              </button>
            </div>
          </div>

          <div className="px-4 pb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
              <span>↑/↓ select</span>
              <span>Enter open</span>
              <span>F force-run</span>
              <span>M mute</span>
              <span>Esc clear</span>
              <span>1/2/3/4/0 time window</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {winBtn("1m", "1m (1)", "1")}
              {winBtn("5m", "5m (2)", "2")}
              {winBtn("1h", "1h (3)", "3")}
              {winBtn("24h", "24h (4)", "4")}
              {winBtn("all", "all (0)", "0")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
