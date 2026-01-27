/**
 * Builder Observer: Omega Health Endpoint
 *
 * GET /api/buddy/observer/health
 *
 * Returns omega health + aggregated diagnostics.
 * Builder mode only (requires builder auth).
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

const ROUTE = "/api/buddy/observer/health";

export async function GET(_req: NextRequest) {
  const correlationId = generateCorrelationId("obs-h");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    // Auth + mode check
    await getCurrentBankId(); // throws if not authenticated
    const mode = getBuddyMode();
    if (!canViewDiagnostics(mode)) {
      return respond200(
        { ok: false, error: { code: "mode_denied", message: "Observer health requires builder_observer mode." }, meta: { correlationId, ts } },
        headers,
      );
    }

    // Fetch omega health
    const { checkOmegaHealth } = await import("@/lib/omega/health");
    const health = await checkOmegaHealth(correlationId);

    // Fetch recent degraded events
    let recentDegraded: unknown[] = [];
    try {
      const { getRecentDegradedEvents } = await import("@/lib/api/degradedTracker");
      recentDegraded = await getRecentDegradedEvents("n/a") ?? [];
    } catch {
      // degraded tracker unavailable
    }

    return respond200(
      {
        ok: true,
        health,
        degraded: { count: recentDegraded.length, recent: recentDegraded },
        mode,
        meta: { correlationId, ts },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "observer_health_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
