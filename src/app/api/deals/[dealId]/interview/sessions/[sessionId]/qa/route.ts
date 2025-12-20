// src/app/api/deals/[dealId]/interview/sessions/[sessionId]/qa/route.ts
import { NextRequest } from "next/server";
import { getAuthedSupabase } from "@/lib/supabase/serverAuthed";
import { jsonBadRequest, jsonNotFound, jsonOk, jsonServerError, jsonUnauthorized } from "@/lib/interview/http";
import { answerBorrowerQuestion } from "@/lib/interview/qa";

export const runtime = "nodejs";

type Body = { question: string };

async function assertSessionAccessible(supabase: any, dealId: string, sessionId: string) {
  const { data, error } = await supabase
    .from("deal_interview_sessions")
    .select("id, deal_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw new Error(`db_select_session_failed:${error.message}`);
  if (!data) return { ok: false as const };
  if (String(data.deal_id) !== String(dealId)) return { ok: false as const };
  return { ok: true as const };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string; sessionId: string }> }) {
  try {
    const { dealId, sessionId } = await ctx.params;
    const { supabase, userId } = await getAuthedSupabase();
    if (!userId) return jsonUnauthorized("unauthorized");

    const check = await assertSessionAccessible(supabase, dealId, sessionId);
    if (!check.ok) return jsonNotFound("session_not_found");

    const body = (await req.json().catch(() => null)) as Body | null;
    const question = String(body?.question || "").trim();
    if (!question) return jsonBadRequest("question_required");

    const qa = await answerBorrowerQuestion(question);

    // Log as a buddy turn (Q&A mode) for audit trail
    const { data: insertedTurn, error: insErr } = await supabase
      .from("deal_interview_turns")
      .insert({
        session_id: sessionId,
        role: "buddy",
        text: qa.answer,
        payload: {
          channel: "voice",
          source: "qa_mode",
          qa_question: question,
          qa_citations: qa.citations,
          qa_disclaimer: true,
        },
      })
      .select("*")
      .maybeSingle();

    if (insErr) return jsonServerError("db_insert_qa_turn_failed", insErr);

    return jsonOk({ answer: qa.answer, citations: qa.citations, turn: insertedTurn });
  } catch (e: any) {
    return jsonServerError("unexpected_error", String(e?.message || e));
  }
}
