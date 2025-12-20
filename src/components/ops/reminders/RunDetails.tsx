// src/components/ops/reminders/RunDetails.tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReminderRun } from "@/components/ops/reminders/RunFeed";

type Mode = "tail" | "grafana" | "movie";

function pretty(obj: any) {
  try {
    return JSON.stringify(obj ?? null, null, 2);
  } catch {
    return String(obj);
  }
}

function shortTs(ts: string | null) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function RunDetails({ mode, run }: { mode: Mode; run: ReminderRun | null }) {
  const [busy, setBusy] = useState<null | "copy" | "tick" | "mute">(null);
  const [toast, setToast] = useState<string | null>(null);

  const chrome =
    mode === "grafana"
      ? "bg-white text-slate-900 border-slate-200 shadow-sm"
      : "bg-black/20 text-white border-slate-800";

  const subTone = mode === "grafana" ? "text-slate-600" : "text-slate-300";
  const meta = useMemo(() => pretty(run?.meta), [run]);

  async function doCopy() {
    if (!run) return;
    setBusy("copy");
    const ok = await copyToClipboard(run.subscription_id);
    setBusy(null);
    setToast(ok ? "Copied subscription_id" : "Copy failed");
    setTimeout(() => setToast(null), 1200);
  }

  async function doTickOne() {
    if (!run) return;
    setBusy("tick");
    try {
      const res = await fetch(
        `/api/admin/reminders/tick-one?subscription_id=${encodeURIComponent(run.subscription_id)}&force=1`,
        { method: "POST" }
      );
      const json = await res.json().catch(() => null);
      setToast(json?.ok ? "Force-run fired" : "Force-run failed");
    } catch {
      setToast("Force-run failed");
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), 1400);
    }
  }

  async function doMute() {
    if (!run) return;
    setBusy("mute");
    try {
      const res = await fetch(
        `/api/admin/reminders/subscriptions/${encodeURIComponent(run.subscription_id)}/mute`,
        { method: "POST" }
      );
      const json = await res.json().catch(() => null);
      setToast(json?.ok ? "Muted (active=false)" : "Mute failed");
    } catch {
      setToast("Mute failed");
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), 1400);
    }
  }

  const btnBase =
    "px-3 py-2 rounded-xl text-xs font-semibold border disabled:opacity-50";

  const btnLight =
    mode === "grafana"
      ? "bg-white hover:bg-slate-50 border-slate-200 text-slate-900"
      : "bg-white/10 hover:bg-white/15 border-slate-700 text-white";

  const btnDanger =
    mode === "grafana"
      ? "bg-red-600 hover:bg-red-700 border-red-700 text-white"
      : "bg-red-500/20 hover:bg-red-500/25 border-red-400/40 text-white";

  const btnPrimary =
    mode === "grafana"
      ? "bg-slate-900 hover:bg-slate-800 border-slate-900 text-white"
      : "bg-white/15 hover:bg-white/20 border-slate-600 text-white";

  return (
    <div className={`rounded-2xl border p-4 ${chrome}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Replay</div>
          <div className={`text-sm ${subTone}`}>Inspect + control this subscription</div>
        </div>

        {toast ? (
          <div
            className={`px-3 py-1 rounded-full border text-xs font-semibold ${
              mode === "grafana"
                ? "bg-slate-50 border-slate-200 text-slate-700"
                : "bg-black/30 border-slate-700 text-slate-200"
            }`}
          >
            {toast}
          </div>
        ) : null}
      </div>

      {!run ? (
        <div className={`mt-4 text-sm ${subTone}`}>Select an event from the feed.</div>
      ) : (
        <div className="mt-4 space-y-3">
          {/* Action bar */}
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/ops/reminders/subscriptions/${encodeURIComponent(run.subscription_id)}`}
              className={`${btnBase} ${btnPrimary}`}
            >
              Open Subscription
            </Link>

            <button
              onClick={doTickOne}
              disabled={busy !== null}
              className={`${btnBase} ${btnLight}`}
              title="Force-run this one subscription (safe: idempotent)."
            >
              {busy === "tick" ? "Running…" : "Force-run"}
            </button>

            <button
              onClick={doMute}
              disabled={busy !== null}
              className={`${btnBase} ${btnDanger}`}
              title="Set active=false."
            >
              {busy === "mute" ? "Muting…" : "Mute"}
            </button>

            <button
              onClick={doCopy}
              disabled={busy !== null}
              className={`${btnBase} ${btnLight}`}
              title="Copy subscription_id"
            >
              {busy === "copy" ? "Copying…" : "Copy ID"}
            </button>
          </div>

          {/* Info cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className={`rounded-xl border p-3 ${mode === "grafana" ? "border-slate-200" : "border-slate-800"}`}>
              <div className={`text-xs font-semibold ${subTone}`}>Run</div>
              <div className="mt-1 text-sm font-semibold break-all">{run.id}</div>
              <div className={`mt-1 text-sm ${subTone}`}>status: {run.status}</div>
            </div>

            <div className={`rounded-xl border p-3 ${mode === "grafana" ? "border-slate-200" : "border-slate-800"}`}>
              <div className={`text-xs font-semibold ${subTone}`}>Subscription</div>
              <div className="mt-1 text-sm font-semibold break-all">{run.subscription_id}</div>
              <div className={`mt-1 text-sm ${subTone}`}>due_at: {shortTs(run.due_at)}</div>
            </div>

            <div className={`rounded-xl border p-3 ${mode === "grafana" ? "border-slate-200" : "border-slate-800"}`}>
              <div className={`text-xs font-semibold ${subTone}`}>Timing</div>
              <div className="mt-1 text-sm font-semibold">ran_at: {shortTs(run.ran_at)}</div>
            </div>

            <div className={`rounded-xl border p-3 ${mode === "grafana" ? "border-slate-200" : "border-slate-800"}`}>
              <div className={`text-xs font-semibold ${subTone}`}>Error</div>
              <div
                className={`mt-1 text-sm ${
                  run.error ? (mode === "grafana" ? "text-red-700" : "text-red-200") : subTone
                }`}
              >
                {run.error || "—"}
              </div>
            </div>
          </div>

          {/* Meta */}
          <div className={`rounded-2xl border p-3 ${mode === "grafana" ? "border-slate-200 bg-slate-50" : "border-slate-800 bg-black/30"}`}>
            <div className={`text-xs font-semibold ${subTone}`}>meta (json)</div>
            <pre className={`mt-2 text-xs overflow-auto p-3 rounded-xl ${mode === "grafana" ? "bg-white border border-slate-200" : "bg-black/40 border border-slate-800"}`}>
              {meta}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
