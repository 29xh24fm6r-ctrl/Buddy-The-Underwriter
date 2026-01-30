/**
 * Fire-and-forget emission of Buddy pipeline events.
 *
 * 1. Generate stable event_id (UUID v7)
 * 2. Write to durable outbox (buddy_outbox_events) — ALWAYS happens first
 * 3. Fire-and-forget fast-lane delivery to Pulse — best-effort only
 *
 * The outbox is the SYSTEM OF RECORD. Pulse delivery is eventually consistent.
 * The buddy-core-worker is the canonical forwarder with retry/backoff.
 * The fast lane provides immediate visibility when Pulse is available.
 *
 * NEVER throws. NEVER blocks the request path.
 */

import { insertOutboxEvent } from "@/lib/outbox/insertOutboxEvent";
import { uuidv7 } from "@/lib/uuid/v7";

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
    const eventId = uuidv7();
    const safePayload = args.payload ? filterPayload(args.payload) : {};

    // Step 1: ALWAYS write to outbox first (system of record)
    await insertOutboxEvent({
      id: eventId,
      kind: args.kind,
      dealId: args.deal_id,
      bankId: args.bank_id ?? null,
      payload: safePayload,
    });

    // Step 2: Fire-and-forget fast-lane delivery to Pulse (never awaited)
    void tryFastLane(eventId, args.kind, args.deal_id, args.bank_id ?? null, safePayload);
  } catch {
    // swallow — never block workflows
  }
}

/**
 * Fast-lane: attempt immediate delivery to Pulse.
 * Dynamic import avoids circular deps and keeps the fast lane optional.
 */
async function tryFastLane(
  eventId: string,
  kind: string,
  dealId: string,
  bankId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const { tryForwardToPulse } = await import("@/lib/outbox/tryForwardToPulse");
    await tryForwardToPulse({ eventId, kind, dealId, bankId, payload });
  } catch {
    // swallow — fast lane must never block
  }
}
