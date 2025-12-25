// src/app/api/portal/messages/send/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";
import { rateLimit } from "@/lib/portal/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = supabaseAdmin();
  const { token, body, authorName } = await req.json().catch(() => ({}));

  if (!token || typeof token !== "string")
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  if (!body || typeof body !== "string" || !body.trim())
    return NextResponse.json({ error: "Missing message" }, { status: 400 });

  const rl = rateLimit(`portal:${token.slice(0, 12)}:msg_send`, 30, 60_000);
  if (!rl.ok)
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  let invite;
  try {
    invite = await requireValidInvite(token);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Invalid/expired link" },
      { status: 401 },
    );
  }

  const { error } = await sb.from("borrower_messages").insert({
    deal_id: invite.deal_id,
    bank_id: invite.bank_id,
    invite_id: invite.id,
    direction: "borrower",
    author_name:
      typeof authorName === "string" && authorName.trim()
        ? authorName.trim()
        : invite.name || "Borrower",
    body: body.trim(),
  });

  if (error)
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
