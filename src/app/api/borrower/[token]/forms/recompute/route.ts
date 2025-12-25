import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBorrowerToken } from "@/lib/borrower/token";
import { buildSbaFormPayloadFromAnswers } from "@/lib/sbaForms/buildPayload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    const { application } = await requireBorrowerToken(token);
    const sb = supabaseAdmin();

    const { data: answersRows, error: ansErr } = await sb
      .from("borrower_answers")
      .select("question_key,value")
      .eq("application_id", application.id);

    if (ansErr) throw new Error(`answers_load_failed: ${ansErr.message}`);

    const answers: Record<string, any> = {};
    for (const r of answersRows ?? []) answers[r.question_key] = r.value;

    const formName = "OGB_SBA_INTAKE_V1";
    const built = buildSbaFormPayloadFromAnswers({ answers });

    const { error: upErr } = await (sb as any).from("sba_form_payloads").upsert(
      {
        application_id: application.id,
        form_name: formName,
        payload: built.payload,
        validation_errors: built.validation_errors,
        status: built.status,
      },
      { onConflict: "application_id,form_name" },
    );

    if (upErr) throw new Error(`form_payload_upsert_failed: ${upErr.message}`);

    return NextResponse.json({ ok: true, form_name: formName, ...built });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "forms_recompute_failed" },
      { status: 400 },
    );
  }
}
