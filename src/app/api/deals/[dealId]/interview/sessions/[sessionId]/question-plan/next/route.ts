// src/app/api/deals/[dealId]/interview/sessions/[sessionId]/question-plan/next/route.ts
import { NextRequest } from "next/server";
import { getAuthedSupabase } from "@/lib/supabase/serverAuthed";
import { jsonNotFound, jsonOk, jsonServerError, jsonUnauthorized } from "@/lib/interview/http";
import {
  buildQuestionPlan,
  computeRequiredKeysFromConfirmed,
  type ConfirmableCandidate,
  type ConfirmedFact,
} from "@/lib/interview/questionPlan";

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

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string; sessionId: string }> }) {
  try {
    const { dealId, sessionId } = await ctx.params;
    const { supabase } = await getAuthedSupabase();

    const check = await assertSessionAccessible(supabase, dealId, sessionId);
    if (!check.ok) return jsonNotFound("session_not_found");

    // Load facts (confirmed + suggested)
    const { data: facts, error: factsErr } = await supabase
      .from("deal_interview_facts")
      .select("id, field_key, field_value, value_text, confirmed, confirmed_at, created_at, metadata")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });

    if (factsErr) return jsonServerError("db_select_facts_failed", factsErr);

    const confirmedByKey = new Map<string, ConfirmedFact>();
    const candidates: ConfirmableCandidate[] = [];

    for (const f of facts || []) {
      if (f.confirmed) {
        const existing = confirmedByKey.get(f.field_key);
        if (!existing) {
          confirmedByKey.set(f.field_key, {
            field_key: f.field_key,
            field_value: f.field_value,
            value_text: f.value_text,
          });
        }
      } else if (f.metadata?.suggested) {
        candidates.push({
          id: f.id,
          field_key: f.field_key,
          field_value: f.field_value,
          value_text: f.value_text,
          metadata: f.metadata,
        });
      }
    }

    // Load recent buddy turns to avoid immediate repeats
    const { data: turns, error: turnsErr } = await supabase
      .from("deal_interview_turns")
      .select("id, role, created_at, payload")
      .eq("session_id", sessionId)
      .eq("role", "buddy")
      .order("created_at", { ascending: false })
      .limit(12);

    if (turnsErr) return jsonServerError("db_select_turns_failed", turnsErr);

    const recentlyAskedKeys = new Set<string>();
    for (const t of turns || []) {
      const k = t.payload?.question_key;
      if (k) recentlyAskedKeys.add(String(k));
    }

    const requiredKeys = computeRequiredKeysFromConfirmed(confirmedByKey);

    const plan = buildQuestionPlan({
      confirmedByKey,
      requiredKeys,
      candidateFacts: candidates,
      recentlyAskedKeys,
    });

    return jsonOk({ plan });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.startsWith("unauthorized")) return jsonUnauthorized(msg);
    return jsonServerError("unexpected_error", msg);
  }
}
