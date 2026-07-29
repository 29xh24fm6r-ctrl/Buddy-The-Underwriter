// src/lib/notify/providers.ts
import "server-only";

type SendEmailArgs = { to: string; subject: string; text: string };
type SendSmsArgs = { to: string; text: string };

export async function sendEmail(args: SendEmailArgs): Promise<{ ok: true } | { ok: false; error: string }> {
  const { to, subject, text } = args;

  // DEV: log only
  if (process.env.NODE_ENV !== "production") {
    console.log(`[EMAIL] to=${to} subject=${subject}\n${text}`);
    return { ok: true };
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY missing" };

  try {
    // Minimal Resend REST call (no dependency)
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: "Buddy <no-reply@yourdomain.com>",
        to: [to],
        subject,
        text,
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `Resend failed: ${res.status} ${t}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Email send failed" };
  }
}

export async function sendSms(args: SendSmsArgs): Promise<{ ok: true } | { ok: false; error: string }> {
  const { to, text } = args;

  // DEV: log only
  if (process.env.NODE_ENV !== "production") {
    console.log(`[SMS] to=${to}\n${text}`);
    return { ok: true };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { ok: false, error: "Twilio env vars missing" };

  try {
    const body = new URLSearchParams();
    body.set("From", from);
    body.set("To", to);
    body.set("Body", text);

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `Twilio failed: ${res.status} ${t}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "SMS send failed" };
  }
}
