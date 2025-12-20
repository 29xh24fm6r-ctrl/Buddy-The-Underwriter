// src/components/deals/interview/NextQuestionCard.tsx
"use client";

import React from "react";

type Plan =
  | {
      kind: "complete";
      question_key: null;
      question: null;
      why: string;
      missing_keys: string[];
    }
  | {
      kind: "confirm_candidate" | "ask_question";
      question_key: string;
      question: string;
      why: string;
      missing_keys: string[];
      candidate_fact_id?: string | null;
    };

export default function NextQuestionCard({
  plan,
  onAskNow,
  disabled,
}: {
  plan: Plan | null;
  onAskNow?: (q: { question: string; question_key: string }) => void;
  disabled?: boolean;
}) {
  if (!plan) {
    return (
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="font-semibold">Next Question</div>
        <div className="mt-2 text-sm text-muted-foreground">Loading question plan…</div>
      </div>
    );
  }

  if (plan.kind === "complete") {
    return (
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="font-semibold">Next Question</div>
        <div className="mt-2 text-sm">🎯 Intake complete.</div>
        <div className="mt-2 text-xs text-muted-foreground">{plan.why}</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Next Question</div>
          <div className="text-xs text-muted-foreground">
            Deterministic: driven by missing required facts only.
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          key: <span className="font-mono">{plan.question_key}</span>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
        {plan.question}
      </div>

      <div className="text-xs text-muted-foreground">
        <span className="font-medium">Why Buddy asked this:</span> {plan.why}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`rounded-md px-3 py-2 text-sm font-medium ${
            disabled ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
          disabled={!!disabled}
          onClick={() => onAskNow?.({ question: plan.question, question_key: plan.question_key })}
        >
          Ask now (log Buddy turn)
        </button>

        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
          onClick={() => {
            if (plan.question) navigator.clipboard?.writeText(plan.question);
          }}
        >
          Copy
        </button>
      </div>
    </div>
  );
}
