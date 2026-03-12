"use client";

import { useState, useCallback } from "react";

type State = "idle" | "loading" | "ready" | "error";

export default function ClassicSpreadsClient({ dealId }: { dealId: string }) {
  const [state, setState] = useState<State>("idle");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/classic-spread`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      setState("ready");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, [dealId]);

  const download = useCallback(() => {
    if (!pdfUrl) return;
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = `FinancialSpread_${dealId.slice(0, 8)}.pdf`;
    a.click();
  }, [pdfUrl, dealId]);

  return (
    <div className="px-6 py-6 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Classic Banker Spread</h2>
          <p className="text-sm text-white/50 mt-0.5">
            Institutional-format 4-page PDF — Balance Sheet · Income Statement · Ratios · Executive Summary
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state === "ready" && (
            <button
              onClick={download}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
              Download PDF
            </button>
          )}
          <button
            onClick={generate}
            disabled={state === "loading"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              {state === "loading" ? "hourglass_empty" : "table_chart"}
            </span>
            {state === "loading" ? "Generating..." : state === "ready" ? "Regenerate" : "Generate Spread"}
          </button>
        </div>
      </div>

      {/* Error */}
      {state === "error" && error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Idle state — prompt */}
      {state === "idle" && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-white/5 py-24 gap-4">
          <span className="material-symbols-outlined text-white/20" style={{ fontSize: 64 }}>
            table_chart
          </span>
          <p className="text-sm text-white/50">Click Generate Spread to build the institutional-format PDF.</p>
        </div>
      )}

      {/* PDF viewer */}
      {state === "ready" && pdfUrl && (
        <div className="rounded-xl border border-white/10 overflow-hidden" style={{ height: "calc(100vh - 280px)" }}>
          <iframe
            src={pdfUrl}
            className="w-full h-full"
            title="Classic Banker Spread"
          />
        </div>
      )}
    </div>
  );
}
