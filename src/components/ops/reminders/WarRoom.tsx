// src/components/ops/reminders/WarRoom.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import RunFeed, { ReminderRun } from "@/components/ops/reminders/RunFeed";
import RunDetails from "@/components/ops/reminders/RunDetails";
import { useRunsStream } from "@/components/ops/reminders/useRunsStream";
import CinematicHud, { TimeWindow } from "@/components/ops/reminders/CinematicHud";
import IncidentTimeline, { Incident, Severity } from "@/components/ops/reminders/IncidentTimeline";
import IncidentDrawer from "@/components/ops/reminders/IncidentDrawer";

type Mode = "tail" | "grafana" | "movie";

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function msAgo(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function computeSparkline(values: number[]) {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(1, max - min);

  const w = 120;
  const h = 28;
  const step = values.length === 1 ? w : w / (values.length - 1);

  const pts = values
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return pts;
}

function nowMinusWindowIso(w: TimeWindow): string | null {
  const now = Date.now();
  let delta = 0;
  if (w === "1m") delta = 60_000;
  else if (w === "5m") delta = 5 * 60_000;
  else if (w === "1h") delta = 60 * 60_000;
  else if (w === "24h") delta = 24 * 60 * 60_000;
  else return null;

  return new Date(now - delta).toISOString();
}

// Alarm beep
function beep() {
  try {
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 120);
  } catch {}
}

function deriveSeverity(count: number, uniqueSubs: number, durationMs: number): Severity {
  // SEV-1: big blast radius or very intense burst
  if (uniqueSubs >= 3) return "SEV-1";
  if (count >= 5 && durationMs <= 2 * 60_000) return "SEV-1";
  if (count >= 3 && durationMs <= 2 * 60_000) return "SEV-2";
  if (count >= 4) return "SEV-2";
  return "SEV-3";
}

function buildIncidents(runs: ReminderRun[], opts: { gapMs: number; resolveMs: number }): Incident[] {
  const { gapMs, resolveMs } = opts;
  const nowMs = Date.now();

  const errors = runs
    .filter((r) => r.status === "error")
    .sort((a, b) => new Date(b.ran_at).getTime() - new Date(a.ran_at).getTime());

  if (errors.length === 0) return [];

  const incidents: Incident[] = [];

  let current: {
    startAt: string;
    endAt: string;
    count: number;
    subs: Set<string>;
    latestRun: ReminderRun;
    latestError: string;
    lastTs: number;
  } | null = null;

  for (const r of errors) {
    const ts = new Date(r.ran_at).getTime();
    const errMsg =
      r.error ||
      (typeof (r.meta as any)?.error === "string" ? (r.meta as any).error : "") ||
      "error";

    if (!current) {
      current = {
        startAt: r.ran_at,
        endAt: r.ran_at,
        count: 1,
        subs: new Set([r.subscription_id]),
        latestRun: r,
        latestError: errMsg,
        lastTs: ts,
      };
      continue;
    }

    // iterating newest->oldest; if close, same incident
    if (current.lastTs - ts <= gapMs) {
      current.count += 1;
      current.subs.add(r.subscription_id);
      current.startAt = r.ran_at; // older extends start
      current.lastTs = ts;
    } else {
      const durationMs = new Date(current.endAt).getTime() - new Date(current.startAt).getTime();
      const uniqueSubs = current.subs.size;
      const severity = deriveSeverity(current.count, uniqueSubs, durationMs);

      const resolvedAt =
        nowMs - new Date(current.endAt).getTime() >= resolveMs
          ? new Date(new Date(current.endAt).getTime() + resolveMs).toISOString()
          : null;

      incidents.push({
        id: `${current.endAt}|${current.latestRun.id}`,
        startAt: current.startAt,
        endAt: current.endAt,
        count: current.count,
        subscriptionIds: Array.from(current.subs),
        latestRun: current.latestRun,
        latestError: current.latestError,
        severity,
        resolvedAt,
      });

      current = {
        startAt: r.ran_at,
        endAt: r.ran_at,
        count: 1,
        subs: new Set([r.subscription_id]),
        latestRun: r,
        latestError: errMsg,
        lastTs: ts,
      };
    }
  }

  if (current) {
    const durationMs = new Date(current.endAt).getTime() - new Date(current.startAt).getTime();
    const uniqueSubs = current.subs.size;
    const severity = deriveSeverity(current.count, uniqueSubs, durationMs);

    const resolvedAt =
      nowMs - new Date(current.endAt).getTime() >= resolveMs
        ? new Date(new Date(current.endAt).getTime() + resolveMs).toISOString()
        : null;

    incidents.push({
      id: `${current.endAt}|${current.latestRun.id}`,
      startAt: current.startAt,
      endAt: current.endAt,
      count: current.count,
      subscriptionIds: Array.from(current.subs),
      latestRun: current.latestRun,
      latestError: current.latestError,
      severity,
      resolvedAt,
    });
  }

  // newest incident first (already)
  return incidents;
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => null);
}

