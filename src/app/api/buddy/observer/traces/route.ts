/**
 * Builder Observer: Omega Traces Viewer
 *
 * GET /api/buddy/observer/traces?session_id=...
 *
 * Fetches omega reasoning traces for a given session.
 * Builder mode only.
 */
import "server-only";

import { NextRequest } from "next/server";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
} from "@/lib/api/respond";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { canViewDiagnostics } from "@/lib/modes/gates";
import { getBuddyMode } from "@/lib/modes/mode";

export const dynamic = "force-dynamic";

const ROUTE = "/api/buddy/observer/traces";

export async function GET(req: NextRequest) {
  const correlationId = generateCorrelationId("obs-t");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    await getCurrentBankId(); // auth check
    const mode = getBuddyMode();
    if (!canViewDiagnostics(mode)) {
      return respond200(
        { ok: false, error: { code: "mode_denied", message: "Observer traces requires builder_observer mode." }, meta: { correlationId, ts } },
        headers,
      );
    }

    const url = new URL(req.url);
    const sessionId = url.searchParams.get("session_id") ?? "";

    if (!sessionId) {
      return respond200(
        { ok: false, error: { code: "missing_session_id", message: "session_id query parameter required." }, meta: { correlationId, ts } },
        headers,
      );
    }

    const { readOmegaTraces } = await import("@/lib/omega/readOmegaTraces");
    const result = await readOmegaTraces({
      sessionId,
      correlationId,
    });

    if (!result.ok) {
      return respond200(
        {
          ok: false,
          error: { code: "traces_unavailable", message: result.error },
          omega_available: false,
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    return respond200(
      {
        ok: true,
        traces: result.data,
        count: result.data.length,
        omega_available: true,
        meta: { correlationId, ts, sessionId },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "observer_traces_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
