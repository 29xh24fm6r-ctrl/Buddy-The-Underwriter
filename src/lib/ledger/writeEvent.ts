import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ⚠️ IMPORTANT: deal_events schema uses `payload` (jsonb)
// There is NO `metadata` column. Do not add one.
// Reads should use audit_ledger view, writes use deal_events table directly.

export type LedgerEventKind = string;

export type WriteLedgerEventArgs = {
  dealId: string;
  kind: string;
  actorUserId?: string | null;
  scope?: string;
  action?: string;
  input?: unknown;
  output?: unknown;
  confidence?: number | null;
  evidence?: unknown;
  requiresHumanReview?: boolean;
  meta?: Record<string, unknown>;
};

type DealEventInsert = {
  deal_id: string;
  kind: string;
  payload: Record<string, any>;
  // ⚠️ NO metadata field - use payload only
};

/**
 * Write an event to the canonical ledger via deal_events table.
 * Never throws; returns { ok: boolean, error?: string }.
 */
export async function writeEvent(
  args: WriteLedgerEventArgs
): Promise<{ ok: boolean; error?: string }> {
  try {
    console.log("[ledger.writeEvent] start", {
      kind: args.kind,
      dealId: args.dealId,
      hasServiceRole: Boolean(
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
      ),
    });

    const sb = supabaseAdmin();

    const payload = {
      actor_user_id: args.actorUserId ?? null,
      scope: args.scope ?? null,
      action: args.action ?? null,
      input: args.input ?? null,
      output: args.output ?? null,
      confidence: args.confidence ?? null,
      evidence: args.evidence ?? null,
      requires_human_review: args.requiresHumanReview ?? false,
      meta: args.meta ?? {},
    };

    // Cap payload size at 50KB
    try {
      const s = JSON.stringify(payload);
      if (s.length > 50000) {
        payload.input = { truncated: true };
        payload.output = { truncated: true };
        payload.evidence = { truncated: true };
        payload.meta = {
          ...(payload.meta || {}),
          truncated: true,
          original_size: s.length,
        };
      }
    } catch {}

    const insertData: DealEventInsert = {
      deal_id: args.dealId,
      kind: args.kind,
      payload,
    };

    const { error } = await sb.from("deal_events").insert(insertData);

    if (error) {
      console.error("[ledger.writeEvent] insert failed", {
        kind: args.kind,
        dealId: args.dealId,
        error,
      });
      return { ok: false, error: error.message };
    }

    console.log("[ledger.writeEvent] insert ok", {
      kind: args.kind,
      dealId: args.dealId,
    });
    return { ok: true };
  } catch (error: any) {
    console.error("[ledger.writeEvent] catch", {
      kind: args.kind,
      dealId: args.dealId,
      error,
    });
    return { ok: false, error: error?.message || "Unknown error" };
  }
}
