// src/app/api/deals/[dealId]/interview/sessions/route.ts
import { NextRequest } from "next/server";
import { getAuthedSupabase } from "@/lib/supabase/serverAuthed";
import { InterviewSessionCreateSchema } from "@/lib/interview/validators";
import { jsonBadRequest, jsonCreated, jsonOk, jsonServerError, jsonUnauthorized } from "@/lib/interview/http";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    const { supabase } = await getAuthedSupabase();

    const { data, error } = await supabase
      .from("deal_interview_sessions")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });

    if (error) return jsonServerError("db_select_failed", error);

    return jsonOk({ sessions: data ?? [] });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.startsWith("unauthorized")) return jsonUnauthorized(msg);
    return jsonServerError("unexpected_error", msg);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    const { supabase, userId } = await getAuthedSupabase();

    const body = await req.json().catch(() => ({}));
    const parsed = InterviewSessionCreateSchema.safeParse(body);
    if (!parsed.success) return jsonBadRequest("invalid_body", parsed.error.flatten());

    const { title, mode, metadata } = parsed.data;

    const { data, error } = await supabase
      .from("deal_interview_sessions")
      .insert({
        deal_id: dealId,
        created_by: userId, // RLS owner
        title: title ?? null,
        mode: mode ?? "mixed",
        metadata: metadata ?? {},
      })
      .select("*")
      .single();

    if (error) return jsonServerError("db_insert_failed", error);

    return jsonCreated({ session: data });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.startsWith("unauthorized")) return jsonUnauthorized(msg);
    return jsonServerError("unexpected_error", msg);
  }
}
