// Send Adapters for Different Channels

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { QueuedMessage } from "@/lib/conditions/messaging/queue";

export type SendResult = {
  success: boolean;
  messageId: string;
  channel: string;
  error?: string;
  provider_response?: any;
};

// PORTAL adapter (in-app notifications)
export async function sendPortalNotification(message: QueuedMessage): Promise<SendResult> {
  try {
    const sb = supabaseAdmin();

    // Create in-app notification record
    await (sb as any).from("portal_notifications").insert({
      application_id: message.application_id,
      type: "CONDITION_UPDATE",
      title: message.subject,
      message: message.body,
      priority: message.priority,
      read: false,
      metadata: {
        condition_id: message.condition_id,
        message_id: message.id,
        trigger_type: message.trigger_type,
      },
    });

    return {
      success: true,
      messageId: message.id!,
      channel: "PORTAL",
    };
  } catch (error: any) {
    return {
      success: false,
      messageId: message.id!,
      channel: "PORTAL",
      error: error.message,
    };
  }
}

// EMAIL adapter (uses configured email provider)
import { getEmailProvider } from "@/lib/email/getProvider";

export async function sendEmailNotification(message: QueuedMessage): Promise<SendResult> {
  try {
    const sb = supabaseAdmin();

    // Get application email
    const { data: app } = await (sb as any)
      .from("applications")
      .select("contact_email")
      .eq("id", message.application_id)
      .single();

    if (!app?.contact_email) {
      throw new Error("No contact email found for application");
    }

    // Use real email provider
    const provider = getEmailProvider();
    const from = process.env.EMAIL_FROM || "noreply@buddy.com";
    
    try {
      await provider.send({
        to: app.contact_email,
        from,
        subject: message.subject || "Notification",
        text: message.body,
      });
      
      console.log(`📧 EMAIL SENT: ${app.contact_email}`);
      
      return {
        success: true,
        messageId: message.id!,
        channel: "EMAIL",
        provider_response: { status: "SENT" },
      };
    } catch (providerError: any) {
      // Log to email_queue table for retry
      await (sb as any).from("email_queue").insert({
        to_email: app.contact_email,
        subject: message.subject,
        body: message.body,
        priority: message.priority,
        status: "FAILED",
        metadata: {
          message_id: message.id,
          application_id: message.application_id,
          condition_id: message.condition_id,
          error: providerError.message,
        },
      });
      
      throw providerError;
    }
  } catch (error: any) {
    return {
      success: false,
      messageId: message.id!,
      channel: "EMAIL",
      error: error.message,
    };
  }
}

// SMS adapter (stub)
export async function sendSmsNotification(message: QueuedMessage): Promise<SendResult> {
  // Placeholder for SMS integration (Twilio, etc.)
  console.log(`📱 SMS: ${message.subject}`);

  return {
    success: true,
    messageId: message.id!,
    channel: "SMS",
    provider_response: { status: "NOT_IMPLEMENTED" },
  };
}

// Main send dispatcher
export async function sendNotification(message: QueuedMessage): Promise<SendResult> {
  switch (message.channel) {
    case "PORTAL":
      return sendPortalNotification(message);
    case "EMAIL":
      return sendEmailNotification(message);
    case "SMS":
      return sendSmsNotification(message);
    default:
      return {
        success: false,
        messageId: message.id!,
        channel: message.channel,
        error: `Unknown channel: ${message.channel}`,
      };
  }
}

// Update message status after send attempt
export async function updateMessageStatus(
  messageId: string,
  result: SendResult
): Promise<void> {
  const sb = supabaseAdmin();

  await (sb as any)
    .from("condition_messages")
    .update({
      status: result.success ? "SENT" : "FAILED",
      sent_at: result.success ? new Date().toISOString() : null,
      metadata: (sb as any).raw(
        `metadata || '${JSON.stringify({
          send_result: result,
          sent_at: new Date().toISOString(),
        })}'::jsonb`
      ),
    })
    .eq("id", messageId);
}
