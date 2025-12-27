"use client";

import { useMemo, useState } from "react";

type Citation = { i: number; reason?: string };

type Props = { 
  dealId: string; 
  bankId?: string;
  className?: string;
};

export default function AskBuddyPanel({ dealId, bankId, className = "" }: Props) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [followups, setFollowups] = useState<string[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disabled = useMemo(() => !q.trim() || loading, [q, loading]);

  async function ask() {
    setLoading(true);
    setError(null);
    setAnswer(null);
    setCitations([]);
    setFollowups([]);
    setRunId(null);
    
    try {
      const res = await fetch(`/api/deals/${dealId}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, bankId }),
      });
      
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      
      const json = await res.json();
      setAnswer(json.answer ?? null);
      setCitations(json.citations ?? []);
      setFollowups(json.followups ?? []);
      setRunId(json.run_id ?? null);
    } catch (e: any) {
      setError(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function handleFollowup(followup: string) {
    setQ(followup);
  }

  return (
    <div className={`rounded-2xl border border-border p-4 bg-background ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-lg font-semibold">Ask Buddy</div>
        {runId ? (
          <div className="text-xs text-muted-foreground font-mono">
            run {runId.slice(0, 8)}…
          </div>
        ) : null}
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !disabled && ask()}
          placeholder="Ask anything about this deal (Buddy will cite sources)…"
        />
        <button
          className="rounded-xl px-4 py-2 text-sm border border-border disabled:opacity-50 hover:bg-muted transition-colors"
          disabled={disabled}
          onClick={ask}
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>

      {error ? (
        <div className="mt-3 text-sm text-red-600 bg-red-50 p-3 rounded-xl">
          {error}
        </div>
      ) : null}

      {answer ? (
        <div className="mt-4 space-y-3">
          <div className="text-sm whitespace-pre-wrap leading-relaxed">
            {answer}
          </div>

          {citations.length > 0 ? (
            <div className="rounded-xl border border-border p-3 bg-muted/30">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Citations
              </div>
              <div className="space-y-1">
                {citations.map((c, idx) => (
                  <div key={idx} className="text-xs flex items-start gap-2">
                    <span className="font-semibold font-mono">[{c.i}]</span>
                    <span className="flex-1 text-muted-foreground">
                      {c.reason ?? ""}
                    </span>
                    <a
                      className="underline text-primary hover:text-primary/80"
                      href={`/deals/${dealId}/evidence?cite=${encodeURIComponent(String(c.i))}`}
                    >
                      view
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {followups.length > 0 ? (
            <div className="rounded-xl border border-border p-3 bg-muted/30">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Follow-up questions
              </div>
              <div className="space-y-1">
                {followups.map((f, idx) => (
                  <button
                    key={idx}
                    className="text-xs text-left text-primary hover:text-primary/80 underline block"
                    onClick={() => handleFollowup(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
