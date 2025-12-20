// src/app/api/deals/[dealId]/interview/sessions/[sessionId]/facts/[factId]/confirm/route.ts
import { NextRequest } from "next/server";
import { getAuthedSupabase } from "@/lib/supabase/serverAuthed";
import { InterviewFactConfirmSchema } from "@/lib/interview/validators";
import { jsonBadRequest, jsonNotFound, jsonOk, jsonServerError, jsonUnauthorized } from "@/lib/interview/http";

async function assertSessionAccessible(supabase: any, dealId: string, sessionId: string) {
  const { data, error } = await supabase
    .from("deal_interview_sessions")
    .select("id, deal_id, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw new Error(`db_select_session_failed:${error.message}`);
  if (!data) return { ok: false as const };
  if (String(data.deal_id) !== String(dealId)) return { ok: false as const };
  return { ok: true as const, session: data };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string; sessionId: string; factId: string }> }) {
  try {
    const { dealId, sessionId, factId } = await ctx.params;
    const { supabase } = await getAuthedSupabase();

    const check = await assertSessionAccessible(supabase, dealId, sessionId);
    if (!check.ok) return jsonNotFound("session_not_found");

    const body = await req.json().catch(() => ({}));
    const parsed = InterviewFactConfirmSchema.safeParse(body);
    if (!parsed.success) return jsonBadRequest("invalid_body", parsed.error.flatten());

    // Ensure fact belongs to the session (RLS will also protect, but we want clean errors)
    const { data: fact, error: factErr } = await supabase
      .from("deal_interview_facts")
      .select("id, session_id, confirmed")
      .eq("id", factId)
      .maybeSingle();

    if (factErr) return jsonServerError("db_select_fact_failed", factErr);
    if (!fact || String(fact.session_id) !== String(sessionId)) return jsonNotFound("fact_not_found");

    const { confirmed } = parsed.data;

    const { data: updated, error } = await supabase
      .from("deal_interview_facts")
      .update({ confirmed })
      .eq("id", factId)
      .select("*")
      .single();

    if (error) return jsonServerError("db_update_failed", error);

    return jsonOk({ fact: updated });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.startsWith("unauthorized")) return jsonUnauthorized(msg);
    return jsonServerError("unexpected_error", msg);
  }
}
