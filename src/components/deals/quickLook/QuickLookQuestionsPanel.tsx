"use client";
import { useState, useEffect } from "react";

interface QuickLookQuestion {
  category: "financial_clarity" | "data_gaps" | "risk_factors";
  question: string;
  context: string;
  priority: "high" | "medium";
}

interface QuestionsResponse {
  ok: boolean;
  borrowerName: string;
  readinessPct: number;
  missingDocs: string[];
  questions: QuickLookQuestion[];
  generationStatus: "success" | "failed" | "empty";
  generatedAt: string;
}

interface QuickLookQuestionsPanelProps {
  dealId: string;
}

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  financial_clarity: { label: "Financial Clarity", color: "text-blue-300" },
  data_gaps: { label: "Data Gaps", color: "text-amber-300" },
  risk_factors: { label: "Risk Factors", color: "text-red-300" },
};

export function QuickLookQuestionsPanel({ dealId }: QuickLookQuestionsPanelProps) {
  const [data, setData] = useState<QuestionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/deals/${dealId}/quick-look/questions`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok) setData(d);
        else setError(d.error ?? "Failed to load questions");
      })
      .catch(() => {
        if (!cancelled) setError("Network error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [dealId]);

  if (loading) {
    return (
      <div className="animate-pulse h-32 bg-white/5 rounded-xl border border-white/10" />
    );
  }

  if (error || !data) {
    return null;
  }

  const grouped = new Map<string, QuickLookQuestion[]>();
  for (const q of data.questions) {
    if (!grouped.has(q.category)) grouped.set(q.category, []);
    grouped.get(q.category)!.push(q);
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-400 text-[18px]">
            help_outline
          </span>
          <h3 className="text-sm font-semibold text-white">
            Quick Look — Borrower Meeting Questions
          </h3>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/40">
          <span>Readiness: {data.readinessPct}%</span>
          {data.generationStatus === "failed" && (
            <span className="text-red-400">Generation failed — showing empty</span>
          )}
        </div>
      </div>

      {data.missingDocs.length > 0 && (
        <div className="text-xs text-amber-200/60 bg-amber-500/5 rounded-lg px-3 py-2">
          Missing: {data.missingDocs.join(" · ")}
        </div>
      )}

      {data.questions.length === 0 ? (
        <p className="text-sm text-white/40">
          No questions generated yet. Upload more documents to enable AI question generation.
        </p>
      ) : (
        <div className="space-y-3">
          {(["financial_clarity", "data_gaps", "risk_factors"] as const).map((cat) => {
            const qs = grouped.get(cat);
            if (!qs || qs.length === 0) return null;
            const meta = CATEGORY_META[cat];
            return (
              <div key={cat} className="space-y-1.5">
                <h4 className={`text-xs font-medium ${meta.color} uppercase tracking-wide`}>
                  {meta.label}
                </h4>
                {qs.map((q, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-sm text-white/80 pl-2"
                  >
                    <span className="text-white/30 mt-0.5 flex-shrink-0">
                      {q.priority === "high" ? "●" : "○"}
                    </span>
                    <div>
                      <p>{q.question}</p>
                      {q.context && (
                        <p className="text-xs text-white/40 mt-0.5">{q.context}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
