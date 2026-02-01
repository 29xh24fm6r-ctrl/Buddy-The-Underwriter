/**
 * Safe Fetch Wrapper for Lifecycle State Derivation
 *
 * Provides consistent error handling, logging, and blocker generation
 * for all async operations in deriveLifecycleState.
 *
 * Goals:
 * - Never throw - always returns typed result
 * - Consistent logging with dealId + source context
 * - Generates typed blocker evidence for diagnosis
 */

import "server-only";
import type { LifecycleBlocker, LifecycleBlockerCode } from "./model";

/**
 * Context for safe fetch operations.
 */
export type SafeFetchContext = {
  dealId: string;
  correlationId?: string;
};

/**
 * Result of a safe fetch operation.
 */
export type SafeFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; err: unknown; blocker: LifecycleBlocker };

/**
 * Mapping of source names to specific blocker codes.
 */
const SOURCE_TO_BLOCKER_CODE: Record<string, LifecycleBlockerCode> = {
  deal: "deal_not_found",
  checklist: "checklist_fetch_failed",
  snapshot: "snapshot_fetch_failed",
  decision: "decision_fetch_failed",
  attestation: "attestation_fetch_failed",
  packet: "packet_fetch_failed",
  advancement: "advancement_fetch_failed",
  readiness: "readiness_fetch_failed",
};

/**
 * Get the appropriate blocker code for a source, with fallback.
 */
function getBlockerCode(source: string): LifecycleBlockerCode {
  return SOURCE_TO_BLOCKER_CODE[source] ?? "data_fetch_failed";
}

/**
 * Detect PostgREST schema mismatch errors.
 * These occur when selecting a non-existent column, type mismatch, etc.
 * MUST NOT be treated as "no data" — they indicate a code/schema bug.
 */
function isSchemaMismatchError(errorMsg: string): boolean {
  const msg = (errorMsg ?? "").toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("column") && msg.includes("not found") ||
    msg.includes("pgrst") && msg.includes("400") ||
    msg.includes("could not find") && msg.includes("column") ||
    msg.includes("relation") && msg.includes("does not exist")
  );
}

/**
 * Sanitize error for evidence - remove sensitive info, limit size.
 */
function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    // In dev, include message. In prod, be more conservative.
    const isDev = process.env.NODE_ENV === "development";
    if (isDev) {
      return err.message.slice(0, 200);
    }
    return err.name || "Error";
  }
  if (typeof err === "string") {
    return err.slice(0, 100);
  }
  return "Unknown error";
}

/**
 * Execute an async operation safely, returning a typed result.
 *
 * @param source - Name of the data source (e.g., "checklist", "snapshot")
 * @param fn - Async function to execute
 * @param ctx - Context with dealId for logging
 * @returns SafeFetchResult with data on success, or blocker on failure
 *
 * @example
 * const result = await safeFetch("checklist", async () => {
 *   const { data, error } = await sb.from("deal_checklist_items")...
 *   if (error) throw error;
 *   return data;
 * }, { dealId });
 *
 * if (!result.ok) {
 *   runtimeBlockers.push(result.blocker);
 * }
 */
export async function safeFetch<T>(
  source: string,
  fn: () => Promise<T>,
  ctx: SafeFetchContext
): Promise<SafeFetchResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    const blockerCode = getBlockerCode(source);
    const sanitizedErr = sanitizeError(err);

    // Log with consistent format for debugging
    console.warn(
      `[deriveLifecycleState] ${source} fetch failed`,
      JSON.stringify({
        dealId: ctx.dealId,
        correlationId: ctx.correlationId,
        source,
        error: sanitizedErr,
      })
    );

    const blocker: LifecycleBlocker = {
      code: blockerCode,
      message: `Could not load ${source} data`,
      evidence: {
        source,
        error: sanitizedErr,
        dealId: ctx.dealId,
        ...(ctx.correlationId && { correlationId: ctx.correlationId }),
      },
    };

    return { ok: false, err, blocker };
  }
}

/**
 * Execute a Supabase query safely, handling both thrown errors and .error property.
 *
 * This is specifically for Supabase queries which may return { data, error }
 * without throwing. Handles PostgrestBuilder thenables.
 *
 * @example
 * const result = await safeSupabaseQuery("checklist", async () => {
 *   return await sb.from("deal_checklist_items").select("*").eq("deal_id", dealId);
 * }, { dealId });
 */
export async function safeSupabaseQuery<T>(
  source: string,
  fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>,
  ctx: SafeFetchContext
): Promise<SafeFetchResult<T | null>> {
  try {
    const result = await fn();
    const { data, error } = result;

    if (error) {
      const sanitizedErr = error.message?.slice(0, 200) ?? "Query error";
      const isSchema = isSchemaMismatchError(error.message ?? "");
      const blockerCode = isSchema ? ("schema_mismatch" as LifecycleBlockerCode) : getBlockerCode(source);

      // Schema mismatches are CRITICAL — they indicate a code bug, not missing data
      const logLevel = isSchema ? "error" : "warn";
      console[logLevel](
        `[deriveLifecycleState] ${source} ${isSchema ? "SCHEMA MISMATCH" : "query error"}`,
        JSON.stringify({
          dealId: ctx.dealId,
          correlationId: ctx.correlationId,
          source,
          error: sanitizedErr,
          schema_mismatch: isSchema,
        })
      );

      const blocker: LifecycleBlocker = {
        code: blockerCode,
        message: isSchema
          ? `Schema mismatch in ${source} query (code bug, not missing data)`
          : `Could not load ${source} data`,
        evidence: {
          source,
          error: sanitizedErr,
          dealId: ctx.dealId,
          schema_mismatch: isSchema,
        },
      };

      return { ok: false, err: error, blocker };
    }

    return { ok: true, data };
  } catch (err) {
    // Delegate to safeFetch for thrown errors
    return safeFetch(source, () => Promise.reject(err), ctx);
  }
}

/**
 * Execute a Supabase count query safely.
 * Handles PostgrestBuilder thenables.
 */
export async function safeSupabaseCount(
  source: string,
  fn: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  ctx: SafeFetchContext
): Promise<SafeFetchResult<number>> {
  try {
    const result = await fn();
    const { count, error } = result;

    if (error) {
      const sanitizedErr = error.message?.slice(0, 200) ?? "Count query error";
      const isSchema = isSchemaMismatchError(error.message ?? "");
      const blockerCode = isSchema ? ("schema_mismatch" as LifecycleBlockerCode) : getBlockerCode(source);

      const logLevel = isSchema ? "error" : "warn";
      console[logLevel](
        `[deriveLifecycleState] ${source} ${isSchema ? "SCHEMA MISMATCH" : "count error"}`,
        JSON.stringify({
          dealId: ctx.dealId,
          source,
          error: sanitizedErr,
          schema_mismatch: isSchema,
        })
      );

      const blocker: LifecycleBlocker = {
        code: blockerCode,
        message: isSchema
          ? `Schema mismatch in ${source} count (code bug, not missing data)`
          : `Could not count ${source} data`,
        evidence: { source, error: sanitizedErr, dealId: ctx.dealId, schema_mismatch: isSchema },
      };

      return { ok: false, err: error, blocker };
    }

    return { ok: true, data: count ?? 0 };
  } catch (err) {
    return safeFetch(source, () => Promise.reject(err), ctx);
  }
}
