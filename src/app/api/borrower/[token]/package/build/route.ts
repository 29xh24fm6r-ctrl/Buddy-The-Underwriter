import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBorrowerToken } from "@/lib/borrower/token";
import { buildSubmissionPackage } from "@/lib/submission/buildPackage";
import { computeSubmissionReadiness } from "@/lib/submission/readiness";
import { FORM_REGISTRY } from "@/lib/forms/registry";
import { fillPdfFields } from "@/lib/forms/fillPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const { application } = await requireBorrowerToken(token);
    const sb = supabaseAdmin();

    const [{ data: forms }, { data: preflight }, { data: reqs }, { data: narrative }, { data: atts }] =
      await Promise.all([
        (sb as any).from("sba_form_payloads").select("*").eq("application_id", application.id).limit(1).single(),
        (sb as any).from("sba_preflight_results").select("*").eq("application_id", application.id).order("created_at", { ascending: false }).limit(1).single(),
        (sb as any).from("borrower_requirements_snapshots").select("*").eq("application_id", application.id).order("created_at", { ascending: false }).limit(1).single(),
        (sb as any).from("sba_narratives").select("*").eq("application_id", application.id).order("generated_at", { ascending: false }).limit(1).single(),
        sb.from("borrower_attachments").select("*").eq("application_id", application.id),
      ]);

    const readiness = computeSubmissionReadiness({
      preflight,
      forms,
      narrative: narrative?.sections,
      requirements: reqs,
    });

    if (!readiness.ready) {
      return NextResponse.json({
        ok: false,
        error: "Not ready for submission",
        blockers: readiness.blockers,
      }, { status: 400 });
    }

    const formDef = FORM_REGISTRY.find(f => f.form_name === "OGB_SBA_INTAKE_V1");
    const filledForms = formDef ? fillPdfFields(forms?.payload, formDef) : {};

    const pkg = buildSubmissionPackage({
      filledForms,
      narrative: narrative?.sections,
      attachments: atts ?? [],
      metadata: {
        application_id: application.id,
        business_name: forms?.payload?.business?.legal_name ?? "Unknown",
        loan_amount: forms?.payload?.loan?.amount ?? 0,
      },
    });

    await (sb as any).from("sba_submission_packages").insert({
      application_id: application.id,
      package_data: pkg,
      readiness_score: readiness.score,
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, package: pkg, readiness });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "package_build_failed" },
      { status: 400 }
    );
  }
}
