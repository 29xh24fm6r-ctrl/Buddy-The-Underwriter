"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  SubmissionReadinessGate,
  SubmissionGateStatus,
} from "@/lib/banker/buildSubmissionOrchestrationViewModel";
import { SUBMISSION_GATE_STATUS_LABELS } from "@/lib/banker/buildSubmissionOrchestrationViewModel";

const STATUS_STYLES: Record<
  SubmissionGateStatus,
  { dot: string; pillBg: string; pillText: string; glyph: string }
> = {
  passed: {
    dot: "bg-emerald-400",
    pillBg: "bg-emerald-500/15 ring-1 ring-emerald-400/30",
    pillText: "text-emerald-200",
    glyph: "✓",
  },
  blocked: {
    dot: "bg-rose-400",
    pillBg: "bg-rose-500/15 ring-1 ring-rose-400/30",
    pillText: "text-rose-200",
    glyph: "✕",
  },
  needs_review: {
    dot: "bg-amber-400",
    pillBg: "bg-amber-500/15 ring-1 ring-amber-400/30",
    pillText: "text-amber-200",
    glyph: "?",
  },
  not_applicable: {
    dot: "bg-stone-400",
    pillBg: "bg-white/10 ring-1 ring-white/15",
    pillText: "text-stone-300",
    glyph: "—",
  },
  unavailable: {
    dot: "bg-stone-500",
    pillBg: "bg-white/5 ring-1 ring-white/10",
    pillText: "text-stone-400",
    glyph: "◌",
  },
};

export function SubmissionReadinessGates({
  gates,
}: {
  gates: SubmissionReadinessGate[];
}) {
  if (gates.length === 0) return null;

  return (
    <section
      role="region"
      aria-label="Submission readiness gates"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="checklist" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h3 className="text-sm font-semibold text-white">Readiness gates</h3>
      </header>

      <ul
        className="mt-4 space-y-2"
        role="list"
        aria-label="Readiness gates list"
      >
        {gates.map((gate) => {
          const style = STATUS_STYLES[gate.status];
          const statusLabel = SUBMISSION_GATE_STATUS_LABELS[gate.status];
          return (
            <li
              key={gate.id}
              className="rounded-xl border border-white/10 bg-white/[0.04] p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn("h-1.5 w-1.5 rounded-full", style.dot)}
                    />
                    <span className="text-sm font-semibold text-white">
                      {gate.label}
                    </span>
                    {gate.blocking && (
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wider text-white/50"
                        aria-label="Blocking gate"
                      >
                        Blocking
                      </span>
                    )}
                    <span
                      className={cn(
                        "ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                        style.pillBg,
                        style.pillText,
                      )}
                      aria-label={`Status: ${statusLabel}`}
                    >
                      <span aria-hidden="true" className="text-[9px] leading-none">
                        {style.glyph}
                      </span>
                      {statusLabel}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-white/70">
                    {gate.explanation}
                  </p>
                </div>
                {gate.href && (
                  <a
                    href={gate.href}
                    aria-label={`Resolve gate: ${gate.label}`}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950"
                  >
                    Resolve
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
