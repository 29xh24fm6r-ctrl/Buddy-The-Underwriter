"use client";

import { useState } from "react";

type SynthesisResponse = {
  ok: boolean;
  factsWritten?: number;
  factsSkipped?: number;
  missing?: string[];
  warnings?: string[];
  readinessStatus?: string;
  error?: string;
  detail?: string;
};

export default function RunSynthesisButton({ dealId }: { dealId: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SynthesisResponse | null>(null);

  async function handleClick() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/underwriting-synthesis/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data: SynthesisResponse = await res.json();
      setResult(data);
      if (data.ok) {
        // Reload to reflect newly written facts in memo/readiness
        window.location.reload();
      }
    } catch {
      setResult({ ok: false, error: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        onClick={handleClick}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
      >
        {loading ? (
          <>
            <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
            Running Synthesis…
          </>
        ) : (
          <>
            <span className="material-symbols-outlined text-[14px]">science</span>
            Run Institutional Synthesis
          </>
        )}
      </button>
      {result && !result.ok && (
        <span className="text-xs text-rose-600">{result.error ?? "Synthesis failed"}</span>
      )}
      {result?.ok && (result.missing?.length ?? 0) > 0 && (
        <span className="text-xs text-amber-700">
          {result.factsWritten} written, {result.missing!.length} still missing
        </span>
      )}
    </div>
  );
}
