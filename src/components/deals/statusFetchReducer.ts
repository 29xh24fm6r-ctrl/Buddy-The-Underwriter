/**
 * Spec D5 — StatusFetchState reducer
 *
 * Pure, testable state-machine for "cold-start sensitive" status fetches.
 * Mapped from a fetch outcome to a StatusFetchState variant.
 *
 * Export-only module — no React imports so tests can run under
 * `node --import tsx --test` without a DOM/jsdom harness.
 */

export type StatusFetchState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; status: T }
  | { kind: "failed"; error: string; canRetry: true };

export type FetchOutcome<T> =
  | { type: "start" }
  | { type: "network_error"; error: string }
  | { type: "http_error"; status: number }
  | { type: "payload_error"; error: string }
  | { type: "success"; data: T };

export function applyFetchOutcome<T>(
  outcome: FetchOutcome<T>,
): StatusFetchState<T> {
  switch (outcome.type) {
    case "start":
      return { kind: "loading" };
    case "network_error":
      return { kind: "failed", error: outcome.error, canRetry: true };
    case "http_error":
      return {
        kind: "failed",
        error: `Status check failed (${outcome.status})`,
        canRetry: true,
      };
    case "payload_error":
      return { kind: "failed", error: outcome.error, canRetry: true };
    case "success":
      return { kind: "ready", status: outcome.data };
  }
}

/** Narrowing helper so callers can use `if (isReady(state)) state.status` cleanly. */
export function isReady<T>(
  s: StatusFetchState<T>,
): s is { kind: "ready"; status: T } {
  return s.kind === "ready";
}

/** Narrowing helper for failure mode. */
export function isFailed<T>(
  s: StatusFetchState<T>,
): s is { kind: "failed"; error: string; canRetry: true } {
  return s.kind === "failed";
}

/**
 * Classify a StatusFetchState + pending flag into a single UI "mode" enum so
 * button renderers pick exactly one branch. Pure; no React deps.
 */
export function buttonMode<T>(
  state: StatusFetchState<T>,
  pending: boolean,
): "pending" | "loading" | "ready" | "failed" {
  if (pending) return "pending";
  if (state.kind === "failed") return "failed";
  if (state.kind === "idle" || state.kind === "loading") return "loading";
  return "ready";
}
