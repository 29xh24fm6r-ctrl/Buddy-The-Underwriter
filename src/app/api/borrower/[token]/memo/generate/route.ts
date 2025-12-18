import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBorrowerToken } from "@/lib/borrower/token";
import { generateCreditMemo } from "@/lib/narrative/generateNarrative";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const { application } = await requireBorrowerToken(token);
    const sb = supabaseAdmin();

    const [{ data: forms }, { data: preflight }] = await Promise.all([
      (sb as any).from("sba_form_payloads").select("*").eq("application_id", application.id).single(),
      (sb as any).from("sba_preflight_results").select("*").eq("application_id", application.id).order("created_at", { ascending: false }).limit(1).single()
    ]);

    const memo = generateCreditMemo({ forms, preflight });

    const path = `applications/${application.id}/credit_memo.txt`;
    await sb.storage.from("generated").upload(path, memo, { upsert: true });

    await (sb as any).from("generated_documents").insert({
      application_id: application.id,
      artifact_type: "CREDIT_MEMO",
      name: "Credit Memo",
      storage_path: path,
      version: "v1"
    });

    return NextResponse.json({ ok: true, memo });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "memo_generation_failed" },
      { status: 400 }
    );
  }
}
