// src/app/api/deals/[dealId]/interview/sessions/[sessionId]/question-plan/ask-next/route.ts
import { NextRequest } from "next/server";
import { getAuthedSupabase } from "@/lib/supabase/serverAuthed";
import { jsonNotFound, jsonOk, jsonServerError, jsonUnauthorized } from "@/lib/interview/http";
import { buildNextPlanFromDbRows } from "@/lib/interview/serverPlan";

export const runtime = "nodejs";

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

export async function POST(_req: NextRequest, ctx: { params: Promise<{ dealId: string; sessionId: string }> }) {
  try {
    const { dealId, sessionId } = await ctx.params;
    const { supabase, userId } = await getAuthedSupabase();
    if (!userId) return jsonUnauthorized("unauthorized");

    const check = await assertSessionAccessible(supabase, dealId, sessionId);
    if (!check.ok) return jsonNotFound("session_not_found");

    // Load facts + recent buddy turns
    const { data: factsRows, error: factsErr } = await supabase
      .from("deal_interview_facts")
      .select("id, field_key, field_value, value_text, confirmed, created_at, confirmed_at, metadata")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });

    if (factsErr) return jsonServerError("db_select_facts_failed", factsErr);

    const { data: buddyTurns, error: buddyTurnsErr } = await supabase
      .from("deal_interview_turns")
      .select("id, role, created_at, payload")
      .eq("session_id", sessionId)
      .eq("role", "buddy")
      .order("created_at", { ascending: false })
      .limit(12);

    if (buddyTurnsErr) return jsonServerError("db_select_buddy_turns_failed", buddyTurnsErr);

    const plan = buildNextPlanFromDbRows({
      factsRows: factsRows || [],
      buddyTurnsRows: buddyTurns || [],
    });

    // If complete, do not insert a Buddy turn
    if (plan.kind === "complete") {
      return jsonOk({ plan, buddyTurn: null });
    }

    // Insert the Buddy question as a deterministic logged turn
    const questionText = String(plan.question || "").trim();
    const questionKey = String(plan.question_key || "").trim();

    if (!questionText || !questionKey) {
      return jsonServerError("plan_missing_question", { plan });
    }

    const { data: insertedTurn, error: insTurnErr } = await supabase
      .from("deal_interview_turns")
      .insert({
        session_id: sessionId,
        role: "buddy",
        text: questionText,
        payload: {
          channel: "voice",
          source: "server_plan",
          question_key: questionKey,
          plan_version: "v1",
          plan_kind: plan.kind,
          candidate_fact_id: plan.candidate_fact_id ?? null,
        },
      })
      .select("*")
      .maybeSingle();

    if (insTurnErr) return jsonServerError("db_insert_buddy_turn_failed", insTurnErr);

    return jsonOk({ plan, buddyTurn: insertedTurn });
  } catch (e: any) {
    return jsonServerError("unexpected_error", String(e?.message || e));
  }
}
