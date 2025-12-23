import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getEmailProvider } from "@/lib/email/getProvider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[dealId]/messages/[messageId]/send
 * 
 * Approve and send a draft message (DRAFT → SENT)
 * Updates throttle records
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; messageId: string }> }
) {
  await requireRole(["underwriter", "bank_admin", "super_admin"]);
  const { dealId, messageId } = await ctx.params;
  const supabase = supabaseAdmin();

  // 1) Fetch message
  const { data: msg, error: e1 } = await supabase
    .from("condition_messages")
    .select("*")
    .eq("id", messageId)
    .eq("application_id", dealId)
    .single();

  if (e1 || !msg) {
    return NextResponse.json({ ok: false, error: "message_not_found" }, { status: 404 });
  }

  if ((msg as any).status !== "DRAFT") {
    return NextResponse.json({ ok: false, error: "not_draft" }, { status: 400 });
  }

  // 2) Update message status
  const { error: e2 } = await (supabase as any)
    .from("condition_messages")
    .update({ status: "SENT", sent_at: new Date().toISOString() })
    .eq("id", messageId);

  if (e2) {
    return NextResponse.json({ ok: false, error: e2.message }, { status: 500 });
  }

  // 3) Update throttle
  const { data: throttle } = await (supabase as any)
    .from("condition_message_throttles")
    .select("*")
    .eq("application_id", dealId)
    .eq("condition_id", (msg as any).condition_id)
    .maybeSingle();

  if (throttle) {
    await (supabase as any)
      .from("condition_message_throttles")
      .update({
        send_count: ((throttle as any).send_count ?? 0) + 1,
        last_sent_at: new Date().toISOString(),
        last_message_id: messageId,
      })
      .eq("id", (throttle as any).id);
  } else {
    await (supabase as any).from("condition_message_throttles").insert({
      application_id: dealId,
      condition_id: (msg as any).condition_id,
      send_count: 1,
      last_sent_at: new Date().toISOString(),
      last_message_id: messageId,
    });
  }

  // Deliver message via email
  let deliverySuccess = false;
  let deliveryError = null;

  try {
    // Get application contact email
    const { data: app } = await supabase
      .from("applications")
      .select("contact_email")
      .eq("id", dealId)
      .maybeSingle();

    if (app?.contact_email) {
      const provider = getEmailProvider();
      const from = process.env.EMAIL_FROM || "noreply@buddy.com";
      await provider.send({
        to: app.contact_email,
        from,
        subject: (msg as any).subject || "Message from your lender",
        text: (msg as any).body,
      });
      deliverySuccess = true;
    } else {
      deliveryError = "No contact email found for application";
    }
  } catch (error: any) {
    deliveryError = error.message;
    console.error(`[messages/send] delivery error:`, error);
  }

  // Update message with delivery status
  if (!deliverySuccess && deliveryError) {
    await (supabase as any)
      .from("condition_messages")
      .update({ 
        metadata: { 
          ...((msg as any).metadata || {}),
          delivery_error: deliveryError 
        }
      })
      .eq("id", messageId);
  }

  return NextResponse.json({ 
    ok: true, 
    message_id: messageId,
    delivered: deliverySuccess,
    delivery_error: deliveryError || undefined,
  });
}

/**
 * DELETE /api/deals/[dealId]/messages/[messageId]
 * 
 * Delete a draft message
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; messageId: string }> }
) {
  await requireRole(["underwriter", "bank_admin", "super_admin"]);
  const { dealId, messageId } = await ctx.params;
  const supabase = supabaseAdmin();

  const { error } = await supabase
    .from("condition_messages")
    .delete()
    .eq("id", messageId)
    .eq("application_id", dealId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
