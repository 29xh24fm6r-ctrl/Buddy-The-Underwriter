/**
 * Fire-and-forget emission of Buddy pipeline events.
 *
 * Writes to the durable outbox (buddy_outbox_events).
 * The buddy-core-worker forwards events to Pulse MCP.
 *
 * DOES NOT call Pulse directly. Never throws. Never blocks the request path.
 */

import { insertOutboxEvent } from "@/lib/outbox/insertOutboxEvent";

// ─── Allowed payload keys (no PII, no document content) ────────────────────

const ALLOWED_PAYLOAD_KEYS = new Set([
  "checklist_key",
  "document_type",
  "confidence",
  "match_source",
  "match_reason",
  "reason",
  "status",
  "stage",
  "doc_year",
  "doc_years",
  "artifact_id",
  "source_id",
  "ready",
  "ready_reason",
  "error_code",
  "duration_ms",
  "updated",
  "count",
  // Two-phase naming (no PII — entity names excluded)
  "naming_method",
  "naming_source",
  "fallback_reason",
  "anchor_doc_type",
]);

function filterPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (ALLOWED_PAYLOAD_KEYS.has(k)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "string" && v.length > 200) continue;
      out[k] = v;
    }
  }
  return out;
}

// ─── Public API (unchanged signature for call sites) ────────────────────────

export async function emitPipelineEvent(args: {
  kind: string;
  deal_id: string;
  bank_id?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const safePayload = args.payload ? filterPayload(args.payload) : {};

    await insertOutboxEvent({
      kind: args.kind,
      dealId: args.deal_id,
      bankId: args.bank_id ?? null,
      payload: safePayload,
    });
  } catch {
    // swallow — never block workflows
  }
}
