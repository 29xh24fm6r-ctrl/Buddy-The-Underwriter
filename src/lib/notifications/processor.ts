/**
 * Notification Service
 * 
 * Processes notification queue and sends emails/SMS based on deal events
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

type NotificationQueueItem = {
  id: string;
  deal_id: string;
  event_id?: string;
  notification_type: "email" | "sms" | "in_app";
  recipient: string;
  subject?: string;
  body: string;
  template_key?: string;
  metadata: any;
  status: "pending" | "sent" | "failed" | "skipped";
};

type EmailProvider = "resend" | "sendgrid" | "ses";
type SmsProvider = "twilio" | "messagebird";

/**
 * Send email via configured provider
 */
async function sendEmail(item: NotificationQueueItem): Promise<{
  ok: boolean;
  provider: EmailProvider;
  response?: any;
  error?: string;
}> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn("No RESEND_API_KEY configured, skipping email");
    return {
      ok: false,
      provider: "resend",
      error: "No email provider configured",
    };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Buddy <noreply@buddy.app>",
        to: [item.recipient],
        subject: item.subject || "Notification from Buddy",
        html: formatEmailBody(item),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.message || `HTTP ${res.status}`);
    }

    return {
      ok: true,
      provider: "resend",
      response: data,
    };
  } catch (error: any) {
    console.error("Email send error:", error);
    return {
      ok: false,
      provider: "resend",
      error: error?.message || "Failed to send email",
    };
  }
}

/**
 * Send SMS via configured provider
 */
async function sendSms(item: NotificationQueueItem): Promise<{
  ok: boolean;
  provider: SmsProvider;
  response?: any;
  error?: string;
}> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn("No Twilio credentials configured, skipping SMS");
    return {
      ok: false,
      provider: "twilio",
      error: "No SMS provider configured",
    };
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: fromNumber,
          To: item.recipient,
          Body: item.body,
        }).toString(),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.message || `HTTP ${res.status}`);
    }

    return {
      ok: true,
      provider: "twilio",
      response: data,
    };
  } catch (error: any) {
    console.error("SMS send error:", error);
    return {
      ok: false,
      provider: "twilio",
      error: error?.message || "Failed to send SMS",
    };
  }
}

/**
 * Format email body with template
 */
function formatEmailBody(item: NotificationQueueItem): string {
  const baseStyle = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <h2 style="margin: 0 0 10px 0; color: #111;">Buddy Notification</h2>
        <p style="margin: 0; color: #666; font-size: 14px;">${item.subject || "Update"}</p>
      </div>
      <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px;">
        ${item.body}
      </div>
      ${
        item.metadata?.deal_id
          ? `
        <div style="margin-top: 20px; padding: 15px; background: #f3f4f6; border-radius: 8px;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/deals/${item.metadata.deal_id}/cockpit" 
             style="color: #2563eb; text-decoration: none; font-weight: 500;">
            View Deal in Buddy →
          </a>
        </div>
      `
          : ""
      }
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #999; font-size: 12px; text-align: center;">
        <p>Buddy - The Underwriter</p>
      </div>
    </div>
  `;

  return baseStyle;
}

/**
 * Process a single notification from the queue
 */
export async function processNotification(
  item: NotificationQueueItem
): Promise<{
  ok: boolean;
  sent: boolean;
  skipped: boolean;
  error?: string;
}> {
  const sb = supabaseAdmin();

  // Skip if already processed
  if (item.status !== "pending") {
    return { ok: true, sent: false, skipped: true };
  }

  let result: { ok: boolean; provider: string; response?: any; error?: string };

  // Send based on type
  if (item.notification_type === "email") {
    result = await sendEmail(item);
  } else if (item.notification_type === "sms") {
    result = await sendSms(item);
  } else {
    // In-app notifications - just mark as sent (no external API)
    result = { ok: true, provider: "in_app" };
  }

  // Update queue status
  await sb
    .from("notification_queue")
    .update({
      status: result.ok ? "sent" : "failed",
      error_message: result.error || null,
      sent_at: result.ok ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  // Log to notification_log
  await sb.from("notification_log").insert({
    queue_id: item.id,
    notification_type: item.notification_type,
    recipient: item.recipient,
    status: result.ok ? "sent" : "failed",
    provider: result.provider,
    provider_response: result.response || null,
  });

  return {
    ok: true,
    sent: result.ok,
    skipped: false,
    error: result.error,
  };
}

/**
 * Process all pending notifications in the queue
 */
export async function processPendingNotifications(): Promise<{
  ok: boolean;
  processed: number;
  sent: number;
  failed: number;
  errors: string[];
}> {
  const sb = supabaseAdmin();

  // Fetch pending notifications
  const { data: items, error } = await sb
    .from("notification_queue")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100); // Process in batches

  if (error) {
    console.error("Failed to fetch notification queue:", error);
    return { ok: false, processed: 0, sent: 0, failed: 0, errors: [error.message] };
  }

  if (!items || items.length === 0) {
    return { ok: true, processed: 0, sent: 0, failed: 0, errors: [] };
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  // Process each notification
  for (const item of items) {
    try {
      const result = await processNotification(item as NotificationQueueItem);
      if (result.sent) {
        sent++;
      } else if (result.error) {
        failed++;
        errors.push(`${item.id}: ${result.error}`);
      }
    } catch (error: any) {
      failed++;
      errors.push(`${item.id}: ${error?.message || "Unknown error"}`);
    }
  }

  return {
    ok: true,
    processed: items.length,
    sent,
    failed,
    errors,
  };
}

/**
 * Queue a notification for a deal event
 */
export async function queueDealEventNotification(params: {
  dealId: string;
  eventId?: string;
  eventKind: string;
  recipients: { email?: string; phone?: string }[];
  subject: string;
  body: string;
  metadata?: any;
}): Promise<{ ok: boolean; queued: number }> {
  const sb = supabaseAdmin();

  const notifications: any[] = [];

  for (const recipient of params.recipients) {
    if (recipient.email) {
      notifications.push({
        deal_id: params.dealId,
        event_id: params.eventId || null,
        notification_type: "email",
        recipient: recipient.email,
        subject: params.subject,
        body: params.body,
        template_key: params.eventKind,
        metadata: params.metadata || {},
      });
    }

    if (recipient.phone) {
      notifications.push({
        deal_id: params.dealId,
        event_id: params.eventId || null,
        notification_type: "sms",
        recipient: recipient.phone,
        subject: params.subject,
        body: params.body,
        template_key: params.eventKind,
        metadata: params.metadata || {},
      });
    }
  }

  if (notifications.length === 0) {
    return { ok: true, queued: 0 };
  }

  const { error } = await sb.from("notification_queue").insert(notifications);

  if (error) {
    console.error("Failed to queue notifications:", error);
    return { ok: false, queued: 0 };
  }

  return { ok: true, queued: notifications.length };
}
