// src/components/ops/reminders/IncidentDrawer.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReminderRun } from "@/components/ops/reminders/RunFeed";
import type { Incident } from "@/components/ops/reminders/IncidentTimeline";

type Mode = "tail" | "grafana" | "movie";

function shortId(id: string) {
  if (!id) return "";
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function fmt(ts: string) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => null);
}

export default function IncidentDrawer({
  mode,
  open,
  incident,
  runsInIncident,
  onClose,
  onSelectRun,
  onActionDone,
}: {
  mode: Mode;
  open: boolean;
  incident: Incident | null;
  runsInIncident: ReminderRun[];
  onClose: () => void;
  onSelectRun: (r: ReminderRun) => void;
  onActionDone: () => void;
}) {
  const [notes, setNotes] = useState<string>("");
  const [ack, setAck] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!incident) return;
    setNotes((incident as any).notes || "");
    setAck(Boolean((incident as any).acknowledged_at));
  }, [incident]);

  if (!open || !incident) return null;

  const chrome =
    mode === "grafana"
      ? "bg-white text-slate-900 border-slate-200"
      : "bg-slate-950 text-white border-slate-800";

  const subTone = mode === "grafana" ? "text-slate-600" : "text-slate-300";

  const subs = incident.subscriptionIds;

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Panel */}
      <div className={`absolute right-0 top-0 h-full w-full max-w-xl border-l ${chrome} shadow-2xl`}>
        <div className="p-5 flex items-start justify-between gap-3 border-b border-white/10">
          <div>
            <div className="text-lg font-semibold flex items-center gap-2">
              <span className="px-2 py-1 rounded-full text-[11px] font-semibold border bg-red-500/15 text-red-200 border-red-400/30">
                {incident.severity}
              </span>
              Incident
              {(incident as any).resolvedAt ? (
                <span className="px-2 py-1 rounded-full text-[11px] font-semibold border bg-green-500/15 text-green-100 border-green-400/30">
                  RESOLVED
                </span>
              ) : null}
              {ack ? (
                <span className="px-2 py-1 rounded-full text-[11px] font-semibold border bg-white/10 text-slate-200 border-white/15">
                  ACK'D
                </span>
              ) : null}
            </div>
            <div className={`text-sm ${subTone} mt-1`}>
              {fmt(incident.startAt)} → {fmt(incident.endAt)}
              {(incident as any).resolvedAt ? ` · resolved @ ${fmt((incident as any).resolvedAt)}` : ""}
            </div>
            <div className="mt-2 text-sm text-red-200">
              latest: {incident.latestError || "unknown error"}
            </div>
            {(incident as any).last_action ? (
              <div className={`mt-2 text-sm ${subTone}`}>
                last action: <span className="font-semibold">{(incident as any).last_action}</span>
                {(incident as any).last_action_at ? ` @ ${fmt((incident as any).last_action_at)}` : ""}
              </div>
            ) : null}
          </div>

          <button
            onClick={onClose}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border ${
              mode === "grafana"
                ? "bg-white hover:bg-slate-50 border-slate-200 text-slate-900"
                : "bg-white/10 hover:bg-white/15 border-slate-700 text-white"
            }`}
          >
            Close
          </button>
        </div>

        {/* Ack + Notes */}
        <div className="p-5 border-b border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className={`text-xs font-semibold ${subTone}`}>Acknowledgement</div>
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  const nextAck = !ack;
                  setAck(nextAck);
                  await postJson("/api/admin/reminders/incidents/ack", { id: incident.id, ack: nextAck });
                  onActionDone();
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border disabled:opacity-50 ${
                ack
                  ? "border-green-400/40 bg-green-500/15 hover:bg-green-500/20 text-white"
                  : "border-white/15 bg-white/10 hover:bg-white/15 text-white"
              }`}
            >
              {ack ? "Unack" : "Ack"}
            </button>
          </div>

          <div>
            <div className={`text-xs font-semibold ${subTone}`}>Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What happened? What did we do? Next steps?"
              className={`mt-2 w-full min-h-[90px] px-3 py-2 rounded-xl text-sm border outline-none ${
                mode === "grafana"
                  ? "bg-white border-slate-200 text-slate-900"
                  : "bg-black/20 border-slate-700 text-white placeholder:text-slate-400"
              }`}
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={async () => {
                  setSaving(true);
                  try {
                    await postJson("/api/admin/reminders/incidents/notes", { id: incident.id, notes });
                    onActionDone();
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                className="px-3 py-2 rounded-xl text-xs font-semibold border border-white/15 bg-white/10 hover:bg-white/15 text-white disabled:opacity-50"
              >
                Save Notes
              </button>
              <button
                onClick={async () => {
                  setSaving(true);
                  try {
                    setNotes("");
                    await postJson("/api/admin/reminders/incidents/notes", { id: incident.id, notes: "" });
                    onActionDone();
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                className="px-3 py-2 rounded-xl text-xs font-semibold border border-white/15 bg-white/10 hover:bg-white/15 text-white disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-5 border-b border-white/10">
          <div className={`text-xs font-semibold ${subTone}`}>Actions</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={async () => {
                await postJson("/api/admin/reminders/incidents/action", {
                  incident_id: incident.id,
                  action: "mute",
                  subscription_ids: subs,
                  concurrency: 3,
                  throttle_ms: 80,
                });
                onActionDone();
              }}
              className="px-3 py-2 rounded-xl text-xs font-semibold border border-red-400/40 bg-red-500/20 hover:bg-red-500/25 text-white"
              title="Sets active=false for all impacted subscriptions"
            >
              Mute All ({subs.length})
            </button>

            <button
              onClick={async () => {
                await postJson("/api/admin/reminders/incidents/action", {
                  incident_id: incident.id,
                  action: "force_run",
                  subscription_ids: subs,
                  concurrency: 3,
                  throttle_ms: 120,
                });
                onActionDone();
              }}
              className="px-3 py-2 rounded-xl text-xs font-semibold border border-white/15 bg-white/10 hover:bg-white/15 text-white"
              title="Advances schedules + writes audit runs"
            >
              Force-run All ({subs.length})
            </button>
          </div>
        </div>

        {/* Impacted subs */}
        <div className="p-5 border-b border-white/10">
          <div className={`text-xs font-semibold ${subTone}`}>Impacted subscriptions</div>
          <div className="mt-2 grid grid-cols-1 gap-2 max-h-[140px] overflow-auto pr-1">
            {subs.map((id) => (
              <Link
                key={id}
                href={`/ops/reminders/subscriptions/${encodeURIComponent(id)}`}
                className={`rounded-xl border px-3 py-2 text-sm ${
                  mode === "grafana"
                    ? "border-slate-200 bg-white hover:bg-slate-50 text-slate-900"
                    : "border-slate-800 bg-black/20 hover:bg-white/5 text-white"
                }`}
              >
                {shortId(id)}
              </Link>
            ))}
          </div>
        </div>

        {/* Runs list */}
        <div className="p-5">
          <div className={`text-xs font-semibold ${subTone}`}>Error runs in this incident</div>
          <div className="mt-2 space-y-2 max-h-[calc(100vh-520px)] overflow-auto pr-1">
            {runsInIncident.length === 0 ? (
              <div className={`text-sm ${subTone}`}>No runs found.</div>
            ) : (
              runsInIncident.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onSelectRun(r)}
                  className={`w-full text-left rounded-xl border px-3 py-2 ${
                    mode === "grafana"
                      ? "border-slate-200 bg-white hover:bg-slate-50"
                      : "border-slate-800 bg-black/20 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">
                      {fmt(r.ran_at)}
                    </div>
                    <div className={`text-xs ${subTone}`}>{shortId(r.id)}</div>
                  </div>
                  <div className={`text-sm ${subTone} mt-1`}>
                    sub: {shortId(r.subscription_id)}
                  </div>
                  {r.error ? <div className="text-sm text-red-200 mt-1">{r.error}</div> : null}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
