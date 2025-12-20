// src/app/api/deals/[dealId]/interview/sessions/[sessionId]/summary/route.ts
import { NextRequest } from "next/server";
import { getAuthedSupabase } from "@/lib/supabase/serverAuthed";
import { jsonNotFound, jsonOk, jsonServerError, jsonUnauthorized } from "@/lib/interview/http";

export const runtime = "nodejs";

async function assertSessionAccessible(supabase: any, dealId: string, sessionId: string) {
  const { data, error } = await supabase
    .from("deal_interview_sessions")
    .select("id, deal_id, title, status, mode, created_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw new Error(`db_select_session_failed:${error.message}`);
  if (!data) return { ok: false as const };
  if (String(data.deal_id) !== String(dealId)) return { ok: false as const };
  return { ok: true as const, session: data };
}

function mdEscape(s: any) {
  return String(s ?? "").replace(/\|/g, "\\|");
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string; sessionId: string }> }) {
  try {
    const { dealId, sessionId } = await ctx.params;
    const { supabase, userId } = await getAuthedSupabase();
    if (!userId) return jsonUnauthorized("unauthorized");

    const check = await assertSessionAccessible(supabase, dealId, sessionId);
    if (!check.ok) return jsonNotFound("session_not_found");

    const { data: facts, error: factsErr } = await supabase
      .from("deal_interview_facts")
      .select("id, field_key, field_value, value_text, confirmed, confirmed_at, confirmed_by, metadata, created_at, source_type, source_turn_id")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (factsErr) return jsonServerError("db_select_facts_failed", factsErr);

    const { data: turns, error: turnsErr } = await supabase
      .from("deal_interview_turns")
      .select("id, role, text, payload, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (turnsErr) return jsonServerError("db_select_turns_failed", turnsErr);

    const confirmedFacts = (facts || []).filter((f: any) => !!f.confirmed);
    const suggestedFacts = (facts || []).filter((f: any) => !f.confirmed && !!f?.metadata?.suggested);

    const qaTurns = (turns || []).filter((t: any) => t?.payload?.source === "qa_mode");

    const markdown = [
      `# Buddy Intake Summary`,
      ``,
      `**Deal ID:** ${mdEscape(dealId)}`,
      `**Session ID:** ${mdEscape(sessionId)}`,
      `**Title:** ${mdEscape(check.session.title || "Untitled")}`,
      `**Mode:** ${mdEscape(check.session.mode)}`,
      `**Status:** ${mdEscape(check.session.status)}`,
      `**Created:** ${mdEscape(check.session.created_at)}`,
      ``,
      `## Confirmed Facts`,
      ``,
      `| Field Key | Value | Confirmed At | Evidence |`,
      `|---|---|---|---|`,
      ...confirmedFacts.map((f: any) => {
        const val = f.value_text || JSON.stringify(f.field_value);
        const ev = f.source_turn_id ? `turn:${f.source_turn_id}` : f.source_type;
        return `| \`${mdEscape(f.field_key)}\` | ${mdEscape(val)} | ${mdEscape(f.confirmed_at || "")} | ${mdEscape(ev || "")} |`;
      }),
      ``,
      `## Suggested (Unconfirmed) Facts`,
      ``,
      `| Field Key | Value | Confidence | Evidence |`,
      `|---|---|---|---|`,
      ...suggestedFacts.map((f: any) => {
        const val = f.value_text || JSON.stringify(f.field_value);
        const conf = typeof f.confidence === "number" ? f.confidence.toFixed(2) : "";
        const ev = f.source_turn_id ? `turn:${f.source_turn_id}` : f.source_type;
        return `| \`${mdEscape(f.field_key)}\` | ${mdEscape(val)} | ${mdEscape(conf)} | ${mdEscape(ev || "")} |`;
      }),
      ``,
      `## Q&A (Educational)`,
      ``,
      qaTurns.length === 0
        ? `_No Q&A turns logged._`
        : qaTurns
            .map((t: any) => {
              const q = t?.payload?.qa_question || "";
              const c = Array.isArray(t?.payload?.qa_citations) ? t.payload.qa_citations : [];
              return [
                `### Q: ${mdEscape(q)}`,
                ``,
                `${mdEscape(t.text)}`,
                ``,
                c.length ? `**Citations:** ${c.map((x: any) => x.title || x.id).join(", ")}` : `**Citations:** none`,
                ``,
              ].join("\n");
            })
            .join("\n"),
      ``,
      `---`,
      `This summary is for intake/audit trail. Underwriting decisions require verified documentation and policy compliance.`,
    ].join("\n");

    return jsonOk({
      session: check.session,
      facts: facts || [],
      turns: turns || [],
      summary: {
        confirmedFactsCount: confirmedFacts.length,
        suggestedFactsCount: suggestedFacts.length,
        qaTurnsCount: qaTurns.length,
      },
      markdown,
    });
  } catch (e: any) {
    return jsonServerError("unexpected_error", String(e?.message || e));
  }
}
