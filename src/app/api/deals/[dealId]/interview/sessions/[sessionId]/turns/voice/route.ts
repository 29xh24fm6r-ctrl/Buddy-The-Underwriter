// src/app/api/deals/[dealId]/interview/sessions/[sessionId]/turns/voice/route.ts
import { NextRequest } from "next/server";
import { getAuthedSupabase } from "@/lib/supabase/serverAuthed";
import { jsonBadRequest, jsonNotFound, jsonOk, jsonServerError, jsonUnauthorized } from "@/lib/interview/http";
import { suggestFactsFromBorrowerText } from "@/lib/interview/suggestFacts";
import { buildNextPlanFromDbRows } from "@/lib/interview/serverPlan";

export const runtime = "nodejs";

type Body = {
  role: "borrower" | "buddy";
  text: string;
  payload?: any;
};

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

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string; sessionId: string }> }) {
  try {
    const { dealId, sessionId } = await ctx.params;
    const { supabase, userId } = await getAuthedSupabase();
    if (!userId) return jsonUnauthorized("unauthorized");

    const check = await assertSessionAccessible(supabase, dealId, sessionId);
    if (!check.ok) return jsonNotFound("session_not_found");

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.role || !body?.text) return jsonBadRequest("role_and_text_required");

    const role = body.role;
    const text = String(body.text || "").trim();
    if (!text) return jsonBadRequest("text_empty");

    // 1) Save turn
    const { data: insertedTurn, error: insTurnErr } = await supabase
      .from("deal_interview_turns")
      .insert({
        session_id: sessionId,
        role,
        text,
        payload: body.payload ?? null,
      })
      .select("*")
      .maybeSingle();

    if (insTurnErr) return jsonServerError("db_insert_turn_failed", insTurnErr);
    if (!insertedTurn) return jsonServerError("db_insert_turn_failed", "no_row_returned");

    let insertedFactsCount = 0;

    // 2) If borrower: server-side suggestions
    if (role === "borrower") {
      const suggestions = await suggestFactsFromBorrowerText(text);

      if (suggestions.length > 0) {
        // Avoid dupes: same session + source_turn_id + field_key + confirmed=false
        const { data: existing, error: existErr } = await supabase
          .from("deal_interview_facts")
          .select("id, field_key")
          .eq("session_id", sessionId)
          .eq("source_turn_id", insertedTurn.id)
          .eq("confirmed", false);

        if (existErr) return jsonServerError("db_select_existing_facts_failed", existErr);

        const existingKeys = new Set((existing || []).map((x: any) => String(x.field_key)));

        const toInsert = suggestions
          .filter((s) => !existingKeys.has(String(s.field_key)))
          .slice(0, 8)
          .map((s) => ({
            session_id: sessionId,
            field_key: String(s.field_key),
            field_value: s.field_value,
            value_text: s.value_text ?? null,
            source_type: "turn" as const,
            source_turn_id: insertedTurn.id,
            confirmed: false,
            confidence: typeof s.confidence === "number" ? s.confidence : null,
            metadata: {
              suggested: true,
              suggested_from_turn_id: insertedTurn.id,
              rationale: s.rationale,
              suggested_by: "server",
            },
          }));

        if (toInsert.length > 0) {
          const { error: insFactsErr } = await supabase.from("deal_interview_facts").insert(toInsert);
          if (insFactsErr) return jsonServerError("db_insert_suggested_facts_failed", insFactsErr);
          insertedFactsCount = toInsert.length;
        }
      }
    }

    // 3) Reload facts + recent buddy turns (for repeat avoidance)
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

    // 4) Plan next question (deterministic)
    const plan = buildNextPlanFromDbRows({
      factsRows: factsRows || [],
      buddyTurnsRows: buddyTurns || [],
    });

    return jsonOk({
      turn: insertedTurn,
      insertedFactsCount,
      plan,
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    return jsonServerError("unexpected_error", msg);
  }
}
