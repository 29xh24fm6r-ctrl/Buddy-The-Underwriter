"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

type ProgressResponse = {
  ok?: boolean;
  received_count?: number;
  total_checklist?: number;
  checklist?: { required: number; received_required: number };
};

type ContextResponse = {
  ok?: boolean;
  risk?: { score?: number | null };
  borrower?: { name?: string | null };
  stage?: string | null;
};

type TimelineEvent = {
  event_key: string;
  ui_state: "working" | "waiting" | "done";
  ui_message: string;
  created_at: string;
};

type TimelineResponse = {
  ok: boolean;
  events?: TimelineEvent[];
};

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as T | null;
    if (!res.ok) return json;
    return json;
  } catch {
    return null;
  }
}

function formatRelative(iso: string | null | undefined, nowMs: number) {
  if (!iso || !nowMs) return "—";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "—";
  const diffMs = nowMs - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function riskBand(score: number | null | undefined) {
  if (score == null || Number.isNaN(score)) {
    return { label: "Unknown", tone: "neutral" as const };
  }
  if (score >= 70) return { label: "High", tone: "red" as const };
  if (score >= 40) return { label: "Medium", tone: "amber" as const };
  return { label: "Low", tone: "emerald" as const };
}

function toneClasses(tone: "neutral" | "emerald" | "amber" | "red") {
  if (tone === "emerald") return "bg-emerald-50 text-emerald-900 border-emerald-200";
  if (tone === "amber") return "bg-amber-50 text-amber-900 border-amber-200";
  if (tone === "red") return "bg-red-50 text-red-900 border-red-200";
  return "bg-neutral-50 text-neutral-700 border-neutral-200";
}

function eventIcon(eventKey: string) {
  const key = String(eventKey || "").toLowerCase();
  if (key.includes("upload")) return "cloud_upload";
  if (key.includes("doc")) return "description";
  if (key.includes("checklist")) return "checklist";
  if (key.includes("seed")) return "auto_awesome";
  if (key.includes("ocr")) return "file";
  if (key.includes("risk")) return "pending";
  if (key.includes("readiness")) return "event";
  if (key.includes("underwrite")) return "rocket_launch";
  return "event";
}

function stateDot(uiState: TimelineEvent["ui_state"]) {
  if (uiState === "working") return "bg-blue-400";
  if (uiState === "waiting") return "bg-amber-400";
  return "bg-emerald-400";
}

export function DealCockpitInsights({ dealId }: { dealId: string }) {
  const [progress, setProgress] = React.useState<ProgressResponse | null>(null);
  const [context, setContext] = React.useState<ContextResponse | null>(null);
  const [timeline, setTimeline] = React.useState<TimelineEvent[]>([]);
  const [nowMs, setNowMs] = React.useState(0);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      const [progressRes, contextRes, timelineRes] = await Promise.all([
        fetchJson<ProgressResponse>(`/api/deals/${dealId}/progress`),
        fetchJson<ContextResponse>(`/api/deals/${dealId}/context`),
        fetchJson<TimelineResponse>(`/api/deals/${dealId}/pipeline/timeline?limit=12`),
      ]);

      if (!mounted) return;
      setProgress(progressRes ?? null);
      setContext(contextRes ?? null);
      setTimeline(timelineRes?.events ?? []);
    })();

    return () => {
      mounted = false;
    };
  }, [dealId]);

  React.useEffect(() => {
    setNowMs(Date.now());
  }, [timeline]);

  const required =
    progress?.checklist?.required ?? progress?.total_checklist ?? 0;
  const received =
    progress?.checklist?.received_required ?? progress?.received_count ?? 0;

  const checklistPct = required > 0 ? Math.round((received / required) * 100) : 0;

  const riskScore = context?.risk?.score ?? null;
  const risk = riskBand(typeof riskScore === "number" ? riskScore : null);

  const lastEvent = timeline.length ? timeline[timeline.length - 1] : null;

  const recentCount24 = timeline.filter((e) => {
    const ts = new Date(e.created_at).getTime();
    return Number.isFinite(ts) && nowMs > 0 && nowMs - ts <= 24 * 60 * 60 * 1000;
  }).length;

  const recentCount48 = timeline.filter((e) => {
    const ts = new Date(e.created_at).getTime();
    return Number.isFinite(ts) && nowMs > 0 && nowMs - ts <= 48 * 60 * 60 * 1000;
  }).length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm p-4">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="fact_check" className="h-5 w-5 text-neutral-900" />
          <h3 className="text-sm font-semibold">Deal Health</h3>
          {context?.stage ? (
            <span className="text-xs text-neutral-500">• {context.stage}</span>
          ) : null}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border border-neutral-200 p-3">
            <div className="text-xs text-neutral-500">Checklist completion</div>
            <div className="mt-2 flex items-baseline gap-2">
              <div className="text-2xl font-semibold text-neutral-900">{checklistPct}%</div>
              <div className="text-xs text-neutral-500">
                {received} / {required}
              </div>
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-neutral-100">
              <div
                className="h-2 rounded-full bg-neutral-900 transition-all"
                style={{ width: `${checklistPct}%` }}
              />
            </div>
          </div>

          <div className={`rounded-lg border p-3 ${toneClasses(risk.tone)}`}>
            <div className="text-xs">Risk indicator</div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xl font-semibold">{risk.label}</span>
              {typeof riskScore === "number" ? (
                <span className="text-xs">Score {Math.round(riskScore)}</span>
              ) : null}
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-white/70">
              <div
                className="h-2 rounded-full"
                style={{
                  width: `${Math.min(Math.max(Math.round(riskScore ?? 0), 0), 100)}%`,
                  backgroundColor:
                    risk.tone === "red"
                      ? "#ef4444"
                      : risk.tone === "amber"
                        ? "#f59e0b"
                        : risk.tone === "emerald"
                          ? "#10b981"
                          : "#a3a3a3",
                }}
              />
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200 p-3">
            <div className="text-xs text-neutral-500">Recent activity</div>
            <div className="mt-2 text-sm font-semibold text-neutral-900">
              {recentCount24} events (24h)
            </div>
            <div className="text-xs text-neutral-500">
              {recentCount48} events (48h) • last {formatRelative(lastEvent?.created_at, nowMs)}
            </div>
            {lastEvent?.ui_message ? (
              <div className="mt-2 text-xs text-neutral-600 line-clamp-2">
                “{lastEvent.ui_message}”
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-neutral-200 bg-white shadow-sm p-4">
          <div className="flex items-center gap-2 mb-4">
            <Icon name="history" className="h-5 w-5 text-neutral-900" />
            <h3 className="text-sm font-semibold">Activity timeline</h3>
          </div>

          {timeline.length === 0 ? (
            <div className="text-sm text-neutral-500">No ledger activity yet.</div>
          ) : (
            <ul className="space-y-3">
              {timeline.slice(-8).map((event) => (
                <li key={`${event.event_key}-${event.created_at}`} className="flex items-start gap-3">
                  <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50">
                    <Icon name={eventIcon(event.event_key)} className="h-4 w-4 text-neutral-700" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-neutral-900">
                      <span>{event.ui_message || event.event_key}</span>
                      <span className={`h-2 w-2 rounded-full ${stateDot(event.ui_state)}`} />
                    </div>
                    <div className="text-xs text-neutral-500">
                      {formatRelative(event.created_at, nowMs)} • {new Date(event.created_at).toLocaleString()}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white shadow-sm p-4">
          <div className="flex items-center gap-2 mb-4">
            <Icon name="fact_check" className="h-5 w-5 text-neutral-900" />
            <h3 className="text-sm font-semibold">Documents progress</h3>
          </div>

          <div className="text-xs text-neutral-500">Required vs received</div>
          <div className="mt-3 flex items-baseline gap-2">
            <div className="text-2xl font-semibold text-neutral-900">{received}</div>
            <div className="text-xs text-neutral-500">/ {required} required</div>
          </div>

          <div className="mt-3 h-3 w-full rounded-full bg-neutral-100">
            <div
              className="h-3 rounded-full bg-emerald-600 transition-all"
              style={{ width: `${required > 0 ? Math.round((received / required) * 100) : 0}%` }}
            />
          </div>

          <div className="mt-2 text-xs text-neutral-500">
            {required > 0
              ? `${checklistPct}% of required checklist items received`
              : "Checklist not seeded yet"}
          </div>
        </div>
      </div>
    </div>
  );
}
