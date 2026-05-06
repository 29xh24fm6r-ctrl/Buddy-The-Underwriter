"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

/**
 * Reusable panel surface for SPEC-03 work-surface panels.
 *
 * - Title + optional badge
 * - Optional inline summary (e.g. "3 of 5 conditions cleared")
 * - Optional list of rows (each with label + status chip)
 * - Optional footer with deep links to the full surface
 *
 * Pure presentation; consumers drive fetching and pass derived rows.
 */

export type StatusTone =
  | "success"
  | "info"
  | "warn"
  | "danger"
  | "neutral";

const TONE: Record<StatusTone, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  info: "border-blue-500/30 bg-blue-500/10 text-blue-200",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  danger: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  neutral: "border-white/10 bg-white/5 text-white/70",
};

export type StatusRow = {
  id: string;
  label: string;
  detail?: string | null;
  tone?: StatusTone;
  badge?: string | null;
  href?: string | null;
};

export type StatusFooterLink = {
  label: string;
  href: string;
};

export function StatusListPanel({
  title,
  icon,
  summary,
  badge,
  badgeTone = "neutral",
  rows,
  emptyMessage = "Nothing to show.",
  loading = false,
  error = null,
  links,
  testId,
  children,
}: {
  title: string;
  icon?: string;
  summary?: ReactNode;
  badge?: string | null;
  badgeTone?: StatusTone;
  rows?: StatusRow[];
  emptyMessage?: string;
  loading?: boolean;
  error?: string | null;
  links?: StatusFooterLink[];
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon ? (
            <span className="material-symbols-outlined text-blue-300 text-[20px]">
              {icon}
            </span>
          ) : null}
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        {badge ? (
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE[badgeTone]}`}
          >
            {badge}
          </span>
        ) : null}
      </header>

      {summary ? (
        <div className="mb-3 text-xs text-white/70">{summary}</div>
      ) : null}

      {error ? (
        <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
          {error}
        </div>
      ) : null}

      {loading && (!rows || rows.length === 0) ? (
        <div className="text-xs text-white/40">Loading…</div>
      ) : null}

      {rows && rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
              data-row-id={r.id}
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-white/90">{r.label}</div>
                {r.detail ? (
                  <div className="text-[11px] text-white/50 truncate">{r.detail}</div>
                ) : null}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.badge ? (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      TONE[r.tone ?? "neutral"]
                    }`}
                  >
                    {r.badge}
                  </span>
                ) : null}
                {r.href ? (
                  <Link
                    href={r.href}
                    className="text-[11px] font-semibold text-blue-300 hover:text-blue-200"
                  >
                    Open
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : !loading && !error ? (
        <div className="text-xs text-white/40">{emptyMessage}</div>
      ) : null}

      {children ? <div className="mt-3">{children}</div> : null}

      {links && links.length > 0 ? (
        <footer className="mt-4 flex flex-wrap gap-2 border-t border-white/5 pt-3">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/10"
            >
              {l.label}
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </Link>
          ))}
        </footer>
      ) : null}
    </section>
  );
}

/**
 * Tiny client-side fetch hook used by SPEC-03 panels.
 * - Fetches once on mount + when dealId changes.
 * - Aborts on unmount.
 * - No SWR/react-query; consumers stay independent of cockpit polling.
 */
export function useJsonFetch<T>(
  url: string | null,
): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!url) {
      // No URL — settle into not-loading. Skipping this would leave the panel
      // stuck in its initial loading state when consumers pass a falsy URL.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    if (lastUrl.current === url) return;
    lastUrl.current = url;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(url, { cache: "no-store", signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as T;
        setData(json);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message ?? "fetch failed");
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [url]);

  return { data, loading, error };
}
