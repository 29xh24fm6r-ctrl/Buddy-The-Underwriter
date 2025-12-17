"use client";

import React from "react";
import type { CreditMemoV1 } from "@/lib/creditMemo/creditMemoTypes";

function Section({ s }: { s: CreditMemoV1["sections"][number] }) {
  return (
    <div className="rounded border p-4">
      <div className="mb-2 text-lg font-semibold">{s.title}</div>

      {s.flags?.length ? (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
          <div className="font-medium">Flags</div>
          <ul className="list-disc pl-5">
            {s.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {s.body ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{s.body}</p> : null}

      {s.bullets?.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {s.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}

      {s.sources?.length ? (
        <div className="mt-3 text-xs text-gray-500">
          <div className="font-medium">Sources</div>
          <ul className="list-disc pl-5">
            {s.sources.map((src) => (
              <li key={`${src.title}-${src.url ?? ""}`}>
                {src.url ? (
                  <a className="underline" href={src.url} target="_blank" rel="noreferrer">
                    {src.title}
                  </a>
                ) : (
                  <span>{src.title}</span>
                )}
                {src.note ? <span> — {src.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function CreditMemoView({ memo }: { memo: CreditMemoV1 }) {
  return (
    <div className="space-y-4">
      <div className="rounded border p-4">
        <div className="text-xl font-semibold">Credit Memo</div>
        <div className="mt-1 text-sm text-gray-600">
          Generated: {new Date(memo.generated_at).toLocaleString()}
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded border p-3">
            <div className="text-sm font-semibold">Executive Summary</div>
            <div className="mt-1 text-sm">{memo.executive_summary.conclusion_headline}</div>

            {!!memo.executive_summary.key_risks.length && (
              <div className="mt-2 text-sm">
                <div className="font-medium">Key Risks</div>
                <ul className="list-disc pl-5">
                  {memo.executive_summary.key_risks.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="rounded border p-3">
            <div className="text-sm font-semibold">Underwriting Snapshot</div>
            <ul className="mt-2 space-y-1 text-sm">
              <li>Policy DSCR: {memo.underwriting_snapshot.policy_min_dscr.toFixed(2)}x</li>
              <li>ADS: {memo.underwriting_snapshot.ads ?? "—"}</li>
              <li>
                Worst DSCR:{" "}
                {memo.underwriting_snapshot.worst_dscr !== null
                  ? `${memo.underwriting_snapshot.worst_dscr.toFixed(2)}x`
                  : "—"}{" "}
                {memo.underwriting_snapshot.worst_year ? `(TY ${memo.underwriting_snapshot.worst_year})` : ""}
              </li>
              <li>
                Weighted DSCR:{" "}
                {memo.underwriting_snapshot.weighted_dscr !== null
                  ? `${memo.underwriting_snapshot.weighted_dscr.toFixed(2)}x`
                  : "—"}
              </li>
              <li>
                Stressed DSCR:{" "}
                {memo.underwriting_snapshot.stressed_dscr !== null
                  ? `${memo.underwriting_snapshot.stressed_dscr.toFixed(2)}x`
                  : "—"}
              </li>
              <li>Verdict: {memo.underwriting_snapshot.verdict_level}</li>
            </ul>
          </div>
        </div>
      </div>

      {memo.sections.map((s) => (
        <Section key={s.id} s={s} />
      ))}
    </div>
  );
}
