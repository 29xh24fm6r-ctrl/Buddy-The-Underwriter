"use client";

import { useState } from "react";

type Props = {
  dealId: string;
  headline: string;
  trigger?: React.ReactNode;
  className?: string;
};

export default function WhyExplainer({ dealId, headline, trigger, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<string[]>([]);
  const [counterfactuals, setCounterfactuals] = useState<string[]>([]);
  const [citations, setCitations] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function explain() {
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch(`/api/deals/${dealId}/risk/explain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ headline }),
      });
      
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      
      const json = await res.json();
      setExplanation(json.explanation ?? null);
      setDrivers(json.drivers ?? []);
      setCounterfactuals(json.counterfactuals ?? []);
      setCitations(json.citations ?? []);
      setOpen(true);
    } catch (e: any) {
      setError(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {trigger ? (
        <div onClick={explain} className={className}>
          {trigger}
        </div>
      ) : (
        <button
          className={`rounded-xl px-3 py-1 text-xs border border-border disabled:opacity-50 hover:bg-muted transition-colors ${className}`}
          disabled={loading}
          onClick={explain}
        >
          {loading ? "..." : "Why?"}
        </button>
      )}

      {error ? (
        <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded-xl">
          {error}
        </div>
      ) : null}

      {open && explanation ? (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-2xl border border-border max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="text-lg font-semibold">Why: {headline}</div>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium mb-1">Explanation</div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  {explanation}
                </div>
              </div>

              {drivers.length > 0 ? (
                <div>
                  <div className="text-sm font-medium mb-1">Key Drivers</div>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    {drivers.map((d, idx) => (
                      <li key={idx}>{d}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {counterfactuals.length > 0 ? (
                <div>
                  <div className="text-sm font-medium mb-1">
                    What Would Change It?
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    {counterfactuals.map((c, idx) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {citations.length > 0 ? (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Evidence
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    {citations.map((c, idx) => (
                      <div key={idx}>
                        [{c.i ?? idx}] {c.reason ?? ""}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
