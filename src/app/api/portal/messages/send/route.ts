import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";
import { rateLimit } from "@/lib/portal/ratelimit";
import { parsePortalMessage, parsePortalToken, PORTAL_NO_STORE } from "@/lib/portal/requestBoundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: PORTAL_NO_STORE }); }

async function handle(req: Request) {
  const input = await req.json().catch(() => null);
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const token = parsePortalToken(record.token);
  const message = parsePortalMessage(record.body, record.authorName);
  if (!token || !message) return json({ ok: false, error: "invalid_request" }, 400);
  if (!rateLimit(`portal:${token.slice(0, 12)}:msg_send`, 30, 60_000).ok) return json({ ok: false, error: "rate_limited" }, 429);
  let invite;
  try { invite = await requireValidInvite(token); }
  catch { return json({ ok: false, error: "invalid_link" }, 401); }

  const { data, error } = await supabaseAdmin().from("borrower_messages").insert({
    deal_id: invite.deal_id, bank_id: invite.bank_id, invite_id: invite.id,
    direction: "borrower", author_name: message.authorName || invite.name || "Borrower", body: message.body,
  }).select("id, deal_id, bank_id, invite_id").single();
  if (error || !data || data.deal_id !== invite.deal_id || data.bank_id !== invite.bank_id || data.invite_id !== invite.id) {
    return json({ ok: false, error: "message_persistence_unavailable" }, 503);
  }
  return json({ ok: true });
}

export async function POST(req: Request) {
  try { return await handle(req); }
  catch { console.error("[portal/messages/send] unexpected_failure"); return json({ ok: false, error: "message_persistence_unavailable" }, 503); }
}
