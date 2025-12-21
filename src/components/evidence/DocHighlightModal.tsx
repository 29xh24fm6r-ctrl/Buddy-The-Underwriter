"use client";

import { useEffect, useState } from "react";

function markSnippet(snippet: string, hs: number, he: number) {
  const a = snippet.slice(0, hs);
  const b = snippet.slice(hs, he);
  const c = snippet.slice(he);
  return (
    <span className="whitespace-pre-wrap text-sm text-gray-900">
      {a}
      <mark className="rounded bg-yellow-200 px-0.5">{b}</mark>
      {c}
    </span>
  );
}

export function DocHighlightModal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  loader: () => Promise<{ snippet: string; highlightStart: number; highlightEnd: number; truncated?: boolean }>;
}) {
  const { open, onClose, title, loader } = props;

  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const data = await loader();
        if (alive) setPayload(data);
      } catch (e: any) {
        if (alive) setErr(e?.message || "load_failed");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, loader]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(900px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-200 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        <div className="max-h-[72vh] overflow-auto p-4">
          {loading ? (
            <div className="text-sm text-gray-600">Loading highlight…</div>
          ) : err ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {err}
            </div>
          ) : payload ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              {markSnippet(payload.snippet, payload.highlightStart, payload.highlightEnd)}
              {payload.truncated ? (
                <div className="mt-2 text-[11px] text-gray-500">
                  Snippet truncated for safety/performance.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
