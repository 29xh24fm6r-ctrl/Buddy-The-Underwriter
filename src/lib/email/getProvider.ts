import { EmailProvider } from "@/lib/email/provider";
import { StubEmailProvider } from "@/lib/email/providers/stub";
import { ResendProvider } from "@/lib/email/providers/resend";

export function getEmailProvider(): EmailProvider {
  // Safe default
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) return new ResendProvider(resendKey);
  return new StubEmailProvider();
}
