// src/lib/evidence/excerpts/openExcerpt.ts

export type OpenExcerptArgs = {
  dealId: string;
  fileId: string;
  docId?: string;
  globalCharStart: number;
  globalCharEnd: number;
  source?: "bridge_feed" | "bridge_nba" | "other";
  overlayId?: string;
  citationId?: string;
};

let dispatcher: ((args: OpenExcerptArgs) => void) | null = null;

/**
 * Register the dispatcher (called once by modal provider)
 */
export function registerOpenExcerptDispatcher(fn: (args: OpenExcerptArgs) => void) {
  dispatcher = fn;
}

/**
 * Public API to open an excerpt modal
 * Throws if dispatcher not registered
 */
export function openExcerpt(args: OpenExcerptArgs) {
  if (!dispatcher) {
    console.warn("openExcerpt dispatcher not registered - falling back to deal URL");
    window.location.href = `/deals/${args.dealId}`;
    return;
  }
  dispatcher(args);
}
