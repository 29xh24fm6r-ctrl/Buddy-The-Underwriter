"use client";

/**
 * SPEC-M3 GLASS-BOX-1 — borrower-facing readiness read.
 *
 * Unlike its sibling panels in BorrowerFundingJourney (readiness/deal-health/
 * guidance), this one is NOT fed a pre-computed view model as a prop — its
 * data requires a live translator+verifier round-trip
 * (buildGlassBoxReadinessRead), so it fetches its own data client-side
 * rather than blocking the whole portal page render on an LLM call.
 *
 * Split into a fetching wrapper (GlassBoxPanel) and a pure presentational
 * component (GlassBoxPanelBody) so the ready/degraded/unavailable render
 * states are testable via renderToStaticMarkup without needing to drive
 * useEffect — same testability principle used throughout this codebase's
 * borrower components.
 *
 * Disclaimer copy is rendered as-received from the API (`read.disclaimer`)
 * rather than imported here directly — the canonical source
 * (getDisclaimer("readiness")) is called server-side in
 * buildGlassBoxReadinessRead.ts, which carries the ai-disclaimer-surface
 * marker guard-ai-disclaimer.mjs checks.
 */
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

export type GlassBoxSection = { metricKey: string; label: string; narrative: string };

export type GlassBoxReadinessRead =
  | { status: "unavailable"; message: string }
  | { status: "degraded"; message: string; missingMetrics: string[]; disclaimer: string }
  | { status: "ready"; sections: GlassBoxSection[]; disclaimer: string };

function PanelHeader() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-100">
        <Icon name="fact_check" className="h-4 w-4 text-teal-700" />
      </div>
      <h3 className="text-sm font-heading font-semibold text-slate-900">Your Readiness Read</h3>
    </div>
  );
}

/** Pure presentational component — no fetching, no state. */
export function GlassBoxPanelBody({
  read,
}: {
  read: GlassBoxReadinessRead | null;
}) {
  if (!read) {
    return (
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <PanelHeader />
        <p className="mt-3 text-sm text-slate-500">Building your readiness read…</p>
      </section>
    );
  }

  if (read.status === "unavailable") {
    return (
      <section className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/60 p-5 shadow-sm">
        <PanelHeader />
        <p className="mt-3 text-sm text-slate-500">{read.message}</p>
      </section>
    );
  }

  if (read.status === "degraded") {
    return (
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <PanelHeader />
        <p className="mt-3 text-sm text-slate-600">{read.message}</p>
        {read.missingMetrics.length > 0 && (
          <ul className="mt-3 space-y-1">
            {read.missingMetrics.map((m) => (
              <li key={m} className="flex items-center gap-1.5">
                <Icon name="pending" className="h-3 w-3 text-slate-400" />
                <span className="text-xs text-slate-600">{m}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[11px] text-slate-400">{read.disclaimer}</p>
      </section>
    );
  }

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <PanelHeader />
      <div className="mt-3 space-y-3">
        {read.sections.map((s) => (
          <div key={s.metricKey} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {s.label}
            </div>
            <p className="mt-1 text-sm text-slate-700">{s.narrative}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-slate-400">{read.disclaimer}</p>
    </section>
  );
}

type FetchState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "loaded"; read: GlassBoxReadinessRead };

/**
 * Fetching wrapper — resolves the token-scoped route, then delegates to
 * GlassBoxPanelBody. Re-fetches whenever `refreshKey` changes (SPEC-M4
 * FIX-CARDS-1 — bumped by PortalClient.tsx after a checklist-affecting
 * action, so completing a fix card visibly updates this panel).
 */
export function GlassBoxPanel({ token, refreshKey }: { token: string; refreshKey?: number }) {
  const [state, setState] = useState<FetchState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/portal/${token}/glass-box`, { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (res.ok && body.ok) {
          setState({ phase: "loaded", read: body.read as GlassBoxReadinessRead });
        } else {
          setState({ phase: "error" });
        }
      } catch {
        if (!cancelled) setState({ phase: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey]);

  if (state.phase === "error") {
    // Silent on transient failure — the rest of the portal still works;
    // this isn't a blocker for anything else on the page.
    return null;
  }

  return <GlassBoxPanelBody read={state.phase === "loaded" ? state.read : null} />;
}
