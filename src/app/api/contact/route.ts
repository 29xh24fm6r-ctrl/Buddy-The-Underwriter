import { NextResponse } from "next/server";
import { Resend } from "resend";
import { resolveEnvFallbackEmailRouting } from "@/lib/email/env";
import { loadBankEmailRouting } from "@/lib/email/bankRouting";

type ContactPayload = {
  name?: string;
  email?: string;
  company?: string;
  subject?: string;
  message: string;
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  let body: ContactPayload;
  try {
    body = (await req.json()) as ContactPayload;
  } catch {
    return json(400, { ok: false, error: "Invalid JSON" });
  }

  const message = (body.message ?? "").trim();
  if (!message) return json(400, { ok: false, error: "Message is required" });

  const subject = (body.subject ?? "New contact form submission").trim();
  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  const company = (body.company ?? "").trim();

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return json(500, { ok: false, error: "RESEND_API_KEY is not configured" });

  // Bank-configured routing (prod path). If absent, fall back to env (dev path).
  const { routing } = await loadBankEmailRouting();
  const envFallback = resolveEnvFallbackEmailRouting();

  // Tenant routing overrides env fallback
  const fromValue = routing?.outbound_from_email ?? envFallback.from?.value;
  const toValue = routing?.contact_to_email ?? envFallback.to?.value;

  // Reply-To rules: tenant config overrides, else use submitter email if provided, else env fallback
  const replyToValue =
    routing?.reply_to_mode === "configured"
      ? routing.configured_reply_to_email
      : null;

  // Friendly config error
  if (!fromValue || !toValue) {
    return json(500, {
      ok: false,
      error:
        "Contact email routing is not configured. Need FROM (EMAIL_FROM/OUTBOUND_FROM_EMAIL or bank outbound_from_email) and TO (CONTACT_TO_EMAIL or bank contact_to_email).",
      debug: {
        hasBankRouting: Boolean(routing),
        envFromKey: envFallback.from?.key,
        envToKey: envFallback.to?.key,
      },
    });
  }

  const text = [
    `Subject: ${subject}`,
    name ? `Name: ${name}` : null,
    email ? `Email: ${email}` : null,
    company ? `Company: ${company}` : null,
    "",
    message,
  ].filter(Boolean).join("\n");

  const resend = new Resend(resendKey);

  // Best UX: reply-to goes to the submitter if provided, else configured or env fallback
  const replyToHeader = email || replyToValue || envFallback.replyTo?.value || undefined;

  try {
    const result = await resend.emails.send({
      from: fromValue,
      to: [toValue],
      subject,
      text,
      ...(replyToHeader ? { replyTo: replyToHeader } : {}),
    });

    // tolerate SDK variants across Resend versions
    if ((result as any)?.error) {
      return json(502, { ok: false, error: (result as any).error });
    }

    return json(200, { ok: true });
  } catch (e: any) {
    return json(500, { ok: false, error: e?.message || "Failed to send email" });
  }
}
