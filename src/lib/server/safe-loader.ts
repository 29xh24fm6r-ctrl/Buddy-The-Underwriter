import "server-only";

/**
 * Safe Loader — wraps any async loader in a server-rendered deal route.
 *
 * RULE: Any async loader in a server-rendered deal route must be treated as
 * untrusted and non-fatal unless the route cannot exist without it.
 *
 * On success returns `{ ok: true, data, error: null }`.
 * On failure logs a structured error and returns `{ ok: false, data: fallback, error }`.
 */

export type SafeLoaderResult<T> =
  | { ok: true; data: T; error: null }
  | { ok: false; data: T; error: string };

export async function safeLoader<T>(opts: {
  /** Human-readable loader name for logging (e.g. "verifyUnderwrite") */
  name: string;
  /** Deal ID for correlation — omit for non-deal loaders */
  dealId?: string;
  /** The async operation to execute */
  run: () => Promise<T>;
  /** Value returned when `run()` throws */
  fallback: T;
  /** Surface where this loader runs (for log correlation) */
  surface?: string;
}): Promise<SafeLoaderResult<T>> {
  const { name, dealId, run, fallback, surface } = opts;
  try {
    const data = await run();
    return { ok: true, data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    console.error("[safeLoader] Loader failed — returning fallback", {
      area: "deal_shell_loader",
      loader: name,
      dealId: dealId ?? "unknown",
      surface: surface ?? "unknown",
      errorMessage: message,
      stack,
      severity: "error",
      degraded: true,
      timestamp: new Date().toISOString(),
    });

    return { ok: false, data: fallback, error: message };
  }
}
