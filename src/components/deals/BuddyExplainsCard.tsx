"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

type BuddySummary = {
  headline: string;
  summary_md: string;
  next_steps: string[];
  risks: string[];
  confidence: number;
  sources_used: Record<string, number>;
};

type SummaryResponse = {
  ok: boolean;
  summary?: BuddySummary;
  created_at?: string;
  error?: string;
};

export function BuddyExplainsCard({ dealId }: { dealId: string }) {
  const [data, setData] = React.useState<SummaryResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);

  const fetchSummary = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/summary/buddy`);
      const json = await res.json();
      if (res.ok) {
        setData(json);
      } else {
        setData({ ok: false, error: json.error });
      }
    } catch (e) {
      console.error("Fetch summary error:", e);
      setData({ ok: false, error: "Failed to load summary" });
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  const generateSummary = React.useCallback(async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/summary/buddy`, {
        method: "POST",
      });
      const json = await res.json();
      if (res.ok) {
        setData(json);
      } else {
        alert(json.error ?? "Failed to generate summary");
      }
    } catch (e: any) {
      alert(e?.message ?? "Failed to generate summary");
    } finally {
      setGenerating(false);
    }
  }, [dealId]);

  React.useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="h-4 w-32 rounded bg-neutral-100" />
        <div className="mt-2 h-3 w-full rounded bg-neutral-100" />
      </div>
    );
  }

  const summary = data?.summary;
  const hasError = data && !data.ok;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="auto_awesome" className="h-5 w-5 text-blue-600" />
          <div className="text-sm font-semibold">Buddy Explains</div>
        </div>
        <button
          type="button"
          onClick={generateSummary}
          disabled={generating}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
        >
          {generating ? "Thinking…" : summary ? "Refresh" : "Explain this deal"}
        </button>
      </div>

      {hasError && !summary && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
          No summary yet. Click "Explain this deal" to generate.
        </div>
      )}

      {summary && (
        <div className="mt-4 space-y-3">
          {/* Headline */}
          <div className="text-sm font-semibold text-neutral-900">{summary.headline}</div>

          {/* Summary */}
          <div className="prose prose-sm max-w-none text-xs text-neutral-700">
            {summary.summary_md.split("\n").map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>

          {/* Next Steps */}
          {summary.next_steps && summary.next_steps.length > 0 && (
            <div className="rounded-lg bg-blue-50 p-3">
              <div className="text-xs font-semibold text-blue-900">Next Steps</div>
              <ul className="mt-2 space-y-1 text-xs text-blue-800">
                {summary.next_steps.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <Icon name="arrow_forward_ios" className="h-3 w-3 shrink-0 text-blue-600" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risks */}
          {summary.risks && summary.risks.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3">
              <div className="text-xs font-semibold text-amber-900">Risk Flags</div>
              <ul className="mt-2 space-y-1 text-xs text-amber-800">
                {summary.risks.map((risk, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <Icon name="error" className="h-3 w-3 shrink-0 text-amber-600" />
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Confidence */}
          <div className="flex items-center justify-between text-xs text-neutral-600">
            <div>
              Confidence: <span className="font-medium">{Math.round(summary.confidence * 100)}%</span>
            </div>
            {data.created_at && (
              <div className="text-neutral-500">
                Updated {formatTimeAgo(data.created_at)}
              </div>
            )}
          </div>

          {/* Copy button */}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(summary.summary_md);
              alert("Summary copied to clipboard");
            }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-xs hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900"
          >
            <Icon name="file" className="h-3 w-3" />
            Copy Summary
          </button>
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}
