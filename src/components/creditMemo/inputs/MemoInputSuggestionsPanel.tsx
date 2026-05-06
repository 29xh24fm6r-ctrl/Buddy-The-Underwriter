"use client";

import { useEffect, useState } from "react";
import type { MemoInputPrefill, SuggestedValue } from "@/lib/creditMemo/inputs/prefillTypes";

type Props = {
  dealId: string;
  // Called when banker accepts a suggestion. The parent decides which form
  // section to apply it to. Multiple section keys are supported so a single
  // suggestion can apply to nested form fields (borrower_story.business_description).
  onAccept: (path: string[], value: string, source: SuggestedValue) => void;
};

export default function MemoInputSuggestionsPanel({ dealId, onAccept }: Props) {
  const [prefill, setPrefill] = useState<MemoInputPrefill | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/memo-inputs?section=prefill`);
        const json = await res.json();
        if (!cancelled && json?.ok) setPrefill(json.prefill as MemoInputPrefill);
      } catch {
        // Non-fatal: suggestions are advisory.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (loading) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Buddy suggestions</h2>
        <p className="mt-1 text-sm text-gray-600">Loading suggestions…</p>
      </section>
    );
  }

  const entries = collectEntries(prefill, dismissed);

  if (entries.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Buddy suggestions</h2>
        <p className="mt-1 text-sm text-gray-600">
          No suggestions yet. Buddy will surface prefill once documents and
          research are processed.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-gray-900">
          Buddy found suggested inputs
        </h2>
        <p className="text-xs text-gray-700">
          Review and accept to populate the forms below. Banker certification
          still required.
        </p>
      </header>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li
            key={e.key}
            className="flex items-start justify-between gap-3 rounded-md border border-emerald-200 bg-white p-3 text-sm"
          >
            <div className="min-w-0">
              <div className="font-semibold text-gray-900">{e.label}</div>
              <div className="mt-0.5 truncate text-gray-700">{e.value.value}</div>
              <div className="mt-1 text-xs text-gray-500">
                Source: {e.value.source}
                {" · "}
                Confidence: {(e.value.confidence * 100).toFixed(0)}%
                {" · "}
                {e.value.reason}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <button
                type="button"
                onClick={() => onAccept(e.path, e.value.value, e.value)}
                className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-600"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => setDismissed((s) => new Set(s).add(e.key))}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function collectEntries(
  prefill: MemoInputPrefill | null,
  dismissed: Set<string>,
): Array<{ key: string; label: string; path: string[]; value: SuggestedValue }> {
  if (!prefill) return [];
  const out: Array<{
    key: string;
    label: string;
    path: string[];
    value: SuggestedValue;
  }> = [];

  // Borrower story
  for (const [k, v] of Object.entries(prefill.borrower_story)) {
    if (!v) continue;
    const key = `story.${k}`;
    if (dismissed.has(key)) continue;
    out.push({
      key,
      label: `Story · ${humanize(k)}`,
      path: ["borrower_story", k],
      value: v,
    });
  }

  // Management
  prefill.management_profiles.forEach((p, idx) => {
    const key = `mgmt.${idx}.person_name`;
    if (dismissed.has(key)) return;
    out.push({
      key,
      label: `Management · ${p.person_name.value}`,
      path: ["management_profiles", String(idx)],
      value: p.person_name,
    });
  });

  // Collateral
  prefill.collateral_items.forEach((c, idx) => {
    const key = `coll.${idx}.description`;
    if (dismissed.has(key)) return;
    out.push({
      key,
      label: `Collateral · ${c.description.value}`,
      path: ["collateral_items", String(idx)],
      value: c.description,
    });
  });

  return out;
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
