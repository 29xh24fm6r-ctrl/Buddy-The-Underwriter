/**
 * Fire-and-forget emission of Buddy pipeline events.
 *
 * Writes to the durable outbox (buddy_outbox_events), which is the system of
 * record. The buddy-core-worker is the canonical forwarder with retry/backoff.
 *
 * Fastlane retired 2026-04-23 (FASTLANE-RETIRE) — outbox is the only
 * Buddy→Pulse forward path. The builder debug/health endpoints still use
 * pulseMcp/client directly; this module does not.
 *
 * NEVER throws. NEVER blocks the request path.
 */

import { insertOutboxEvent } from "@/lib/outbox/insertOutboxEvent";
import { uuidv7 } from "@/lib/uuid/v7";

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
  "trigger",
  "document_id",
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

export async function emitPipelineEvent(args: {
  kind: string;
  deal_id: string;
  bank_id?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const eventId = uuidv7();
    const safePayload = args.payload ? filterPayload(args.payload) : {};

    await insertOutboxEvent({
      id: eventId,
      kind: args.kind,
      dealId: args.deal_id,
      bankId: args.bank_id ?? null,
      payload: safePayload,
    });
  } catch {
    // swallow — never block workflows
  }
}
