import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type SmsTimelineItem =
  | {
      kind: "sms.outbound";
      createdAt: string;
      to: string;
      body?: string;
      status?: string | null;
      provider_message_id?: string | null;
      error?: string | null;
    }
  | {
      kind: "sms.inbound";
      createdAt: string;
      from: string;
      body: string;
      messageSid?: string | null;
    }
  | {
      kind: "sms.status";
      createdAt: string;
      messageSid?: string | null;
      messageStatus?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      to?: string | null;
    };

/**
 * Get SMS timeline for a deal from outbound_messages + deal_events
 * Combines sent SMS (outbound_messages) with inbound replies (deal_events)
 */
export async function getDealSmsTimeline(dealId: string): Promise<SmsTimelineItem[]> {
  const sb = supabaseAdmin();

  // Get outbound SMS from outbound_messages table
  const { data: outbound, error: outboundErr } = await sb
    .from("outbound_messages")
    .select("*")
    .eq("deal_id", dealId)
    .eq("channel", "sms")
    .order("created_at", { ascending: true });

  if (outboundErr) {
    console.error("getDealSmsTimeline outbound error:", outboundErr);
  }

  // Get inbound SMS from deal_events (sms_inbound, sms_reply, etc.)
  const { data: events, error: eventsErr } = await sb
    .from("deal_events")
    .select("*")
    .eq("deal_id", dealId)
    .or("kind.eq.sms_inbound,kind.eq.sms_reply,kind.eq.sms_status")
    .order("created_at", { ascending: true });

  if (eventsErr) {
    console.error("getDealSmsTimeline events error:", eventsErr);
  }

  const items: SmsTimelineItem[] = [];

  // Map outbound_messages to timeline items
  (outbound || []).forEach((msg) => {
    items.push({
      kind: "sms.outbound",
      createdAt: msg.created_at,
      to: msg.to_value,
      body: msg.body,
      status: msg.status,
      provider_message_id: msg.provider_message_id,
      error: msg.error,
    });
  });

  // Map deal_events to timeline items
  (events || []).forEach((event) => {
    const metadata = event.metadata || {};

    if (event.kind === "sms_inbound" || event.kind === "sms_reply") {
      items.push({
        kind: "sms.inbound",
        createdAt: event.created_at,
        from: metadata.from || metadata.From || "",
        body: metadata.body || metadata.Body || "",
        messageSid: metadata.messageSid || metadata.MessageSid || null,
      });
    }

    if (event.kind === "sms_status") {
      items.push({
        kind: "sms.status",
        createdAt: event.created_at,
        messageSid: metadata.messageSid || metadata.MessageSid || null,
        messageStatus: metadata.messageStatus || metadata.MessageStatus || null,
        errorCode: metadata.errorCode || metadata.ErrorCode || null,
        errorMessage: metadata.errorMessage || metadata.ErrorMessage || null,
        to: metadata.to || metadata.To || null,
      });
    }
  });

  // Sort by created_at
  items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return items;
}
