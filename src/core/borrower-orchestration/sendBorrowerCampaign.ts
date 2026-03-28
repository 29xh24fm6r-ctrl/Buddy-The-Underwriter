import "server-only";

/**
 * Phase 65F — Borrower Campaign Delivery
 *
 * Delivers a borrower request campaign via SMS and/or email.
 * Uses existing Twilio/Resend plumbing. Idempotent per campaign.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendSmsWithConsent } from "@/lib/sms/send";
import { getEmailProvider } from "@/lib/email/getProvider";

export type SendCampaignInput = {
  campaignId: string;
  dealId: string;
  bankId: string;
};

export type SendCampaignResult = {
  ok: boolean;
  smsSent: boolean;
  emailSent: boolean;
  portalUrl: string | null;
  error?: string;
};

export async function sendBorrowerCampaign(
  input: SendCampaignInput,
): Promise<SendCampaignResult> {
  const sb = supabaseAdmin();

  try {
    // Fetch campaign with portal link
    const { data: campaign } = await sb
      .from("borrower_request_campaigns")
      .select(
        "id, deal_id, borrower_phone, borrower_email, borrower_name, portal_link_id, status, action_code",
      )
      .eq("id", input.campaignId)
      .single();

    if (!campaign) {
      return { ok: false, smsSent: false, emailSent: false, portalUrl: null, error: "Campaign not found." };
    }

    // Build portal URL
    let portalUrl: string | null = null;
    if (campaign.portal_link_id) {
      const { data: link } = await sb
        .from("borrower_portal_links")
        .select("token")
        .eq("id", campaign.portal_link_id)
        .single();

      if (link?.token) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        portalUrl = `${appUrl}/upload/${link.token}`;
      }
    }

    // Count outstanding items for message context
    const { count: pendingCount } = await sb
      .from("borrower_request_items")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", input.campaignId)
      .eq("required", true)
      .in("status", ["pending", "sent"]);

    const itemCount = pendingCount ?? 0;
    let smsSent = false;
    let emailSent = false;

    // Send SMS
    if (campaign.borrower_phone && portalUrl) {
      try {
        const smsBody = buildSmsBody(campaign.borrower_name, itemCount, portalUrl);
        await sendSmsWithConsent({
          dealId: input.dealId,
          to: campaign.borrower_phone,
          body: smsBody,
          label: "Borrower campaign",
          metadata: {
            campaign_id: input.campaignId,
            action_code: campaign.action_code,
          },
        });
        smsSent = true;

        await sb.from("borrower_request_events").insert({
          campaign_id: input.campaignId,
          deal_id: input.dealId,
          event_key: "borrower_campaign.sent",
          channel: "sms",
          payload: { to: campaign.borrower_phone, item_count: itemCount },
        });
      } catch (smsErr) {
        console.warn("[sendBorrowerCampaign] SMS failed:", smsErr);
      }
    }

    // Send email
    if (campaign.borrower_email && portalUrl) {
      try {
        const emailProvider = getEmailProvider();
        await emailProvider.send({
          to: campaign.borrower_email,
          from: "Buddy <no-reply@usebuddy.com>",
          subject: buildEmailSubject(campaign.borrower_name),
          text: buildEmailBody(campaign.borrower_name, itemCount, portalUrl),
        });

        emailSent = true;
        await sb.from("borrower_request_events").insert({
          campaign_id: input.campaignId,
          deal_id: input.dealId,
          event_key: "borrower_campaign.sent",
          channel: "email",
          payload: { to: campaign.borrower_email, item_count: itemCount },
        });
      } catch (emailErr) {
        console.warn("[sendBorrowerCampaign] Email failed:", emailErr);
      }
    }

    // Update campaign status + sent timestamp
    const newStatus = smsSent || emailSent ? "sent" : campaign.status;
    await sb
      .from("borrower_request_campaigns")
      .update({
        status: newStatus,
        last_sent_at: new Date().toISOString(),
      })
      .eq("id", input.campaignId);

    // Update item statuses to "sent"
    if (smsSent || emailSent) {
      await sb
        .from("borrower_request_items")
        .update({ status: "sent" })
        .eq("campaign_id", input.campaignId)
        .eq("status", "pending");
    }

    return { ok: true, smsSent, emailSent, portalUrl };
  } catch (err) {
    return {
      ok: false,
      smsSent: false,
      emailSent: false,
      portalUrl: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildSmsBody(name: string | null, itemCount: number, portalUrl: string): string {
  const greeting = name ? `Hi ${name}` : "Hi";
  const itemText = itemCount === 1 ? "1 item" : `${itemCount} items`;
  return `${greeting}, your lender needs ${itemText} to keep your application moving.\n\nUpload here: ${portalUrl}\n\nReply STOP to opt out.`;
}

function buildEmailSubject(name: string | null): string {
  return name
    ? `${name}, documents requested for your application`
    : "Documents requested for your application";
}

function buildEmailBody(name: string | null, itemCount: number, portalUrl: string): string {
  const greeting = name ? `Hi ${name},` : "Hello,";
  const itemText = itemCount === 1 ? "1 item" : `${itemCount} items`;
  return [
    greeting,
    "",
    `Your lender has requested ${itemText} to keep your loan application moving.`,
    "",
    `Please upload your documents here:`,
    portalUrl,
    "",
    "If you have any questions, please contact your lender directly.",
    "",
    "Thank you,",
    "Buddy",
  ].join("\n");
}
