"use client";

import type { LifecycleBlocker } from "@/buddy/lifecycle/model";
import { getBlockerFixAction } from "@/lib/journey/getBlockerFixAction";
import { useCockpitAction } from "../../actions/useCockpitAction";
import type { CockpitAction } from "../../actions/actionTypes";

/**
 * Renders blockers with plain-English fix paths.
 *
 * SPEC-04: fix actions flow through the unified `useCockpitAction` runner
 * — runnable fixes POST to the server endpoint, navigate fixes router.push.
 * Telemetry + stage-data refresh follow automatically.
 */
export function StageBlockerList({
  dealId,
  blockers,
}: {
  dealId: string;
  blockers: LifecycleBlocker[];
}) {
  const { state, run } = useCockpitAction(dealId);

  if (!blockers || blockers.length === 0) return null;

  return (
    <section
      aria-label="Blockers"
      data-testid="stage-blocker-list"
      className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-amber-300 text-[18px]">
          report
        </span>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-amber-200">
          {blockers.length} {blockers.length === 1 ? "blocker" : "blockers"}
        </h3>
      </div>
      <ul className="space-y-2">
        {blockers.map((b) => {
          const fix: CockpitAction | null = getBlockerFixAction(b, dealId);
          const id = `blocker:${b.code}`;
          const isPending = state.status === "pending" && state.activeId === id;
          const isFailed =
            state.status === "error" && state.activeId === id;

          return (
            <li
              key={b.code}
              className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between"
              data-blocker-code={b.code}
            >
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-white/40">
                  {b.code}
                </div>
                <div className="text-sm text-white/90">{b.message}</div>
                {isFailed && state.errorMessage ? (
                  <div
                    className="mt-1 inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200"
                    role="alert"
                  >
                    <span className="material-symbols-outlined text-[12px]">
                      error
                    </span>
                    {state.errorMessage}
                  </div>
                ) : null}
              </div>
              {fix ? (
                <button
                  type="button"
                  onClick={() => {
                    if (isPending) return;
                    void run(fix, { id });
                  }}
                  disabled={isPending}
                  aria-busy={isPending}
                  className="inline-flex items-center gap-1.5 self-start rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-60 sm:self-auto"
                  data-testid="blocker-fix-action"
                >
                  {isPending ? (
                    <>
                      <span className="material-symbols-outlined text-[14px] animate-spin">
                        progress_activity
                      </span>
                      Running…
                    </>
                  ) : (
                    <>
                      {fix.label}
                      <span className="material-symbols-outlined text-[14px]">
                        arrow_forward
                      </span>
                    </>
                  )}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
