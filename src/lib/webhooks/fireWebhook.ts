import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * 🔔 Deal Webhooks — Automation Edge
 * 
 * Fire webhooks on canonical state transitions:
 * - deal.ready (ready_at: null → set)
 * - deal.submitted (submitted_at set)
 * 
 * Schema:
 * CREATE TABLE deal_webhooks (
 *   id uuid primary key default gen_random_uuid(),
 *   bank_id uuid not null,
 *   url text not null,
 *   event text not null
 * );
 */

export type WebhookEvent = "deal.ready" | "deal.submitted";

export type WebhookPayload = {
  event: WebhookEvent;
  deal_id: string;
  bank_id: string;
  timestamp: string;
  data: Record<string, any>;
};

/**
 * Fire webhook for a given event
 * 
 * - Fetches registered webhooks for bank
 * - POSTs to each URL
 * - Logs failures (no retries initially)
 */
export async function fireWebhook(
  event: WebhookEvent,
  payload: {
    deal_id: string;
    bank_id: string;
    data: Record<string, any>;
  }
): Promise<void> {
  const sb = supabaseAdmin();

  try {
    // Fetch registered webhooks for this bank + event
    const { data: webhooks } = await sb
      .from("deal_webhooks")
      .select("id, url")
      .eq("bank_id", payload.bank_id)
      .eq("event", event);

    if (!webhooks || webhooks.length === 0) {
      console.log("[webhook] No webhooks registered", { event, bank_id: payload.bank_id });
      return;
    }

    const webhookPayload: WebhookPayload = {
      event,
      deal_id: payload.deal_id,
      bank_id: payload.bank_id,
      timestamp: new Date().toISOString(),
      data: payload.data,
    };

    // Fire to all registered URLs (no retry logic yet)
    const results = await Promise.allSettled(
      webhooks.map(async (hook) => {
        const res = await fetch(hook.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(webhookPayload),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }

        return { hook_id: hook.id, status: "success" };
      })
    );

    // Log failures
    results.forEach((result, idx) => {
      if (result.status === "rejected") {
        console.error("[webhook] Failed to fire", {
          event,
          url: webhooks[idx].url,
          error: result.reason,
        });
      } else {
        console.log("[webhook] Fired successfully", {
          event,
          url: webhooks[idx].url,
        });
      }
    });
  } catch (err: any) {
    console.error("[webhook] Unexpected error", { event, error: err.message });
  }
}
