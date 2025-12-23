// src/lib/reminders/sendReminder.ts
import "server-only";
import { getEmailProvider } from "@/lib/email/getProvider";

type Channel = "email" | "sms";

export async function sendReminderMessage(args: {
  channel: Channel;
  destination: string;
  dealId: string;
  missingKeys: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { channel, destination, dealId, missingKeys } = args;

  const message = `Deal ${dealId}: missing checklist keys: ${missingKeys.join(", ")}`;

  if (process.env.NODE_ENV !== "production") {
    console.log(`[REMINDER:${channel}] -> ${destination} :: ${message}`);
  }

  // Use real email provider
  if (channel === "email") {
    try {
      const provider = getEmailProvider();
      const from = process.env.EMAIL_FROM || "reminders@buddy.com";
      await provider.send({
        to: destination,
        from,
        subject: `Deal ${dealId} - Missing Documents Reminder`,
        text: message,
      });
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }

  // SMS not yet implemented
  return { ok: false, error: "SMS reminder provider not configured." };
}
