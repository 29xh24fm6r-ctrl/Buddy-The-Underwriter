import { EmailProvider, SendEmailArgs, SendEmailResult } from "@/lib/email/provider";
import { Resend } from "resend";

export class ResendProvider implements EmailProvider {
  private resend: Resend;

  constructor(apiKey: string) {
    this.resend = new Resend(apiKey);
  }

  async send(args: SendEmailArgs): Promise<SendEmailResult> {
    try {
      const { data, error } = await this.resend.emails.send({
        from: args.from,
        to: [args.to],
        subject: args.subject,
        text: args.text,
      });

      if (error) {
        throw new Error(`resend_error: ${error.message}`);
      }

      return { provider: "resend", provider_message_id: data?.id ?? null };
    } catch (error: any) {
      throw new Error(`resend_failed: ${error.message}`);
    }
  }
}
