import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBorrowerToken } from "@/lib/borrower/token";
import { runSbaPreflight } from "@/lib/sbaPreflight/runPreflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const { application } = await requireBorrowerToken(token);
    const sb = supabaseAdmin();

    const [{ data: answers }, { data: forms }, { data: reqs }, { data: atts }] =
      await Promise.all([
        sb.from("borrower_answers").select("question_key,value").eq("application_id", application.id),
        (sb as any).from("sba_form_payloads").select("*").eq("application_id", application.id).limit(1).single(),
        (sb as any).from("borrower_requirements_snapshots").select("*").eq("application_id", application.id).order("created_at", { ascending: false }).limit(1).single(),
        sb.from("borrower_attachments").select("*").eq("application_id", application.id),
      ]);

    const answersObj: Record<string, any> = {};
    for (const a of answers ?? []) answersObj[a.question_key] = a.value;

    const result = runSbaPreflight({
      answers: answersObj,
      formPayload: forms?.payload,
      requirements: reqs,
      attachments: atts ?? [],
    });

    await (sb as any).from("sba_preflight_results").insert({
      application_id: application.id,
      score: result.score,
      blocking_issues: result.blocking_issues,
      warnings: result.warnings,
      passed: result.passed,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "preflight_failed" },
      { status: 400 }
    );
  }
}
