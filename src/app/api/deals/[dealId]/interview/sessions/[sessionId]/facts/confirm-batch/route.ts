// src/app/api/deals/[dealId]/interview/sessions/[sessionId]/facts/confirm-batch/route.ts
import { NextRequest } from "next/server";
import { getAuthedSupabase } from "@/lib/supabase/serverAuthed";
import {
  jsonBadRequest,
  jsonNotFound,
  jsonOk,
  jsonServerError,
  jsonUnauthorized,
} from "@/lib/interview/http";

export const runtime = "nodejs";

type Body = {
  factIds: string[];
  confirmed: boolean; // true/false
  // Optional: link confirmations to a specific borrower turn ID (explicit voice confirmation)
  confirmationTurnId?: string | null;
  confirmationText?: string | null;
};

async function assertSessionAccessible(
  supabase: any,
  dealId: string,
  sessionId: string,
) {
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

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; sessionId: string }> },
) {
  try {
    const { dealId, sessionId } = await ctx.params;
    const { supabase, userId } = await getAuthedSupabase();
    if (!userId) return jsonUnauthorized("unauthorized");

    const check = await assertSessionAccessible(supabase, dealId, sessionId);
    if (!check.ok) return jsonNotFound("session_not_found");

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body || !Array.isArray(body.factIds) || body.factIds.length === 0)
      return jsonBadRequest("factIds_required");
    if (typeof body.confirmed !== "boolean")
      return jsonBadRequest("confirmed_required");

    // Load facts to validate they belong to this session
    const { data: facts, error: factsErr } = await supabase
      .from("deal_interview_facts")
      .select("id, session_id, confirmed, metadata")
      .in("id", body.factIds);

    if (factsErr) return jsonServerError("db_select_facts_failed", factsErr);

    const validIds = (facts || [])
      .filter((f: any) => String(f.session_id) === String(sessionId))
      .map((f: any) => f.id);

    if (validIds.length === 0)
      return jsonBadRequest("no_valid_factIds_for_session");

    // Update one-by-one so we can preserve metadata safely
    let updatedCount = 0;

    for (const id of validIds) {
      const row = (facts || []).find((f: any) => f.id === id);
      const prevMeta = row?.metadata ?? {};

      const nextMeta = {
        ...prevMeta,
        confirmed_via: body.confirmed ? "batch_confirm" : "batch_unconfirm",
        confirmed_via_turn_id: body.confirmationTurnId ?? null,
        confirmed_via_text: body.confirmationText ?? null,
        confirmed_by_user_id: userId,
        confirmed_at_iso: new Date().toISOString(),
      };

      const patch: any = {
        confirmed: body.confirmed,
        metadata: nextMeta,
      };

      if (body.confirmed) {
        patch.confirmed_at = new Date().toISOString();
        patch.confirmed_by = userId;
      } else {
        patch.confirmed_at = null;
        patch.confirmed_by = null;
      }

      const { error: updErr } = await supabase
        .from("deal_interview_facts")
        .update(patch)
        .eq("id", id)
        .eq("session_id", sessionId);

      if (updErr) return jsonServerError("db_update_fact_failed", updErr);
      updatedCount++;
    }

    return jsonOk({ updatedCount, factIds: validIds });
  } catch (e: any) {
    return jsonServerError("unexpected_error", String(e?.message || e));
  }
}
