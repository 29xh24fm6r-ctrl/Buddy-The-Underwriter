import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBorrowerToken } from "@/lib/borrower/token";
import { validateEtran } from "@/lib/etran/validate";

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

    const result = validateEtran({ forms, preflight });

    await (sb as any).from("etran_readiness").insert({
      application_id: application.id,
      ready: result.ready,
      blockers: result.blockers
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "etran_validation_failed" },
      { status: 400 }
    );
  }
}
