/**
 * URI → Pulse MCP tool translation for Omega client.
 *
 * Pure module (no `server-only` import) so Batch 1's field-mapping invariants
 * can be behavior-tested without the Next.js server-only guard. The runtime
 * wire logic (fetch, auth headers, response unwrapping) lives in invokeOmega.ts
 * and is covered by source-grep tests.
 */

export interface ToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * Shape of the envelope `mirrorEventToOmega` builds before invoking the write path.
 * Translator maps these fields into buddy_ledger_write's input schema.
 */
export interface OmegaEventEnvelope {
  type: string;
  entities?: Array<{ entity_type: string; id?: string; optional?: boolean }>;
  payload?: unknown;
  ts?: string;
  correlationId?: string;
}

// Entity types whose `id` populates Pulse's `deal_id` field.
// Sourced from docs/omega/mapping.json; both alias to deals.id on Buddy's side.
export const DEAL_ENTITY_TYPES: ReadonlySet<string> = new Set([
  "deal",
  "underwriting_case",
]);

export const READ_RESOURCE_RE = /^omega:\/\/(state|confidence|traces|advisory)\//;

export function isReadResource(resource: string): boolean {
  return READ_RESOURCE_RE.test(resource);
}

/**
 * Translate a Buddy omega:// resource URI into a Pulse MCP tool call.
 *
 * Returns null for read paths (currently kill-switched pending Pulse-side
 * deal-scoped advisory tools — see specs/omega-repair/PULSE-SIDE-SPEC.md)
 * and for unmapped URIs. Caller distinguishes the two.
 *
 * Throws `omega_write_missing_event_type` if the write path is invoked without
 * a `type` field — better to fail locally than send Pulse a body it will reject.
 */
export function translateResourceToToolCall(
  resource: string,
  payload: unknown,
  targetUserId: string | undefined,
): ToolCall | null {
  const baseArgs: Record<string, unknown> = targetUserId
    ? { target_user_id: targetUserId }
    : {};

  // Write path — explicit field mapping from Buddy envelope to buddy_ledger_write schema.
  if (resource === "omega://events/write") {
    const envelope = (payload ?? {}) as OmegaEventEnvelope;

    if (!envelope.type) {
      throw new Error("omega_write_missing_event_type");
    }

    const dealEntity = envelope.entities?.find(
      (e) => DEAL_ENTITY_TYPES.has(e.entity_type) && typeof e.id === "string",
    );

    return {
      tool: "buddy_ledger_write",
      arguments: {
        ...baseArgs,
        event_type: envelope.type,
        status: "success",
        ...(dealEntity?.id ? { deal_id: dealEntity.id } : {}),
        payload: {
          entities: envelope.entities ?? [],
          body: envelope.payload ?? {},
          ts: envelope.ts,
          correlationId: envelope.correlationId,
        },
      },
    };
  }

  // Health path — Pulse's designated zero-args connectivity probe.
  if (resource === "omega://health/ping") {
    return {
      tool: "mcp_tick",
      arguments: {},
    };
  }

  // Read paths — kill-switched pending Pulse-side deal-scoped advisory tools.
  if (isReadResource(resource)) {
    return null;
  }

  return null;
}
