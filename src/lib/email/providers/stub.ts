import { EmailProvider, SendEmailArgs, SendEmailResult } from "@/lib/email/provider";

export class StubEmailProvider implements EmailProvider {
  async send(args: SendEmailArgs): Promise<SendEmailResult> {
    console.log("[EMAIL:STUB]", {
      to: args.to,
      from: args.from,
      subject: args.subject,
      preview: args.text.slice(0, 220),
    });
    return { provider: "stub", provider_message_id: null };
  }
}
