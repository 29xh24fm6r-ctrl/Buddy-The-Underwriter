// src/components/borrower/PackSuggestionsCard.tsx
"use client";

import React from "react";
import type { PortalPackSuggestion } from "@/lib/borrower/portalTypes";

function pct(conf: number | null | undefined) {
  const v = typeof conf === "number" ? conf : 0;
  return Math.round(v * 100);
}

export default function PackSuggestionsCard({
  suggestions,
}: {
  suggestions: PortalPackSuggestion[];
}) {
  if (!suggestions?.length) {
    return (
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold">Suggested document set</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Upload a few documents and we'll automatically recognize what you're working on and guide you step-by-step.
        </div>
      </div>
    );
  }

  const top = suggestions[0];

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">Suggested document set</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Based on what you've uploaded, here's what we think you're assembling.
          </div>
        </div>

        <div className="rounded-full border px-3 py-1 text-xs font-semibold">
          {pct(top.confidence)}% match
        </div>
      </div>

      <div className="mt-4 rounded-xl border bg-muted/20 p-4">
        <div className="text-base font-semibold">{top.pack_name}</div>

        <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border bg-white p-3">
            <div className="text-xs text-muted-foreground">Matched so far</div>
            <div className="mt-1 text-lg font-semibold">
              {top.matched_doc_count ?? 0}
            </div>
          </div>
          <div className="rounded-lg border bg-white p-3">
            <div className="text-xs text-muted-foreground">Still needed</div>
            <div className="mt-1 text-lg font-semibold">
              {top.missing_doc_count ?? 0}
            </div>
          </div>
        </div>

        {!!top.reason_codes?.length && (
          <div className="mt-3 text-xs text-muted-foreground">
            Recognized signals:{" "}
            <span className="font-medium text-foreground">
              {top.reason_codes.slice(0, 4).join(", ")}
              {top.reason_codes.length > 4 ? "…" : ""}
            </span>
          </div>
        )}
      </div>

      {suggestions.length > 1 && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-muted-foreground">Other possibilities</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.slice(1, 4).map((s) => (
              <span
                key={s.pack_id}
                className="rounded-full border bg-white px-3 py-1 text-xs"
                title={`${pct(s.confidence)}% match`}
              >
                {s.pack_name} · {pct(s.confidence)}%
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
