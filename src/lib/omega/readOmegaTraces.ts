/**
 * Omega Trace Reader.
 *
 * Fetches reasoning traces from omega://traces/{sessionId}.
 * Used to surface Omega Prime's reasoning in Buddy debug views.
 *
 * Server-only. Read-only. Never mutates.
 */
import "server-only";

import { invokeOmega, type OmegaResult } from "./invokeOmega";
import { omegaTracesUri } from "./uri";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OmegaTraceEntry {
  step: number;
  action: string;
  reasoning: string;
  ts: string;
  [key: string]: unknown;
}

export interface ReadTracesOpts {
  sessionId: string;
  correlationId: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read Omega traces for a given session.
 *
 * Returns the trace log or { ok: false } on failure.
 */
export async function readOmegaTraces(
  opts: ReadTracesOpts,
): Promise<OmegaResult<OmegaTraceEntry[]>> {
  const { sessionId, correlationId } = opts;
  const uri = omegaTracesUri(sessionId);

  return invokeOmega<OmegaTraceEntry[]>({
    resource: uri,
    correlationId,
  });
}
