// src/lib/reminders/sendReminder.ts
import "server-only";

type Channel = "email" | "sms";

export async function sendReminderMessage(args: {
  channel: Channel;
  destination: string;
  dealId: string;
  missingKeys: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { channel, destination, dealId, missingKeys } = args;

  // Minimal "pluggable" sender.
  // Implement Resend/Twilio when you're ready; for now it's a safe no-op in dev.
  const message = `Deal ${dealId}: missing checklist keys: ${missingKeys.join(", ")}`;

  if (process.env.NODE_ENV !== "production") {
    console.log(`[REMINDER:${channel}] -> ${destination} :: ${message}`);
    return { ok: true };
  }

  // TODO: wire to Resend/Twilio providers
  return { ok: false, error: "Reminder provider not configured." };
}
