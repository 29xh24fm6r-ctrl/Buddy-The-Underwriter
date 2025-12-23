"use client";

import { useState } from "react";

export default function GenerateCreditMemoPanel(props: { dealId?: string }) {
  const dealId = props.dealId ?? "DEAL-DEMO-001";

  const [loading, setLoading] = useState(false);
  const [memoHtml, setMemoHtml] = useState<string | null>(null);
  const [action, setAction] = useState<any>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setErr(null);
    setPdfUrl(null);
    try {
      const r = await fetch("/api/ai/credit-memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          overrides: "",
          context: {
            // TODO: wire real deal context here
            page: "Deal Command Center",
          },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Generation failed");

      setMemoHtml(j.memoHtml);
      const gen = (j.actions ?? []).find((a: any) => a.type === "GENERATE_PDF");
      setAction(gen);
    } catch (e: any) {
      setErr(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (!action) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/ai/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, approved: true, action }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Execution failed");

      const url = j?.result?.data?.url;
      if (url) setPdfUrl(url);
      else throw new Error("No PDF URL returned");
    } catch (e: any) {
      setErr(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Advanced Credit Memo Generator</div>
          <div className="text-xs text-gray-600">AI writes the memo + renders a premium PDF.</div>
        </div>
        <div className="text-xs text-gray-500">{loading ? "Working…" : "Ready"}</div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={generate}
          disabled={loading}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Generate Memo
        </button>
        <button
          onClick={apply}
          disabled={loading || !action}
          className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-40"
        >
          Render PDF
        </button>
        {pdfUrl && (
          <a
            className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open PDF
          </a>
        )}
      </div>

      {err && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {memoHtml && (
        <div className="mt-4 rounded-xl border overflow-hidden">
          <div className="px-3 py-2 text-xs text-gray-600 border-b bg-gray-50">
            Preview (HTML)
          </div>
          <iframe
            title="memo-preview"
            className="w-full h-[520px]"
            srcDoc={memoHtml}
          />
        </div>
      )}
    </div>
  );
}
