"use client";

/**
 * "Your Business Plan & Feasibility Preview" card on /portal/[token].
 *
 * State machine per spec:
 *   A. No preview         → "Generate My Preview" button
 *   B. Generating         → disabled, polling latest-preview
 *   C. Preview succeeded  → three sub-cards with View buttons
 *   D. Preview failed     → friendly error + Try Again + gaps checklist
 *
 * Auth: the parent passes the URL token. All requests go through the
 * portal-scoped /api/portal/[token]/trident/* routes — never the
 * cookie-scoped /api/brokerage/* routes — because /portal/[token] does
 * not get the buddy_borrower_session cookie.
 */

import * as React from "react";

type BundleShape = {
  id: string;
  status: "pending" | "running" | "succeeded" | "failed";
  businessPlanPdfPath: string | null;
  projectionsPdfPath: string | null;
  feasibilityPdfPath: string | null;
  generationError: string | null;
  generatedAt: string | null;
};

type LocalState =
  | { phase: "idle" }
  | { phase: "loading-existing" }
  | { phase: "no-preview" }
  | { phase: "generating" }
  | { phase: "succeeded"; bundle: BundleShape }
  | { phase: "failed"; bundle: BundleShape | null; message: string | null }
  | { phase: "blocked"; gaps: string[] };

const POLL_MS = 4000;

export function TridentPreviewCard({ token }: { token: string }) {
  const [state, setState] = React.useState<LocalState>({
    phase: "loading-existing",
  });
  const pollHandle = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = React.useCallback(() => {
    if (pollHandle.current) {
      clearTimeout(pollHandle.current);
      pollHandle.current = null;
    }
  }, []);

  const fetchLatest = React.useCallback(async (): Promise<
    BundleShape | null
  > => {
    const res = await fetch(`/api/portal/${token}/trident/latest-preview`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; bundle: BundleShape | null };
    return json.bundle ?? null;
  }, [token]);

  // Initial load
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const bundle = await fetchLatest();
      if (cancelled) return;
      if (bundle) setState({ phase: "succeeded", bundle });
      else setState({ phase: "no-preview" });
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [fetchLatest, stopPolling]);

  // Generate handler
  const onGenerate = React.useCallback(async () => {
    setState({ phase: "generating" });
    try {
      const res = await fetch(`/api/portal/${token}/trident/preview`, {
        method: "POST",
        credentials: "include",
      });
      const json = (await res.json()) as
        | { ok: true; bundle: BundleShape }
        | { ok: false; error: "missing_prerequisites"; gaps: string[] }
        | {
            ok: false;
            error: "generation_failed";
            bundle: BundleShape | null;
            message: string | null;
          };

      if (!("ok" in json)) {
        setState({
          phase: "failed",
          bundle: null,
          message: "Unexpected response from server.",
        });
        return;
      }

      if (json.ok) {
        setState({ phase: "succeeded", bundle: json.bundle });
        return;
      }

      if (json.error === "missing_prerequisites") {
        setState({ phase: "blocked", gaps: json.gaps });
        return;
      }

      setState({
        phase: "failed",
        bundle: json.bundle ?? null,
        message: json.message ?? null,
      });
    } catch (e) {
      setState({
        phase: "failed",
        bundle: null,
        message:
          e instanceof Error ? e.message : "Network error — try again.",
      });
    }
  }, [token]);

  // Poll while a 'generating' state is showing (covers the page-refresh /
  // multi-tab case where the user navigates away and another tab is
  // running the generator).
  React.useEffect(() => {
    if (state.phase !== "generating") return;
    let cancelled = false;
    const tick = async () => {
      const bundle = await fetchLatest();
      if (cancelled) return;
      if (bundle) {
        setState({ phase: "succeeded", bundle });
        return;
      }
      pollHandle.current = setTimeout(tick, POLL_MS);
    };
    pollHandle.current = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [state.phase, fetchLatest, stopPolling]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Your Business Plan &amp; Feasibility Preview
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Buddy will prepare a preview of your business plan, projections,
            and feasibility study. The full package unlocks when you pick a
            lender.
          </p>
        </div>
      </header>

      {state.phase === "loading-existing" && (
        <p className="text-sm text-slate-500">Checking for existing preview…</p>
      )}

      {state.phase === "no-preview" && (
        <button
          type="button"
          onClick={onGenerate}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Generate My Preview
        </button>
      )}

      {state.phase === "generating" && (
        <div className="flex items-center gap-3 text-sm text-slate-700">
          <span
            aria-hidden
            className="h-3 w-3 animate-pulse rounded-full bg-blue-600"
          />
          Preparing your preview…
        </div>
      )}

      {state.phase === "blocked" && (
        <div>
          <p className="text-sm font-medium text-amber-900">
            I can build your preview — I just need a couple more things first:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {state.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onGenerate}
            className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            Try Again
          </button>
        </div>
      )}

      {state.phase === "failed" && (
        <div>
          <p className="text-sm font-medium text-red-700">
            Buddy couldn&apos;t finish your preview this time.
          </p>
          {state.message && (
            <p className="mt-1 text-xs text-red-700/80">{state.message}</p>
          )}
          {state.bundle?.generationError && (
            <p className="mt-1 text-xs text-red-700/80">
              {state.bundle.generationError}
            </p>
          )}
          <button
            type="button"
            onClick={onGenerate}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      )}

      {state.phase === "succeeded" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <PreviewSubCard
            token={token}
            kind="business-plan"
            title="Business Plan Preview"
            unlockNote="Full document unlocks when you pick a lender."
            available={!!state.bundle.businessPlanPdfPath}
            buttonLabel="View Business Plan Preview"
          />
          <PreviewSubCard
            token={token}
            kind="projections"
            title="Projections Preview"
            unlockNote="Full workbook unlocks when you pick a lender."
            available={!!state.bundle.projectionsPdfPath}
            buttonLabel="View Projections Preview"
          />
          <PreviewSubCard
            token={token}
            kind="feasibility"
            title="Feasibility Study Preview"
            unlockNote="Full study unlocks when you pick a lender."
            available={!!state.bundle.feasibilityPdfPath}
            buttonLabel="View Feasibility Preview"
          />
        </div>
      )}
    </section>
  );
}

function PreviewSubCard(props: {
  token: string;
  kind: "business-plan" | "projections" | "feasibility";
  title: string;
  unlockNote: string;
  available: boolean;
  buttonLabel: string;
}) {
  const [opening, setOpening] = React.useState(false);

  const onOpen = async () => {
    setOpening(true);
    try {
      const res = await fetch(
        `/api/portal/${props.token}/trident/download/${props.kind}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!res.ok) throw new Error("download failed");
      const json = (await res.json()) as { ok: boolean; url?: string };
      if (json.ok && json.url) {
        window.open(json.url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900">{props.title}</h3>
      <p className="mt-1 text-xs text-slate-500">{props.unlockNote}</p>
      <button
        type="button"
        onClick={onOpen}
        disabled={!props.available || opening}
        className="mt-auto rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {opening
          ? "Opening…"
          : props.available
            ? props.buttonLabel
            : "Not available"}
      </button>
    </div>
  );
}
