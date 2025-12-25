// src/app/api/admin/outreach/owners/tick/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getEmailProvider } from "@/lib/email/getProvider";

async function sendEmail(to: string, subject: string, body: string) {
  try {
    const provider = getEmailProvider();
    const from = process.env.EMAIL_FROM || "noreply@buddy.com";
    await provider.send({ to, from, subject, text: body });
    return { ok: true };
  } catch (error: any) {
    console.error(`[EMAIL ERROR] To: ${to}, Error: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

export async function POST(req: Request) {
  const sb = supabaseAdmin();

  const url = new URL(req.url);
  const limit = Math.max(
    1,
    Math.min(100, Number(url.searchParams.get("limit") || 25)),
  );

  const nowIso = new Date().toISOString();

  const { data: queued, error } = await sb
    .from("deal_owner_outreach_queue")
    .select("*")
    .eq("status", "queued")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );

  let sent = 0;
  let failed = 0;

  for (const m of queued ?? []) {
    try {
      const r = await sendEmail(m.to_email, m.subject, m.body);
      if (!r.ok) throw new Error("provider_failed");

      await sb
        .from("deal_owner_outreach_queue")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", m.id);

      sent += 1;
    } catch (e: any) {
      await sb
        .from("deal_owner_outreach_queue")
        .update({
          status: "failed",
          last_error: String(e?.message ?? "send_failed"),
        })
        .eq("id", m.id);
      failed += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    processed: (queued ?? []).length,
    sent,
    failed,
  });
}
