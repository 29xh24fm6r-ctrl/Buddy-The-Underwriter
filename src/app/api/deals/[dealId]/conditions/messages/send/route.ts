import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getQueuedMessages } from "@/lib/conditions/messaging/queue";
import { sendNotification, updateMessageStatus } from "@/lib/notifications/send";
import { recordMessageSent } from "@/lib/conditions/messaging/throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await context.params;
    const body = await req.json();
    const { message_ids, auto_send } = body;

    const sb = supabaseAdmin();
    const results = [];

    // Get messages to send
    let messages;
    if (message_ids && message_ids.length > 0) {
      // Send specific messages
      const { data } = await (sb as any)
        .from("condition_messages")
        .select("*")
        .in("id", message_ids)
        .eq("application_id", dealId);
      messages = data || [];
    } else if (auto_send) {
      // Auto-send all queued messages that don't require approval
      messages = await getQueuedMessages(dealId, {
        status: ["QUEUED"],
      });
      messages = messages.filter((m) => !m.requires_approval);
    } else {
      return NextResponse.json(
        { ok: false, error: "No messages specified" },
        { status: 400 }
      );
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No messages to send",
        sent: 0,
      });
    }

    // Send each message
    for (const message of messages) {
      // Send through appropriate channel
      const result = await sendNotification(message);

      // Update message status
      await updateMessageStatus(message.id, result);

      // Record in throttle if successful
      if (result.success) {
        await recordMessageSent(dealId, message.condition_id, message.id);
      }

      results.push({
        message_id: message.id,
        condition_id: message.condition_id,
        channel: message.channel,
        success: result.success,
        error: result.error,
      });
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({
      ok: true,
      sent: successful,
      failed,
      results,
    });
  } catch (err: any) {
    console.error("Message send failed:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "send_failed" },
      { status: 500 }
    );
  }
}

// Approve and queue messages
export async function PATCH(req: Request, context: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await context.params;
    const body = await req.json();
    const { message_ids, approved_by } = body;

    if (!message_ids || message_ids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No messages specified" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    // Approve messages (change status from DRAFT to QUEUED)
    await (sb as any)
      .from("condition_messages")
      .update({
        status: "QUEUED",
        requires_approval: false,
        metadata: (sb as any).raw(
          `metadata || '{"approved_by": "${approved_by}", "approved_at": "${new Date().toISOString()}"}'::jsonb`
        ),
      })
      .in("id", message_ids)
      .eq("application_id", dealId)
      .eq("status", "DRAFT");

    return NextResponse.json({
      ok: true,
      approved: message_ids.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "approval_failed" },
      { status: 500 }
    );
  }
}
