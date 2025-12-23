"use client";

import { useMemo, useState } from "react";

type PilotResponse = {
  summary: string;
  plan: string[];
  actions: Array<{
    type: string;
    title: string;
    payload: Record<string, any>;
    authority: "TIER_1" | "TIER_2" | "TIER_3";
  }>;
  confidence: number;
  evidence: Array<{ label: string; source: string; note?: string }>;
  warnings: string[];
};

export default function AICommandBar(props: { dealId?: string }) {
  const [intent, setIntent] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PilotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suggested = useMemo(
    () => [
      "Run full underwriting pass and list missing items",
      "What are the top 5 risks and mitigants?",
      "Generate conditions for approval",
      "Compare term sheet vs commitment letter and flag differences",
      "Prepare an IC memo outline",
    ],
    []
  );

  async function run() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const r = await fetch("/api/ai/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIntent: intent,
          dealId: props.dealId ?? null,
          context: {
            // keep this small; later replace with real context from DB
            page: "Command Center",
          },
        }),
      });

      const json = await r.json();
      if (!r.ok) throw new Error(json?.error ?? "Request failed");
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full rounded-2xl border bg-white/60 backdrop-blur p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">AI Command Bar</div>
          <div className="text-xs text-gray-600">
            The Pilot proposes a plan + typed actions (safe, auditable).
          </div>
        </div>
        <div className="text-xs text-gray-500 whitespace-nowrap">
          {loading ? "Thinking…" : "Ready"}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="Ask Buddy AI to run the deal…"
          className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
        />
        <button
          onClick={run}
          disabled={loading || intent.trim().length === 0}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Run
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {suggested.map((s) => (
          <button
            key={s}
            onClick={() => setIntent(s)}
            className="rounded-full border px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && (
        <div className="mt-4 grid gap-3">
          <div className="rounded-2xl border bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Pilot Summary</div>
              <div className="text-xs text-gray-500">
                Confidence: {(data.confidence * 100).toFixed(0)}%
              </div>
            </div>
            <div className="mt-2 text-sm text-gray-800">{data.summary}</div>

            {data.warnings?.length > 0 && (
              <div className="mt-3 rounded-xl border bg-amber-50 p-3 text-xs text-amber-900">
                <div className="font-semibold">Warnings</div>
                <ul className="mt-1 list-disc pl-5">
                  {data.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {data.plan?.length > 0 && (
            <div className="rounded-2xl border bg-white p-4">
              <div className="text-sm font-semibold">Plan</div>
              <ol className="mt-2 list-decimal pl-5 text-sm text-gray-800">
                {data.plan.map((p, i) => (
                  <li key={i} className="py-0.5">
                    {p}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="rounded-2xl border bg-white p-4">
            <div className="text-sm font-semibold">Proposed Actions</div>
            <div className="mt-2 grid gap-2">
              {data.actions?.length === 0 && (
                <div className="text-sm text-gray-600">
                  No actions proposed.
                </div>
              )}

              {data.actions?.map((a, i) => (
                <div
                  key={i}
                  className="rounded-xl border p-3 text-sm flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-semibold">{a.title}</div>
                    <div className="mt-1 text-xs text-gray-600">
                      {a.type} • {a.authority}
                    </div>
                    <pre className="mt-2 overflow-auto rounded-lg bg-gray-50 p-2 text-xs">
                      {JSON.stringify(a.payload ?? {}, null, 2)}
                    </pre>
                  </div>

                  <button
                    className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-gray-50"
                    onClick={async () => {
                      const isTier3 = a.authority === "TIER_3";
                      const approved = isTier3
                        ? window.confirm("This is a TIER_3 action. Approve and execute?")
                        : true;

                      try {
                        const r = await fetch("/api/ai/execute", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            dealId: props.dealId ?? "DEAL-DEMO-001",
                            action: a,
                            approved,
                          }),
                        });

                        const json = await r.json();
                        if (!r.ok) {
                          alert(json?.error ?? "Execution failed");
                          return;
                        }

                        alert(`✅ ${json?.result?.message ?? "Applied"}`);
                      } catch (err: any) {
                        alert(err?.message ?? "Execution error");
                      }
                    }}
                  >
                    Apply
                  </button>
                </div>
              ))}
            </div>
          </div>

          {data.evidence?.length > 0 && (
            <div className="rounded-2xl border bg-white p-4">
              <div className="text-sm font-semibold">Evidence</div>
              <div className="mt-2 grid gap-2">
                {data.evidence.map((e, i) => (
                  <div key={i} className="rounded-xl border p-3 text-xs">
                    <div className="font-semibold">{e.label}</div>
                    <div className="text-gray-600">{e.source}</div>
                    {e.note && <div className="mt-1">{e.note}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
