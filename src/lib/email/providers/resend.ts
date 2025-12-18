import { EmailProvider, SendEmailArgs, SendEmailResult } from "@/lib/email/provider";

export class ResendProvider implements EmailProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send(args: SendEmailArgs): Promise<SendEmailResult> {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: args.from,
        to: [args.to],
        subject: args.subject,
        text: args.text,
      }),
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error(`resend_failed: ${r.status} ${JSON.stringify(j)}`);
    }

    return { provider: "resend", provider_message_id: j?.id ?? null };
  }
}
