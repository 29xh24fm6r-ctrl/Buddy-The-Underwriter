import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBorrowerToken } from "@/lib/borrower/token";
import { evaluateBorrowerRequirements } from "@/lib/borrowerRequirements/evaluateBorrowerRequirements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const params = await context.params;
    const { application } = await requireBorrowerToken(params.token);
    const sb = supabaseAdmin();

    // Decide track from application loan_type (set by eligibility recompute)
    const loanType = String((application as any).loan_type ?? "");
    const track = loanType === "SBA_7A" ? "SBA_7A" : "CONVENTIONAL";

    const { data: attachments, error: attErr } = await sb
      .from("borrower_attachments")
      .select("file_key,stored_name,mime_type,size,meta")
      .eq("application_id", (application as any).id)
      .order("created_at", { ascending: true });

    if (attErr) throw new Error(`attachments_load_failed: ${attErr.message}`);

    const result = evaluateBorrowerRequirements({
      track,
      attachments: (attachments ?? []) as any[],
      years_required: 2,
    });

    const { error: snapErr } = await (sb as any)
      .from("borrower_requirements_snapshots")
      .insert({
        application_id: (application as any).id,
        track: result.track,
        requirements: result.requirements,
        summary: result.summary,
      });

    if (snapErr) throw new Error(`snapshot_insert_failed: ${snapErr.message}`);

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "requirements_recompute_failed" },
      { status: 400 },
    );
  }
}
