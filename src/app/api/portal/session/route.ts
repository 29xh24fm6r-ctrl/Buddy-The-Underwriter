// src/app/api/portal/session/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";
import { rateLimit } from "@/lib/portal/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getClientIp(req: Request) {
  // best-effort
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || null;
  return null;
}

export async function POST(req: Request) {
  const sb = supabaseAdmin();
  const { token } = await req.json().catch(() => ({}));

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const rl = rateLimit(`portal:${token.slice(0, 12)}:session`, 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  let invite;
  try {
    invite = await requireValidInvite(token);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid link" }, { status: 401 });
  }

  // Audit session (upsert-ish: keep one session per invite+ip+ua)
  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent");

  try {
    const { data: existing } = await sb
      .from("borrower_portal_sessions")
      .select("id")
      .eq("invite_id", invite.id)
      .eq("deal_id", invite.deal_id)
      .maybeSingle();

    if (existing?.id) {
      await sb
        .from("borrower_portal_sessions")
        .update({ last_seen_at: new Date().toISOString(), ip, user_agent: ua })
        .eq("id", existing.id);
    } else {
      await sb.from("borrower_portal_sessions").insert({
        invite_id: invite.id,
        deal_id: invite.deal_id,
        bank_id: invite.bank_id,
        ip,
        user_agent: ua,
        last_seen_at: new Date().toISOString(),
      });
    }
  } catch {
    // best-effort audit; never block portal usage
  }

  const { data: deal } = await sb
    .from("deals")
    .select("id, bank_id, name, loan_type, created_at")
    .eq("id", invite.deal_id)
    .single();

  const { data: requests } = await sb
    .from("borrower_document_requests")
    .select("id,title,description,category,status,due_at,created_at,updated_at")
    .eq("deal_id", invite.deal_id)
    .order("created_at", { ascending: true });

  const { data: messages } = await sb
    .from("borrower_messages")
    .select("id,direction,author_name,body,created_at")
    .eq("deal_id", invite.deal_id)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    invite: { id: invite.id, dealId: invite.deal_id, name: invite.name, email: invite.email, expiresAt: invite.expires_at },
    deal,
    requests: requests || [],
    messages: messages || [],
  });
}
