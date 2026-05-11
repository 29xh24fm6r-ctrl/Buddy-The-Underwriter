"use client";

/**
 * SPEC-B3 — Classic Spread Download Link.
 *
 * Tries cached endpoint first (/classic-spread/cached). If 404,
 * falls back to the synchronous route (/classic-spread). Fires
 * /ensure on mount to pre-warm the cache if absent.
 *
 * Drop-in replacement for existing inline classic spread buttons.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type DownloadState = "idle" | "loading" | "error";

export function ClassicSpreadDownloadLink({
  dealId,
  className,
  label = "Classic Spread",
  loadingLabel = "Generating...",
}: {
  dealId: string;
  className?: string;
  label?: string;
  loadingLabel?: string;
}) {
  const [state, setState] = useState<DownloadState>("idle");
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const mountedRef = useRef(true);

  // On mount, fire /ensure to pre-warm cache (fire-and-forget)
  useEffect(() => {
    mountedRef.current = true;
    fetch(`/api/deals/${dealId}/classic-spread/ensure`, { method: "POST" }).catch(() => {});
    return () => { mountedRef.current = false; };
  }, [dealId]);

  const handleDownload = useCallback(async () => {
    if (state === "loading") return;
    setState("loading");

    try {
      // Try cached endpoint first
      let res = await fetch(`/api/deals/${dealId}/classic-spread/cached`);

      // If no cached PDF, fall back to synchronous route
      if (res.status === 404 || res.status === 409) {
        res = await fetch(`/api/deals/${dealId}/classic-spread`);
      }

      if (!res.ok) {
        throw new Error(`Export failed (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (downloadRef.current) {
        downloadRef.current.href = url;
        downloadRef.current.download = `ClassicSpread_${dealId.slice(0, 8)}.pdf`;
        downloadRef.current.click();
      }

      URL.revokeObjectURL(url);
      if (mountedRef.current) setState("idle");
    } catch {
      if (mountedRef.current) setState("error");
      // Auto-clear error after 3s
      setTimeout(() => {
        if (mountedRef.current) setState("idle");
      }, 3000);
    }
  }, [dealId, state]);

  const defaultClassName =
    "flex items-center gap-1.5 rounded-md border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-700 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <>
      <button
        onClick={handleDownload}
        disabled={state === "loading"}
        className={className ?? defaultClassName}
        data-testid="classic-spread-download"
      >
        {state === "loading" ? (
          <>
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {loadingLabel}
          </>
        ) : state === "error" ? (
          "Export failed — retry"
        ) : (
          label
        )}
      </button>
      <a ref={downloadRef} className="hidden" aria-hidden="true" />
    </>
  );
}
