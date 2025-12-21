"use client";

import { useEffect, useMemo, useState } from "react";

type AiEvent = {
  id: string;
  scope: string;
  action: string;
  confidence: number | null;
  requires_human_review: boolean;
  evidence_json: any;
  output_json: any;
  created_at: string;
};

function pct(x: number | null | undefined) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return `${Math.round(x)}%`;
}

export function EvidenceChips(props: {
  dealId: string;
  scope: string;
  action?: string;
  label?: string;
  limit?: number;
}) {
  const { dealId, scope, action, label, limit = 10 } = props;

  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<AiEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const title = useMemo(() => label || "Why Buddy thinks this", [label]);

  useEffect(() => {
    if (!open) return;
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const qs = new URLSearchParams();
        qs.set("scope", scope);
        if (action) qs.set("action", action);
        qs.set("limit", String(limit));
        const r = await fetch(`/api/deals/${dealId}/ai-events?${qs.toString()}`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || "evidence_load_failed");
        if (alive) setEvents(j.events || []);
      } catch (e: any) {
        if (alive) setErr(e?.message || "evidence_load_failed");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, dealId, scope, action, limit]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        title={title}
      >
        <span>✨</span>
        <span>{title}</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute left-1/2 top-1/2 w-[min(860px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <div>
                <div className="text-sm font-semibold text-gray-900">{title}</div>
                <div className="text-xs text-gray-500">
                  Scope: <span className="font-mono">{scope}</span>
                  {action ? (
                    <>
                      {" "}
                      • Action: <span className="font-mono">{action}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-gray-200 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="max-h-[72vh] overflow-auto p-4">
              {loading ? (
                <div className="text-sm text-gray-600">Loading evidence…</div>
              ) : err ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {err}
                </div>
              ) : events.length === 0 ? (
                <div className="text-sm text-gray-600">
                  No AI evidence logged yet for this scope/action.
                </div>
              ) : (
                <div className="space-y-3">
                  {events.map((ev) => (
                    <div key={ev.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-gray-700">
                          <span className="font-mono">{ev.scope}</span> •{" "}
                          <span className="font-mono">{ev.action}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-gray-700">
                            Confidence {pct(ev.confidence)}
                          </span>
                          {ev.requires_human_review ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                              Human review
                            </span>
                          ) : (
                            <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-green-800">
                              Auto-safe
                            </span>
                          )}
                        </div>
                      </div>

                      {ev.evidence_json ? (
                        <pre className="mt-2 overflow-auto rounded-md bg-white p-2 text-[11px] text-gray-800">
{JSON.stringify(ev.evidence_json, null, 2)}
                        </pre>
                      ) : null}

                      {ev.output_json ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-gray-700">
                            View AI output
                          </summary>
                          <pre className="mt-2 overflow-auto rounded-md bg-white p-2 text-[11px] text-gray-800">
{JSON.stringify(ev.output_json, null, 2)}
                          </pre>
                        </details>
                      ) : null}

                      <div className="mt-2 text-[11px] text-gray-500">
                        {new Date(ev.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-gray-200 p-4 text-[11px] text-gray-500">
              Evidence is pulled from <span className="font-mono">ai_events</span>. This is your institutional audit log.
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
