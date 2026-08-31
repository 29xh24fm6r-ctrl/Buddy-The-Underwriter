import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";
import { rateLimit } from "@/lib/portal/ratelimit";
import { buildBorrowerTasksFromChecklist } from "@/lib/portal/tasks";
import { buildBorrowerSpreadRequestTiles } from "@/lib/classicSpread/review/borrowerPortalSpreadRequestTiles";
import { parsePortalToken, PORTAL_NO_STORE } from "@/lib/portal/requestBoundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: PORTAL_NO_STORE }); }
function clientIp(req: Request) { return (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "").slice(0, 64) || null; }

async function handle(req: Request) {
  const body = await req.json().catch(() => null);
  const token = parsePortalToken(body && typeof body === "object" ? (body as Record<string, unknown>).token : null);
  if (!token) return json({ ok: false, error: "invalid_request" }, 400);
  if (!rateLimit(`portal:${token.slice(0, 12)}:session`, 60, 60_000).ok) return json({ ok: false, error: "rate_limited" }, 429);

  let invite;
  try { invite = await requireValidInvite(token); }
  catch { return json({ ok: false, error: "invalid_link" }, 401); }

  const sb = supabaseAdmin();
  const { data: existing, error: sessionReadError } = await sb.from("borrower_portal_sessions")
    .select("id").eq("invite_id", invite.id).eq("deal_id", invite.deal_id).maybeSingle();
  if (sessionReadError) return json({ ok: false, error: "session_audit_unavailable" }, 503);
  const auditPayload = { last_seen_at: new Date().toISOString(), ip: clientIp(req), user_agent: (req.headers.get("user-agent") || "").slice(0, 512) || null };
  const audit = existing?.id
    ? await sb.from("borrower_portal_sessions").update(auditPayload).eq("id", existing.id).select("id").single()
    : await sb.from("borrower_portal_sessions").insert({ invite_id: invite.id, deal_id: invite.deal_id, bank_id: invite.bank_id, ...auditPayload }).select("id").single();
  if (audit.error || !audit.data?.id) return json({ ok: false, error: "session_audit_unavailable" }, 503);

  const [dealResult, checklistResult, requestsResult, messagesResult, draftsResult, actionsResult] = await Promise.all([
    sb.from("deals").select("id, bank_id, name, loan_type, created_at").eq("id", invite.deal_id).single(),
    sb.from("deal_checklist_items").select("id, checklist_key, title, description, required, status, required_years, satisfied_years").eq("deal_id", invite.deal_id),
    sb.from("borrower_document_requests").select("id,title,description,category,status,due_at,created_at,updated_at").eq("deal_id", invite.deal_id).order("created_at", { ascending: true }),
    sb.from("borrower_messages").select("id,direction,author_name,body,created_at").eq("deal_id", invite.deal_id).order("created_at", { ascending: true }),
    sb.from("draft_borrower_requests").select("id, status, missing_document_type, draft_subject, draft_message, evidence").eq("deal_id", invite.deal_id),
    sb.from("classic_spread_review_actions").select("id, finding_key, status").eq("deal_id", invite.deal_id).eq("bank_id", invite.bank_id),
  ]);
  if (dealResult.error || checklistResult.error || requestsResult.error || messagesResult.error || draftsResult.error || actionsResult.error ||
      !dealResult.data || dealResult.data.id !== invite.deal_id || dealResult.data.bank_id !== invite.bank_id ||
      !Array.isArray(checklistResult.data) || !Array.isArray(requestsResult.data) || !Array.isArray(messagesResult.data) || !Array.isArray(draftsResult.data) || !Array.isArray(actionsResult.data)) {
    console.error("[portal/session] authoritative_read_unavailable");
    return json({ ok: false, error: "portal_state_unavailable" }, 503);
  }

  return json({
    ok: true,
    invite: { id: invite.id, dealId: invite.deal_id, name: invite.name, email: invite.email, expiresAt: invite.expires_at },
    deal: dealResult.data,
    tasks: buildBorrowerTasksFromChecklist(checklistResult.data),
    requests: requestsResult.data,
    spreadRequests: buildBorrowerSpreadRequestTiles({ drafts: draftsResult.data as any[], actions: actionsResult.data as any[] }),
    messages: messagesResult.data,
  });
}

export async function POST(req: Request) {
  try { return await handle(req); }
  catch { console.error("[portal/session] unexpected_failure"); return json({ ok: false, error: "portal_state_unavailable" }, 503); }
}
