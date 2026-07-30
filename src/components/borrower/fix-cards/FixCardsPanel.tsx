"use client";

/**
 * SPEC-M4 FIX-CARDS-1 — borrower-facing fix cards.
 *
 * Same shape as GlassBoxPanel.tsx: a pure presentational body
 * (FixCardsPanelBody, testable via renderToStaticMarkup) plus a thin
 * fetching wrapper. Re-fetches whenever `refreshKey` changes — bumped by
 * PortalClient.tsx after any checklist-affecting action, so completing a
 * card's resolving action visibly updates this panel (and GlassBoxPanel).
 */
// ai-disclaimer-surface: fix_card — enforced by scripts/guards/guard-ai-disclaimer.mjs
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { getDisclaimer } from "@/lib/ai/disclaimers";

export type FixCard = {
  issueType: string;
  severity: "info" | "warning" | "critical";
  what: string;
  whyItMatters: string;
  resolvingAction: string;
  checklistKey?: string;
};

const SEVERITY_STYLES: Record<FixCard["severity"], { ring: string; label: string }> = {
  info: { ring: "ring-sky-200", label: "text-sky-700" },
  warning: { ring: "ring-amber-200", label: "text-amber-700" },
  critical: { ring: "ring-rose-200", label: "text-rose-700" },
};

function PanelHeader() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100">
        <Icon name="checklist" className="h-4 w-4 text-amber-700" />
      </div>
      <h3 className="text-sm font-heading font-semibold text-slate-900">Things to Fix</h3>
    </div>
  );
}

/** Pure presentational component — no fetching, no state. */
export function FixCardsPanelBody({ cards }: { cards: FixCard[] | null }) {
  if (!cards) {
    return (
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <PanelHeader />
        <p className="mt-3 text-sm text-slate-500">Checking your package for anything to fix…</p>
      </section>
    );
  }

  if (cards.length === 0) {
    return (
      <section className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/60 p-5 shadow-sm">
        <PanelHeader />
        <p className="mt-3 text-sm text-slate-500">Nothing to fix right now — you're all caught up.</p>
      </section>
    );
  }

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <PanelHeader />
      <div className="mt-3 space-y-3">
        {cards.map((card) => {
          const style = SEVERITY_STYLES[card.severity];
          return (
            <div key={card.issueType} className={`rounded-xl border border-slate-100 bg-slate-50/50 p-3 ring-1 ${style.ring}`}>
              <div className="text-sm font-medium text-slate-800">{card.what}</div>
              <p className="mt-1 text-xs text-slate-500">{card.whyItMatters}</p>
              <p className={`mt-2 text-xs font-semibold ${style.label}`}>{card.resolvingAction}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-slate-400">{getDisclaimer("fix_card")}</p>
    </section>
  );
}

type FetchState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "loaded"; cards: FixCard[] };

/** Fetching wrapper — resolves the token-scoped route, then delegates to FixCardsPanelBody. */
export function FixCardsPanel({ token, refreshKey }: { token: string; refreshKey?: number }) {
  const [state, setState] = useState<FetchState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/portal/${token}/fix-cards`, { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (res.ok && body.ok) {
          setState({ phase: "loaded", cards: body.cards as FixCard[] });
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
    // Silent on transient failure — the rest of the portal still works.
    return null;
  }

  return <FixCardsPanelBody cards={state.phase === "loaded" ? state.cards : null} />;
}
