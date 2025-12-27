"use client";

import { useState } from "react";

type Section = {
  key: string;
  title: string;
  text: string;
  citations: Array<{ i: number; reason?: string }>;
};

type Props = {
  dealId: string;
  bankId?: string;
  className?: string;
};

export default function AutoMemoButton({ dealId, bankId, className = "" }: Props) {
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    setSections([]);
    
    try {
      const res = await fetch(`/api/deals/${dealId}/memo/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bankId }),
      });
      
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      
      const json = await res.json();
      setSections(json.sections ?? []);
    } catch (e: any) {
      setError(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={className}>
      <button
        className="rounded-xl px-4 py-2 text-sm border border-border disabled:opacity-50 hover:bg-muted transition-colors font-medium"
        disabled={loading}
        onClick={generate}
      >
        {loading ? "Generating Memo…" : "🚀 Generate Full Memo"}
      </button>

      {error ? (
        <div className="mt-3 text-sm text-red-600 bg-red-50 p-3 rounded-xl">
          {error}
        </div>
      ) : null}

      {sections.length > 0 ? (
        <div className="mt-4 space-y-4">
          <div className="text-lg font-semibold">Generated Credit Memo</div>
          
          {sections.map((s) => (
            <div key={s.key} className="rounded-xl border border-border p-4 bg-background">
              <div className="font-semibold text-base mb-2">{s.title}</div>
              <div className="text-sm whitespace-pre-wrap leading-relaxed mb-3">
                {s.text}
              </div>
              
              {s.citations.length > 0 ? (
                <div className="text-xs text-muted-foreground border-t border-border pt-2">
                  <span className="font-medium">Citations: </span>
                  {s.citations.map((c, idx) => (
                    <span key={idx}>
                      [{c.i}]
                      {idx < s.citations.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}

          <div className="flex gap-2">
            <button
              className="rounded-xl px-4 py-2 text-sm border border-border hover:bg-muted transition-colors"
              onClick={() => {
                const text = sections.map(s => `## ${s.title}\n\n${s.text}\n`).join("\n");
                navigator.clipboard.writeText(text);
              }}
            >
              Copy to Clipboard
            </button>
            <button
              className="rounded-xl px-4 py-2 text-sm border border-border hover:bg-muted transition-colors"
              onClick={() => setSections([])}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
