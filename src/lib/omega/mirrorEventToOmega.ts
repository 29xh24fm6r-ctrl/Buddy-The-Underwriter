/**
 * Mirror Buddy events to Omega Prime via MCP.
 *
 * Single entry point: mirrorEventToOmega().
 * Called from the canonical signal write path (writeBuddySignal).
 *
 * Rules:
 * - Uses mapping.json as the only contract
 * - Unmapped events are silently skipped
 * - Payloads are redacted before emission
 * - Never blocks the caller
 * - Never throws
 *
 * Server-only.
 */
import "server-only";

import { getEventMapping } from "./mapping";
import { redactPayload } from "./redaction";
import { invokeOmega } from "./invokeOmega";
import { OMEGA_EVENTS_WRITE_RESOURCE } from "./uri";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MirrorEventOpts {
  buddyEventType: string;
  payload: Record<string, unknown>;
  correlationId: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mirror a Buddy signal to Omega events/write.
 *
 * - Looks up mapping for the event type
 * - If no mapping exists, returns silently (not every signal maps)
 * - Redacts payload via the mapped redaction profile
 * - Fires invokeOmega (which itself is non-blocking on failure)
 * - NEVER throws
 */
export async function mirrorEventToOmega(opts: MirrorEventOpts): Promise<void> {
  try {
    const { buddyEventType, payload, correlationId } = opts;

    // 1. Lookup mapping
    const mapping = getEventMapping(buddyEventType);
    if (!mapping) {
      // Not a mapped event — skip silently
      return;
    }

    // 2. Redact payload
    let redacted: Record<string, unknown>;
    try {
      redacted = redactPayload(mapping.redaction_profile, payload);
    } catch {
      // Redaction failure → do not emit unredacted data
      console.warn(
        `[omega/mirror] redaction failed for ${buddyEventType}, skipping`,
      );
      return;
    }

    // 3. Build Omega event envelope
    const omegaEnvelope = {
      type: mapping.omega_event_type,
      entities: mapping.entity_links.map((link) => ({
        entity_type: link.entity_type,
        id: resolveIdPath(payload, link.id_path),
        optional: link.optional ?? false,
      })),
      payload: redacted,
      ts: new Date().toISOString(),
      correlationId,
    };

    // 4. Fire to Omega (non-blocking — invokeOmega never throws)
    await invokeOmega({
      resource: OMEGA_EVENTS_WRITE_RESOURCE,
      correlationId,
      payload: omegaEnvelope,
    });
  } catch {
    // Absolute safety net — never surface to caller
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a dotted id path from a payload object.
 * e.g. resolveIdPath({ dealId: "abc" }, "dealId") → "abc"
 * e.g. resolveIdPath({ payload: { borrowerId: "x" } }, "payload.borrowerId") → "x"
 */
function resolveIdPath(
  obj: Record<string, unknown>,
  path: string,
): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}
