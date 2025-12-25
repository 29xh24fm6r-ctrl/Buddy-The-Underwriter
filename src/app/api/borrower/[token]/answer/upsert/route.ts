import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBorrowerToken } from "@/lib/borrower/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const params = await context.params;
    const { application } = await requireBorrowerToken(params.token);
    const sb = supabaseAdmin();

    const body = await req.json();
    const { section, question_key, value } = body;

    if (!question_key) {
      return NextResponse.json(
        { ok: false, error: "Missing question_key" },
        { status: 400 },
      );
    }

    // Upsert answer
    const { error } = await sb.from("borrower_answers").upsert(
      {
        application_id: application.id,
        section: section || "general",
        question_key,
        value,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "application_id,question_key",
      },
    );

    if (error) throw new Error(`upsert_failed: ${error.message}`);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "answer_upsert_failed" },
      { status: 400 },
    );
  }
}
