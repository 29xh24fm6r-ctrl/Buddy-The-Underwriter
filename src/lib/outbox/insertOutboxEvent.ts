/**
 * Durable outbox insert for Buddy → Pulse pipeline events.
 *
 * Best-effort: never throws to the request path caller.
 * Buddy writes only; the buddy-core-worker forwards and marks delivered.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_PAYLOAD_BYTES = 16_384; // 16 KB

/**
 * Insert a pipeline event into the durable outbox.
 * The buddy-core-worker will pick it up and forward to Pulse.
 *
 * Never throws — logs a warning on failure and returns.
 */
export async function insertOutboxEvent(args: {
  kind: string;
  dealId: string;
  bankId?: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    // Enforce max payload size by serializing and checking length
    let safePayload = args.payload;
    const serialized = JSON.stringify(safePayload);
    if (serialized.length > MAX_PAYLOAD_BYTES) {
      // Truncate: keep only keys with short values
      const pruned: Record<string, unknown> = {};
      let size = 2; // opening/closing braces
      for (const [k, v] of Object.entries(safePayload)) {
        const entry = JSON.stringify({ [k]: v });
        if (size + entry.length < MAX_PAYLOAD_BYTES) {
          pruned[k] = v;
          size += entry.length;
        }
      }
      safePayload = pruned;
    }

    const sb = supabaseAdmin();
    const { error } = await sb.from("buddy_outbox_events").insert({
      kind: args.kind,
      deal_id: args.dealId,
      bank_id: args.bankId ?? null,
      payload: safePayload,
    });

    if (error) {
      console.warn("[outbox] insert failed:", error.message);
    }
  } catch (err: any) {
    console.warn("[outbox] insert failed:", err?.message ?? "unknown");
  }
}
