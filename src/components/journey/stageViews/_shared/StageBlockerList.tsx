"use client";

import Link from "next/link";
import type { LifecycleBlocker } from "@/buddy/lifecycle/model";
import { getBlockerFixAction } from "@/buddy/lifecycle/nextAction";

/**
 * Renders blockers as a list with a plain-English fix path (when available).
 * Hides itself entirely when there are no blockers.
 */
export function StageBlockerList({
  dealId,
  blockers,
}: {
  dealId: string;
  blockers: LifecycleBlocker[];
}) {
  if (!blockers || blockers.length === 0) return null;

  return (
    <section
      aria-label="Blockers"
      data-testid="stage-blocker-list"
      className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-amber-300 text-[18px]">report</span>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-amber-200">
          {blockers.length} {blockers.length === 1 ? "blocker" : "blockers"}
        </h3>
      </div>
      <ul className="space-y-2">
        {blockers.map((b) => {
          const fix = getBlockerFixAction(b, dealId);
          return (
            <li
              key={b.code}
              className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between"
              data-blocker-code={b.code}
            >
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-white/40">{b.code}</div>
                <div className="text-sm text-white/90">{b.message}</div>
              </div>
              {fix && "href" in fix && fix.href ? (
                <Link
                  href={fix.href}
                  className="inline-flex items-center gap-1.5 self-start rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/20 sm:self-auto"
                  data-testid="blocker-fix-action"
                >
                  {fix.label}
                  <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                </Link>
              ) : fix && "action" in fix ? (
                <span
                  className="inline-flex items-center self-start rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/60 sm:self-auto"
                  data-testid="blocker-fix-action"
                  title={`Server action: ${fix.action}`}
                >
                  {fix.label}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
