import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBorrowerToken } from "@/lib/borrower/token";
import { generateNarrative } from "@/lib/narrative/generateNarrative";

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

    const [
      { data: forms },
      { data: preflight },
      { data: reqs },
      { data: elig },
    ] = await Promise.all([
      (sb as any)
        .from("sba_form_payloads")
        .select("*")
        .eq("application_id", application.id)
        .limit(1)
        .single(),
      (sb as any)
        .from("sba_preflight_results")
        .select("*")
        .eq("application_id", application.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
      (sb as any)
        .from("borrower_requirements_snapshots")
        .select("*")
        .eq("application_id", application.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
      (sb as any)
        .from("sba_eligibility_snapshots")
        .select("*")
        .eq("application_id", application.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
    ]);

    const narrative = await generateNarrative({
      payload: forms?.payload,
      preflight,
      requirements: reqs,
      eligibility: elig,
    });

    await (sb as any).from("sba_narratives").insert({
      application_id: application.id,
      sections: narrative,
      generated_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, narrative });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "narrative_generation_failed" },
      { status: 400 },
    );
  }
}
