// src/app/api/deals/[dealId]/borrower-request/send/route.ts
import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  hashPassword,
  makePasswordSalt,
  randomToken,
  sha256,
} from "@/lib/security/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ComposerBody = {
  channels: Array<"email" | "sms">;
  email?: string | null;
  phone?: string | null;
  borrowerName?: string | null;
  checklistKeys: string[];
  expiresInHours?: number;
  singleUse?: boolean;
  password?: string | null;
  enableReminders?: boolean;
  cadenceDays?: number;
  label?: string | null;
  note?: string | null;
};

type LegacyBody = {
  channel: "email" | "sms" | string;
  destination: string;
  startInHours?: number;
  cadenceDays?: number;
  active?: boolean;
  missingOnly?: boolean;
  stopAfterIso?: string;
};

function normalizeEmail(s: unknown): string | null {
  const v = String(s ?? "").trim();
  return v ? v : null;
}

function normalizeName(s: unknown): string | null {
  const v = String(s ?? "").trim();
  return v ? v : null;
}

function normalizePhone(s: unknown): string | null {
  const v = String(s ?? "").trim();
  return v ? v : null;
}

async function upsertReminderSubscription(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  dealId: string;
  channel: "email" | "sms";
  destination: string;
  cadenceDays: number;
  active: boolean;
}) {
  const now = new Date();
  const nextRunAt = new Date(now.getTime() + args.cadenceDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: existing, error: exErr } = await args.sb
    .from("deal_reminder_subscriptions")
    .select("id")
    .eq("deal_id", args.dealId)
    .eq("channel", args.channel)
    .eq("destination", args.destination)
    .maybeSingle();

  if (exErr) return { ok: false as const, error: exErr.message };

  if (existing?.id) {
    const { error: upErr } = await args.sb
      .from("deal_reminder_subscriptions")
      .update({
        active: args.active,
        next_run_at: nextRunAt,
        cadence_days: args.cadenceDays,
        missing_only: true,
        enabled: args.active,
      })
      .eq("id", existing.id);

    if (upErr) return { ok: false as const, error: upErr.message };
    return { ok: true as const, subscriptionId: existing.id, next_run_at: nextRunAt };
  }

  const { data: inserted, error: insErr } = await args.sb
    .from("deal_reminder_subscriptions")
    .insert({
      deal_id: args.dealId,
      channel: args.channel,
      destination: args.destination,
      cadence_days: args.cadenceDays,
      missing_only: true,
      active: args.active,
      next_run_at: nextRunAt,
      enabled: args.active,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insErr || !inserted) return { ok: false as const, error: insErr?.message || "insert_failed" };
  return { ok: true as const, subscriptionId: inserted.id, next_run_at: nextRunAt };
}

async function sendEmailBestEffort(args: { to: string; subject: string; text: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false as const, error: "email_not_configured" };

  const from = process.env.EMAIL_FROM || "noreply@buddy.com";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return { ok: false as const, error: `email_send_failed:${res.status}:${err}` };
  }
  return { ok: true as const };
}

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "deal_not_found" ? 404 : access.error === "tenant_mismatch" ? 403 : 400;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  const sb = supabaseAdmin();

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  // New UI payload (BorrowerRequestComposerCard)
  if (Array.isArray((raw as any).channels)) {
    const body = raw as ComposerBody;
    const channels = Array.from(new Set((body.channels || []).filter(Boolean)));
    const email = normalizeEmail(body.email);
    const phone = normalizePhone(body.phone);
    const borrowerName = normalizeName(body.borrowerName);
    const checklistKeys = Array.from(new Set((body.checklistKeys || []).map((k) => String(k).trim()).filter(Boolean)));

    if (checklistKeys.length === 0) {
      return NextResponse.json({ ok: false, error: "No checklist keys selected" }, { status: 400 });
    }

    if (channels.includes("email") && !email) {
      return NextResponse.json({ ok: false, error: "Email required" }, { status: 400 });
    }
    if (channels.includes("sms") && !phone) {
      return NextResponse.json({ ok: false, error: "Phone required" }, { status: 400 });
    }

    const expiresInHours = Math.max(1, Math.min(24 * 30, Number(body.expiresInHours ?? 72)));
    const singleUse = body.singleUse ?? true;
    const label = (body.label ?? "Borrower document request").trim() || "Borrower document request";

    const token = randomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();

    const passwordRaw = String(body.password ?? "").trim();
    const requirePassword = !!passwordRaw;
    const passwordSalt = requirePassword ? makePasswordSalt() : null;
    const passwordHash = requirePassword ? hashPassword(passwordRaw, passwordSalt!) : null;

    const { data: linkRow, error: linkErr } = await sb
      .from("deal_upload_links")
      .insert({
        deal_id: dealId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        single_use: singleUse,
        require_password: requirePassword,
        password_salt: passwordSalt,
        password_hash: passwordHash,
        label,
        uploader_name_hint: borrowerName,
        uploader_email_hint: email,
      })
      .select("id")
      .single();

    if (linkErr || !linkRow) {
      return NextResponse.json({ ok: false, error: "Failed to create upload link" }, { status: 500 });
    }

    const inferredOrigin = (() => {
      try {
        return new URL(req.url).origin;
      } catch {
        return "";
      }
    })();

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || inferredOrigin || "").replace(/\/$/, "");
    const uploadUrl = appUrl ? `${appUrl}/upload/${encodeURIComponent(token)}` : `/upload/${encodeURIComponent(token)}`;

    const enableReminders = !!body.enableReminders;
    const cadenceDays = Math.max(1, Math.min(365, Number(body.cadenceDays ?? 3)));
    const reminderResults: any[] = [];
    if (enableReminders) {
      for (const ch of channels) {
        const destination = ch === "email" ? email : phone;
        if (!destination) continue;
        const r = await upsertReminderSubscription({
          sb,
          dealId,
          channel: ch,
          destination,
          cadenceDays,
          active: true,
        });
        reminderResults.push({ channel: ch, destination, ok: r.ok, error: r.ok ? null : r.error });
      }
    }

    const messageLines = [
      borrowerName ? `Hi ${borrowerName},` : "Hi,",
      "",
      "Please upload the requested documents using this link:",
      uploadUrl,
      "",
      body.note ? String(body.note).trim() : null,
      "",
      `Requested items (${checklistKeys.length}):`,
      ...checklistKeys.map((k) => `- ${k}`),
    ].filter(Boolean);

    const emailSubject = label;
    const emailText = messageLines.join("\n");

    const results: Array<{ channel: string; destination: string; ok: boolean; error?: string | null }> = [];
    for (const ch of channels) {
      if (ch === "email") {
        if (!email) continue;
        const r = await sendEmailBestEffort({ to: email, subject: emailSubject, text: emailText });
        results.push({ channel: "email", destination: email, ok: r.ok, error: r.ok ? null : r.error });
      } else if (ch === "sms") {
        if (!phone) continue;
        results.push({ channel: "sms", destination: phone, ok: false, error: "sms_not_configured" });
      }
    }

    return NextResponse.json({
      ok: true,
      dealId,
      uploadLinkId: linkRow.id,
      uploadUrl,
      expiresAt,
      results,
      reminders: enableReminders ? reminderResults : [],
    });
  }

  // Legacy payload (single subscription) for back-compat
  const body = raw as LegacyBody;
  const channel = String(body.channel || "").trim();
  const destination = String(body.destination || "").trim();
  if (!channel || !destination) {
    return NextResponse.json({ ok: false, error: "Missing channel/destination" }, { status: 400 });
  }

  const cadenceDays = Math.max(1, Math.min(365, Number(body.cadenceDays ?? 3)));
  const isActive = body.active ?? true;
  const r = await upsertReminderSubscription({
    sb,
    dealId,
    channel: channel === "sms" ? "sms" : "email",
    destination,
    cadenceDays,
    active: !!isActive,
  });

  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, dealId, subscriptionId: r.subscriptionId, next_run_at: r.next_run_at });
}
