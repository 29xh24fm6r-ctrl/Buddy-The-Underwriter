import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(_req: NextRequest, props: { params: Promise<{ dealId: string }> }) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const sb = supabaseAdmin();

    const { data: missionRow } = await sb
      .from("buddy_research_missions")
      .select("id")
      .eq("deal_id", dealId)
      .eq("bank_id", bankPick.bankId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let bieQuestions: string[] = [];

    if (missionRow?.id) {
      const { data: narrative } = await sb
        .from("buddy_research_narratives")
        .select("sections")
        .eq("mission_id", missionRow.id)
        .eq("version", 3)
        .maybeSingle();

      if (narrative?.sections && Array.isArray(narrative.sections)) {
        const uqSection = (narrative.sections as Array<{ title?: string; sentences?: Array<{ text?: string }> }>).find((s) => s.title === "Underwriting Questions");
        if (uqSection?.sentences) {
          for (const sentence of uqSection.sentences) {
            const raw = String(sentence.text ?? "").trim();
            if (!raw) continue;
            const lines = raw.split(/\n+/).map((l: string) => l.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
            bieQuestions.push(...lines);
          }
        }
      }
    }

    const { data: gaps } = await sb
      .from("deal_gap_queue")
      .select("id, fact_key, description, resolution_prompt")
      .eq("deal_id", dealId)
      .eq("bank_id", bankPick.bankId)
      .eq("status", "open")
      .eq("gap_type", "missing_fact")
      .order("priority", { ascending: false });

    const missingFacts = (gaps ?? []).map((g) => ({
      id: g.id,
      fact_key: g.fact_key,
      question: g.resolution_prompt ?? g.description,
      source: "missing_fact" as const,
    }));

    const questions = [
      ...missingFacts,
      ...bieQuestions.map((q, i) => ({ id: `bie_${i}`, fact_key: null, question: q, source: "bie" as const })),
    ];

    return NextResponse.json({ ok: true, questions, hasResearch: bieQuestions.length > 0 });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
