// src/app/api/deals/[dealId]/interview/sessions/[sessionId]/turns/route.ts
import { NextRequest } from "next/server";
import { getAuthedSupabase } from "@/lib/supabase/serverAuthed";
import { InterviewTurnCreateSchema } from "@/lib/interview/validators";
import {
  jsonBadRequest,
  jsonCreated,
  jsonNotFound,
  jsonOk,
  jsonServerError,
  jsonUnauthorized,
} from "@/lib/interview/http";

async function assertSessionAccessible(
  supabase: any,
  dealId: string,
  sessionId: string,
) {
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

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; sessionId: string }> },
) {
  try {
    const { dealId, sessionId } = await ctx.params;
    const { supabase } = await getAuthedSupabase();

    const check = await assertSessionAccessible(supabase, dealId, sessionId);
    if (!check.ok) return jsonNotFound("session_not_found");

    const { data, error } = await supabase
      .from("deal_interview_turns")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) return jsonServerError("db_select_failed", error);

    return jsonOk({ turns: data ?? [] });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.startsWith("unauthorized")) return jsonUnauthorized(msg);
    return jsonServerError("unexpected_error", msg);
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; sessionId: string }> },
) {
  try {
    const { dealId, sessionId } = await ctx.params;
    const { supabase } = await getAuthedSupabase();

    const check = await assertSessionAccessible(supabase, dealId, sessionId);
    if (!check.ok) return jsonNotFound("session_not_found");

    const body = await req.json().catch(() => ({}));
    const parsed = InterviewTurnCreateSchema.safeParse(body);
    if (!parsed.success)
      return jsonBadRequest("invalid_body", parsed.error.flatten());

    const { role, text, audio_file_id, transcript_confidence, payload } =
      parsed.data;

    const { data, error } = await supabase
      .from("deal_interview_turns")
      .insert({
        session_id: sessionId,
        role,
        text: text ?? "",
        audio_file_id: audio_file_id ?? null,
        transcript_confidence: transcript_confidence ?? null,
        payload: payload ?? {},
      })
      .select("*")
      .single();

    if (error) return jsonServerError("db_insert_failed", error);

    return jsonCreated({ turn: data });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.startsWith("unauthorized")) return jsonUnauthorized(msg);
    return jsonServerError("unexpected_error", msg);
  }
}