export default function WarRoom() {
  const [mode, setMode] = useState<Mode>("tail");
  const [status, setStatus] = useState<"" | "sent" | "skipped" | "error">("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [pollMs, setPollMs] = useState(1500);

  const [live, setLive] = useState(true);
  const [runs, setRuns] = useState<ReminderRun[]>([]);
  const [selected, setSelected] = useState<ReminderRun | null>(null);

  const [busy, setBusy] = useState(false);
  const [chaosBusy, setChaosBusy] = useState(false);
  const [alarmOn, setAlarmOn] = useState(false);

  // Institutional knobs
  const GAP_MS = 2 * 60_000;
  const RESOLVE_MS = 5 * 60_000;

  const [redAlert, setRedAlert] = useState(false);
  const redAlertTimerRef = useRef<any>(null);

  const [timeWindow, setTimeWindow] = useState<TimeWindow>("5m");
  const [leftTab, setLeftTab] = useState<"feed" | "incidents">("feed");
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerIncident, setDrawerIncident] = useState<any>(null); // hydrated incident

  // Meta hydration cache
  const [incidentMetaById, setIncidentMetaById] = useState<Record<string, any>>({});
  const syncTimerRef = useRef<any>(null);

  const lastFetchAtRef = useRef<number>(0);
  const lastSeenIdRef = useRef<string | null>(null);

  // Read mode from query param once
  useEffect(() => {
    const url = new URL(window.location.href);
    const m = url.searchParams.get("mode");
    if (m === "tail" || m === "grafana" || m === "movie") setMode(m);
     
  }, []);

  function setModeAndUrl(m: Mode) {
    setMode(m);
    const u = new URL(window.location.href);
    u.searchParams.set("mode", m);
    window.history.replaceState(null, "", u.toString());
  }

  const sinceIso = useMemo(() => nowMinusWindowIso(timeWindow), [timeWindow]);

  async function fetchRunsSnapshot() {
    const params = new URLSearchParams();
    params.set("limit", String(clampInt(200, 25, 200)));
    if (status) params.set("status", status);
    if (subscriptionId.trim()) params.set("subscription_id", subscriptionId.trim());
    if (sinceIso) params.set("since", sinceIso);

    const res = await fetch(`/api/admin/reminders/runs?${params.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!json?.ok) return;

    const next = (json.runs ?? []) as ReminderRun[];
    setRuns(next);

    const top = next[0] || null;
    lastSeenIdRef.current = top?.id ?? lastSeenIdRef.current;
    lastFetchAtRef.current = Date.now();

    if (selected) {
      const found = next.find((r) => r.id === selected.id);
      if (found) setSelected(found);
    }
  }

  // LIVE STREAM
  const { streamStatus } = useRunsStream({
    enabled: live,
    status,
    subscriptionId,
    onRun: (run) => {
      // Enforce time window client-side too
      if (sinceIso) {
        const cutoff = new Date(sinceIso).getTime();
        const ts = new Date(run.ran_at).getTime();
        if (ts < cutoff) return;
      }

      setRuns((prev) => {
        if (prev.some((x) => x.id === run.id)) return prev;

        // Cinematic red alert on new error
        if (mode === "movie" && run.status === "error" && run.id !== lastSeenIdRef.current) {
          if (alarmOn) beep();
          setRedAlert(true);
          if (redAlertTimerRef.current) clearTimeout(redAlertTimerRef.current);
          redAlertTimerRef.current = setTimeout(() => setRedAlert(false), 1300);
        }

        lastSeenIdRef.current = run.id;
        lastFetchAtRef.current = Date.now();

        const max = 200;
        return [run, ...prev].slice(0, max);
      });

      // Auto-focus newest error in movie mode
      if (mode === "movie" && run.status === "error") {
        setSelected(run);
        setLeftTab("feed");
      }

      if (selected?.id === run.id) setSelected(run);
    },
  });

  // Boot snapshot
  useEffect(() => {
    fetchRunsSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snapshot on filter/mode/window changes
  useEffect(() => {
    fetchRunsSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, subscriptionId, mode, sinceIso]);

  // Poll fallback when live off
  useEffect(() => {
    if (live) return;
    const t = setInterval(fetchRunsSnapshot, pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, pollMs, status, subscriptionId, mode, sinceIso]);

  async function tickNow() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/reminders/tick?limit=50`, { method: "POST" });
      await res.json().catch(() => null);
      await fetchRunsSnapshot();
    } finally {
      setBusy(false);
    }
  }

  async function chaosTest() {
    setChaosBusy(true);
    try {
      const n = 8;
      await Promise.all(
        Array.from({ length: n }).map(() =>
          fetch(`/api/admin/reminders/tick?limit=80`, { method: "POST" }).then((r) => r.json().catch(() => null))
        )
      );
      await fetchRunsSnapshot();
    } finally {
      setChaosBusy(false);
    }
  }

  const computedIncidents = useMemo(() => buildIncidents(runs, { gapMs: GAP_MS, resolveMs: RESOLVE_MS }), [runs]);

  // Institutional hydration: merge computed + meta
  const incidents: any[] = useMemo(() => {
    return computedIncidents.map((i) => {
      const meta = incidentMetaById[i.id] || {};
      return {
        ...i,
        // meta fields from DB
        acknowledged_at: meta.acknowledged_at ?? null,
        acknowledged_by: meta.acknowledged_by ?? null,
        notes: meta.notes ?? "",
        last_action_at: meta.last_action_at ?? null,
        last_action: meta.last_action ?? null,
        // status from DB if present, else computed from resolvedAt
        status: meta.status ?? (i.resolvedAt ? "resolved" : "open"),
      };
    });
  }, [computedIncidents, incidentMetaById]);

  const selectedIncident = useMemo(
    () => incidents.find((i) => i.id === selectedIncidentId) || null,
    [incidents, selectedIncidentId]
  );

  const runsInIncident = useMemo(() => {
    if (!drawerIncident) return [];
    const startMs = new Date(drawerIncident.startAt).getTime();
    const endMs = new Date(drawerIncident.endAt).getTime();
    return runs
      .filter((r) => r.status === "error")
      .filter((r) => {
        const ts = new Date(r.ran_at).getTime();
        return ts >= startMs && ts <= endMs;
      })
      .sort((a, b) => new Date(b.ran_at).getTime() - new Date(a.ran_at).getTime());
  }, [drawerIncident, runs]);

  // Auto-select first incident in incident tab
  useEffect(() => {
    if (leftTab !== "incidents") return;
    if (selectedIncidentId) return;
    if (incidents.length > 0) setSelectedIncidentId(incidents[0].id);
  }, [leftTab, selectedIncidentId, incidents]);

  // Sync + meta fetch (debounced) whenever incidents change
  useEffect(() => {
    if (incidents.length === 0) return;

    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(async () => {
      const payload = incidents.map((i) => ({
        id: i.id,
        source: "reminders",
        severity: i.severity,
        status: i.resolvedAt ? "resolved" : "open",
        started_at: i.startAt,
        ended_at: i.endAt,
        resolved_at: i.resolvedAt ?? null,
        error_count: i.count,
        unique_subscriptions: i.subscriptionIds.length,
        subscription_ids: i.subscriptionIds,
        latest_run_id: i.latestRun?.id ?? null,
        latest_error: i.latestError ?? null,
      }));

      await postJson("/api/admin/reminders/incidents/sync", { incidents: payload });

      const ids = incidents.map((i) => i.id);
      const metaRes = await postJson("/api/admin/reminders/incidents/meta", { ids });

      if (metaRes?.ok && Array.isArray(metaRes.meta)) {
        const next: Record<string, any> = {};
        for (const row of metaRes.meta) next[String(row.id)] = row;
        setIncidentMetaById(next);
      }
    }, 350);

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [computedIncidents]); // sync based on computed shape, not meta

  function openIncidentDrawer(inc: any) {
    setSelectedIncidentId(inc.id);
    setSelected(inc.latestRun);
    setDrawerIncident(inc);
    setDrawerOpen(true);
  }

  // When meta updates, keep drawer incident hydrated
  useEffect(() => {
    if (!drawerIncident) return;
    const meta = incidentMetaById[drawerIncident.id];
    if (!meta) return;
    setDrawerIncident((prev: any) => ({ ...prev, ...meta }));
  }, [incidentMetaById, drawerIncident?.id]);

  // Keyboard shortcuts (Cinematic)
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if (e.key === "Escape") {
        setSelected(null);
        setSelectedIncidentId(null);
        setDrawerOpen(false);
        return;
      }

      // Time window
      if (e.key === "1") { setTimeWindow("1m"); return; }
      if (e.key === "2") { setTimeWindow("5m"); return; }
      if (e.key === "3") { setTimeWindow("1h"); return; }
      if (e.key === "4") { setTimeWindow("24h"); return; }
      if (e.key === "0") { setTimeWindow("all"); return; }

      if (e.key === "l" || e.key === "L") { setLive((v) => !v); return; }
      if (e.key === "a" || e.key === "A") { setStatus(""); return; }
      if (e.key === "e" || e.key === "E") { setStatus("error"); return; }
      if (e.key === "t" || e.key === "T") { if (!busy && !chaosBusy) await tickNow(); return; }
      if (e.key === "c" || e.key === "C") { if (!busy && !chaosBusy) await chaosTest(); return; }

      if (e.key === "i" || e.key === "I") {
        setLeftTab("incidents");
        return;
      }
      if (e.key === "g" || e.key === "G") {
        setLeftTab("feed");
        return;
      }

      // selection nav (feed only)
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (leftTab !== "feed") return;
        if (runs.length === 0) return;
        e.preventDefault();

        const idx = selected ? runs.findIndex((r) => r.id === selected.id) : -1;
        const nextIdx =
          e.key === "ArrowDown"
            ? Math.min(runs.length - 1, idx + 1)
            : Math.max(0, idx === -1 ? 0 : idx - 1);

        setSelected(runs[nextIdx]);
        return;
      }

      if (!selected) return;

      if (e.key === "Enter") {
        window.location.href = `/ops/reminders/subscriptions/${encodeURIComponent(selected.subscription_id)}`;
        return;
      }
      if (e.key === "f" || e.key === "F") {
        await fetch(
          `/api/admin/reminders/tick-one?subscription_id=${encodeURIComponent(selected.subscription_id)}&force=1`,
          { method: "POST" }
        ).then((r) => r.json().catch(() => null));
        return;
      }
      if (e.key === "m" || e.key === "M") {
        await fetch(
          `/api/admin/reminders/subscriptions/${encodeURIComponent(selected.subscription_id)}/mute`,
          { method: "POST" }
        ).then((r) => r.json().catch(() => null));
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, selected, busy, chaosBusy, leftTab]);

  const now = Date.now();
  const lastFetchAgo = lastFetchAtRef.current ? msAgo(now - lastFetchAtRef.current) : "—";

  const kpis = useMemo(() => {
    const window = runs.slice(0, 80);
    let sent = 0, skipped = 0, error = 0;
    for (const r of window) {
      if (r.status === "sent") sent++;
      else if (r.status === "skipped") skipped++;
      else if (r.status === "error") error++;
    }
    return { sent, skipped, error, total: window.length };
  }, [runs]);

  const errorSeries = useMemo(() => {
    const window = runs.slice(0, 24).reverse();
    return window.map((r) => (r.status === "error" ? 1 : 0));
  }, [runs]);

  const sparkPts = useMemo(() => computeSparkline(errorSeries), [errorSeries]);

  const pageBg =
    mode === "movie" ? "bg-slate-950" : mode === "tail" ? "bg-slate-950" : "bg-slate-50";

  const chrome =
    mode === "tail"
      ? "bg-slate-950 text-slate-100 border-slate-800"
      : mode === "movie"
      ? "bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 border-slate-800"
      : "bg-white text-slate-900 border-slate-200";

  const overlay = mode === "movie" && redAlert;

  const lastEventLabel = runs[0]
    ? `Last event: ${runs[0].status.toUpperCase()} · ${new Date(runs[0].ran_at).toLocaleTimeString()}`
    : "No events yet";

  return (
    <div className={`min-h-[calc(100vh-0px)] ${pageBg}`}>
      <CinematicHud
        enabled={mode === "movie"}
        status={status}
        live={live}
        alarmOn={alarmOn}
        onToggleLive={() => setLive((v) => !v)}
        onToggleAlarm={() => setAlarmOn((v) => !v)}
        onSetStatus={setStatus}
        onChaos={chaosTest}
        onTick={tickNow}
        streamStatus={streamStatus}
        lastEventLabel={lastEventLabel}
        timeWindow={timeWindow}
        onSetTimeWindow={setTimeWindow}
        leftTab={leftTab}
        onSetLeftTab={setLeftTab}
      />

      {overlay ? (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div className="absolute inset-0 bg-red-500/10" />
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-red-500/20 to-transparent" />
          <div className="absolute inset-0 animate-pulse bg-red-500/5" />
          <div className="absolute inset-x-0 top-24 flex justify-center">
            <div className="px-4 py-2 rounded-full border border-red-300/40 bg-red-500/20 text-red-100 text-xs font-semibold tracking-[0.2em]">
              RED ALERT · NEW ERROR EVENT
            </div>
          </div>
        </div>
      ) : null}

      <IncidentDrawer
        mode={mode}
        open={drawerOpen}
        incident={drawerIncident}
        runsInIncident={runsInIncident}
        onClose={() => setDrawerOpen(false)}
        onSelectRun={(r) => {
          setSelected(r);
          setLeftTab("feed");
          setDrawerOpen(false);
        }}
        onActionDone={async () => {
          await fetchRunsSnapshot();
          // refresh meta for this incident too
          const metaRes = await postJson("/api/admin/reminders/incidents/meta", { ids: incidents.map((i) => i.id) });
          if (metaRes?.ok && Array.isArray(metaRes.meta)) {
            const next: Record<string, any> = {};
            for (const row of metaRes.meta) next[String(row.id)] = row;
            setIncidentMetaById(next);
          }
        }}
      />

      <div className={`p-6 space-y-4 ${mode === "movie" ? "pt-36" : ""}`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className={`text-2xl font-semibold ${mode === "grafana" ? "text-slate-900" : "text-white"}`}>
              Ops · Reminders War Room
            </div>
            <div className={`${mode === "grafana" ? "text-slate-600" : "text-slate-300"} text-sm`}>
              Institutional mode: persisted incidents + ack + notes + action audit. Window:{" "}
              <span className="font-semibold">{timeWindow}</span>. Last refresh: {lastFetchAgo} ago
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <div className={`rounded-xl border overflow-hidden ${mode === "grafana" ? "bg-white" : "bg-black/30 border-slate-700"}`}>
              {([
                ["tail", "A · Tail-f"],
                ["grafana", "B · Grafana-lite"],
                ["movie", "C · Movie UI"],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setModeAndUrl(k)}
                  className={`px-3 py-2 text-xs font-semibold ${
                    mode === k
                      ? mode === "grafana"
                        ? "bg-slate-900 text-white"
                        : "bg-white/15 text-white"
                      : mode === "grafana"
                      ? "text-slate-700 hover:bg-slate-100"
                      : "text-slate-200 hover:bg-white/10"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode !== "movie" ? (
              <>
                <button
                  onClick={() => setLive((v) => !v)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border ${
                    mode === "grafana"
                      ? "bg-white hover:bg-slate-50 border-slate-200 text-slate-900"
                      : "bg-white/10 hover:bg-white/15 border-slate-700 text-white"
                  }`}
                >
                  Live: {live ? "ON" : "OFF"}
                </button>

                <div className={`rounded-xl border overflow-hidden ${mode === "grafana" ? "bg-white" : "bg-black/30 border-slate-700"}`}>
                  {(["1m", "5m", "1h", "24h", "all"] as TimeWindow[]).map((w) => (
                    <button
                      key={w}
                      onClick={() => setTimeWindow(w)}
                      className={`px-3 py-2 text-xs font-semibold ${
                        timeWindow === w
                          ? mode === "grafana"
                            ? "bg-slate-900 text-white"
                            : "bg-white/15 text-white"
                          : mode === "grafana"
                          ? "text-slate-700 hover:bg-slate-100"
                          : "text-slate-200 hover:bg-white/10"
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>

                <button
                  onClick={tickNow}
                  disabled={busy || chaosBusy}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border ${
                    mode === "grafana"
                      ? "bg-white hover:bg-slate-100 border-slate-200 text-slate-900"
                      : "bg-white/10 hover:bg-white/15 border-slate-700 text-white"
                  } disabled:opacity-50`}
                >
                  {busy ? "Ticking…" : "Tick now"}
                </button>

                <button
                  onClick={chaosTest}
                  disabled={busy || chaosBusy}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border ${
                    mode === "grafana"
                      ? "bg-slate-900 hover:bg-slate-800 border-slate-900 text-white"
                      : "bg-red-500/15 hover:bg-red-500/20 border-red-400/40 text-white"
                  } disabled:opacity-50`}
                >
                  {chaosBusy ? "Chaos…" : "Chaos test"}
                </button>
              </>
            ) : null}
          </div>
        </div>

        {/* Filters */}
        <div className={`rounded-2xl border p-4 ${chrome} ${mode === "grafana" ? "shadow-sm" : ""}`}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className={`text-xs font-semibold ${mode === "grafana" ? "text-slate-700" : "text-slate-200"}`}>
                Status filter
              </div>
              <div className="mt-2 flex gap-2 flex-wrap">
                {(["", "sent", "skipped", "error"] as const).map((s) => (
                  <button
                    key={s || "all"}
                    onClick={() => setStatus(s)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border ${
                      status === s
                        ? mode === "grafana"
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white/15 text-white border-slate-700"
                        : mode === "grafana"
                        ? "bg-white hover:bg-slate-100 border-slate-200 text-slate-900"
                        : "bg-black/20 hover:bg-white/10 border-slate-700 text-slate-200"
                    }`}
                  >
                    {s || "all"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className={`text-xs font-semibold ${mode === "grafana" ? "text-slate-700" : "text-slate-200"}`}>
                Subscription ID (optional)
              </div>
              <input
                value={subscriptionId}
                onChange={(e) => setSubscriptionId(e.target.value)}
                placeholder="uuid…"
                className={`mt-2 w-full px-3 py-2 rounded-xl text-sm border outline-none ${
                  mode === "grafana"
                    ? "bg-white border-slate-200 text-slate-900"
                    : "bg-black/20 border-slate-700 text-white placeholder:text-slate-400"
                }`}
              />
            </div>

            <div>
              <div className={`text-xs font-semibold ${mode === "grafana" ? "text-slate-700" : "text-slate-200"}`}>
                Poll interval (fallback)
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="range"
                  min={500}
                  max={4000}
                  step={250}
                  value={pollMs}
                  onChange={(e) => setPollMs(Number(e.target.value))}
                  className="w-full"
                  disabled={live}
                />
                <div className={`text-xs font-semibold ${mode === "grafana" ? "text-slate-700" : "text-slate-200"}`}>
                  {(pollMs / 1000).toFixed(2)}s
                </div>
              </div>
            </div>
          </div>

          {mode === "grafana" && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl border bg-white p-3">
                <div className="text-xs text-slate-600">Window (top 80)</div>
                <div className="text-2xl font-semibold">{kpis.total}</div>
              </div>
              <div className="rounded-xl border bg-white p-3">
                <div className="text-xs text-slate-600">Sent</div>
                <div className="text-2xl font-semibold">{kpis.sent}</div>
              </div>
              <div className="rounded-xl border bg-white p-3">
                <div className="text-xs text-slate-600">Skipped</div>
                <div className="text-2xl font-semibold">{kpis.skipped}</div>
              </div>
              <div className="rounded-xl border bg-white p-3">
                <div className="text-xs text-slate-600">Errors</div>
                <div className="text-2xl font-semibold">{kpis.error}</div>
              </div>

              <div className="md:col-span-4 rounded-xl border bg-white p-3 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-600">Error sparkline (last 24 runs)</div>
                  <div className="text-sm text-slate-500">1 = error, 0 = ok/skipped</div>
                </div>
                <svg width="120" height="28" viewBox="0 0 120 28" className="overflow-visible">
                  <polyline fill="none" stroke="currentColor" strokeWidth="2" points={sparkPts} className="text-slate-900" />
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {leftTab === "incidents" ? (
            <IncidentTimeline
              mode={mode}
              incidents={incidents as any}
              selectedIncidentId={selectedIncidentId}
              onSelectIncident={openIncidentDrawer}
            />
          ) : (
            <RunFeed
              mode={mode}
              runs={runs}
              selectedId={selected?.id ?? null}
              onSelect={(r) => {
                setSelected(r);
                setSelectedIncidentId(null);
              }}
              onRunActionComplete={fetchRunsSnapshot}
            />
          )}

          <RunDetails mode={mode} run={selected} />
        </div>
      </div>
    </div>
  );
}
