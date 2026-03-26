/**
 * DealPageErrorState — consistent degraded-state UI for deal shell routes.
 *
 * Renders when a page-level data loader fails but the deal identity is known.
 * Shows human-readable copy, a recovery CTA, and an optional technical footer
 * for supportability. Never exposes raw stack traces.
 */

type DealPageErrorStateProps = {
  /** Heading shown in the error card */
  title: string;
  /** Human-readable description */
  message: string;
  /** Recovery link target */
  backHref: string;
  /** Recovery link label (default: "Go Back") */
  backLabel?: string;
  /** Deal ID for supportability footer */
  dealId?: string;
  /** Surface name for supportability footer */
  surface?: "cockpit" | "conditions" | "pricing" | "spreads" | "sba" | "memo" | string;
  /** Brief technical error (shown in collapsed details, not the stack) */
  technicalDetail?: string;
};

export function DealPageErrorState({
  title,
  message,
  backHref,
  backLabel = "Go Back",
  dealId,
  surface,
  technicalDetail,
}: DealPageErrorStateProps) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-6">
      <div className="flex items-start gap-3">
        <div className="shrink-0 text-2xl" aria-hidden="true">
          ⚠️
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-amber-200">{title}</h2>
          <p className="mt-1 text-sm text-amber-300/80">{message}</p>

          {technicalDetail && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-amber-400/70 hover:text-amber-300">
                Technical details
              </summary>
              <pre className="mt-2 overflow-auto rounded-lg bg-amber-950/40 p-3 text-xs text-amber-300/60">
                {dealId ? `dealId: ${dealId}\n` : ""}
                {surface ? `surface: ${surface}\n` : ""}
                {`error: ${technicalDetail}`}
              </pre>
            </details>
          )}

          <a
            href={backHref}
            className="mt-4 inline-flex items-center rounded-lg bg-amber-700/50 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600/50"
          >
            {backLabel}
          </a>
        </div>
      </div>
    </div>
  );
}
