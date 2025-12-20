"use client";

import { useEffect, useMemo, useState } from "react";

type NextAction = { key: string; label: string; priority: number; reason_rule_keys: string[] };

type EvalResult = {
  ok: true;
  summary: { warns: number; fails: number; infos: number; mitigants_total: number };
  next_actions: NextAction[];
  results: Array<{
    rule_key: string;
    title: string;
    severity: "hard" | "soft" | "info";
    result: "pass" | "fail" | "warn" | "info";
    message: string;
    suggests_exception: boolean;
    mitigants: Array<{ key: string; label: string; priority?: number; note?: string }>;
    evidence: Array<{ page_num: number | null; section: string | null; snippet: string; note: string | null }>;
  }>;
};

type DealMitigant = {
  id: string;
  mitigant_key: string;
  mitigant_label: string;
  reason_rule_keys: string[];
  status: "open" | "satisfied" | "waived";
  satisfied_at: string | null;
  note: string | null;
};

export default function PolicyLensCard({ dealId }: { dealId: string }) {
  const [data, setData] = useState<EvalResult | null>(null);
  const [mitigants, setMitigants] = useState<DealMitigant[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function fetchMitigants() {
    const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/policy/mitigants/list`, { method: "GET" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) return;
    setMitigants(json.items || []);
  }

  async function syncMitigants(actions: NextAction[]) {
    await fetch(`/api/deals/${encodeURIComponent(dealId)}/policy/mitigants/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actions }),
    }).catch(() => null);
  }

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/policy/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: {} }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setErr(json?.error ? `${json.error}${json.detail ? `: ${json.detail}` : ""}` : `http_${res.status}`);
        return;
      }
      setData(json);

      await syncMitigants(json.next_actions || []);
      await fetchMitigants();
    } catch (e: any) {
      setErr(e?.message || "fetch_failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const mitigantMap = useMemo(() => {
    const m = new Map<string, DealMitigant>();
    for (const x of mitigants) m.set(x.mitigant_key, x);
    return m;
  }, [mitigants]);

  const openCount = mitigants.filter(m => m.status === "open").length;
  const satisfiedCount = mitigants.filter(m => m.status === "satisfied").length;

  async function setMitigantStatus(mitigant_key: string, status: "open" | "satisfied" | "waived") {
    await fetch(`/api/deals/${encodeURIComponent(dealId)}/policy/mitigants/set-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mitigant_key, status }),
    });
    await fetchMitigants();
    await run();
  }

  const chip = (txt: string) => (
    <span className="rounded-full border px-2 py-1 text-[11px] font-semibold">{txt}</span>
  );

  const badge = (sev: string) =>
    sev === "hard" ? "bg-red-500/15 text-red-200 border-red-400/30"
    : sev === "soft" ? "bg-yellow-500/15 text-yellow-200 border-yellow-400/30"
    : "bg-white/10 text-slate-200 border-white/15";

  const tone = (res: string) =>
    res === "fail" ? "border-red-300/40"
    : res === "warn" ? "border-yellow-300/40"
    : "border-white/15";

  return (
    <div className="rounded-2xl border p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Policy Lens</div>
          <div className="text-xs text-muted-foreground mt-1">
            Warn + continue with mitigants. Bank-specific + evidence.
          </div>
        </div>

        <button
          onClick={run}
          disabled={busy}
          className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50"
        >
          {busy ? "Running…" : "Re-run"}
        </button>
      </div>

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
          {err}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {chip(`Warns: ${data.summary.warns}`)}
            {chip(`Fails: ${data.summary.fails}`)}
            {chip(`Mitigants: ${data.summary.mitigants_total}`)}
            {chip(`Open: ${openCount}`)}
            {chip(`Satisfied: ${satisfiedCount}`)}
          </div>

          {/* Mitigants checklist */}
          <div className="rounded-2xl border p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-muted-foreground">Mitigants Checklist</div>
              <div className="text-[11px] text-muted-foreground">
                Clear mitigants to reduce warnings.
              </div>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {(data.next_actions || []).length === 0 ? (
                <div className="text-sm text-muted-foreground">No mitigants suggested yet.</div>
              ) : (
                (data.next_actions || []).map((a) => {
                  const state = mitigantMap.get(a.key);
                  const status = state?.status || "open";

                  return (
                    <div key={a.key} className="rounded-xl border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{a.label}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Priority {a.priority} · Triggered by {a.reason_rule_keys.join(", ")}
                          </div>
                          {status !== "open" ? (
                            <div className="mt-2 text-xs font-semibold">
                              Status: {status.toUpperCase()}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex flex-col gap-2">
                          {status !== "satisfied" ? (
                            <button
                              onClick={() => setMitigantStatus(a.key, "satisfied")}
                              className="rounded-lg border px-3 py-2 text-xs font-semibold bg-primary text-primary-foreground"
                            >
                              Satisfy
                            </button>
                          ) : (
                            <button
                              onClick={() => setMitigantStatus(a.key, "open")}
                              className="rounded-lg border px-3 py-2 text-xs font-semibold"
                            >
                              Re-open
                            </button>
                          )}

                          {status !== "waived" ? (
                            <button
                              onClick={() => setMitigantStatus(a.key, "waived")}
                              className="rounded-lg border px-3 py-2 text-xs font-semibold"
                            >
                              Waive
                            </button>
                          ) : (
                            <button
                              onClick={() => setMitigantStatus(a.key, "open")}
                              className="rounded-lg border px-3 py-2 text-xs font-semibold"
                            >
                              Un-waive
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Rule list */}
          <div className="space-y-2">
            {data.results.map((r, idx) => (
              <div key={idx} className={`rounded-xl border p-4 ${tone(r.result)}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{r.title}</div>
                  <span className={`px-2 py-1 rounded-full text-[11px] font-semibold border ${badge(r.severity)}`}>
                    {r.severity.toUpperCase()} · {r.result.toUpperCase()}
                  </span>
                </div>

                <div className="text-sm text-muted-foreground mt-1">{r.message}</div>

                {r.evidence?.length ? (
                  <div className="mt-4 space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground">Policy evidence</div>
                    {r.evidence.slice(0, 2).map((e, j) => (
                      <div key={j} className="rounded-lg border px-3 py-2 text-xs">
                        <div className="text-muted-foreground">
                          {e.section ? `${e.section} · ` : ""}{e.page_num ? `p.${e.page_num}` : ""}
                          {e.note ? ` · ${e.note}` : ""}
                        </div>
                        <div className="mt-1">{e.snippet}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-sm text-muted-foreground">No results yet.</div>
      )}
    </div>
  );
}
