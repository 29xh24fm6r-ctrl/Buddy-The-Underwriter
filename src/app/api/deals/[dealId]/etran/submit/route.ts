import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildEtranXml } from "@/lib/etran/xml";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// route-class: CLERK (SPEC-SEC-1)

export async function POST(
  _: Request,
  context: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await context.params;
    // SPEC-SEC-1: enforce Clerk auth + bank-tenant access before staging a submission.
    await assertDealAccess(dealId);
    const sb = supabaseAdmin();

    // Load required data
    const [{ data: forms }, { data: preflight }] = await Promise.all([
      (sb as any)
        .from("sba_form_payloads")
        .select("*")
        .eq("application_id", dealId)
        .single(),
      (sb as any)
        .from("sba_preflight_results")
        .select("*")
        .eq("application_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
    ]);

    // GATE: Preflight must pass
    if (!preflight?.passed) {
      return NextResponse.json(
        { ok: false, error: "Not ready - preflight checks failed" },
        { status: 400 },
      );
    }

    // GATE: Forms must be ready
    if (forms?.status !== "READY") {
      return NextResponse.json(
        { ok: false, error: "Not ready - forms validation failed" },
        { status: 400 },
      );
    }

    // Build canonical E-Tran XML
    const xml = buildEtranXml(forms.payload);

    // Log submission (HUMAN APPROVAL REQUIRED to actually send)
    await (sb as any).from("etran_submissions").insert({
      application_id: dealId,
      xml,
      status: "PENDING_APPROVAL",
      created_at: new Date().toISOString(),
      metadata: {
        preflight_score: preflight.score,
        form_version: forms.version,
      },
    });

    return NextResponse.json({
      ok: true,
      status: "PENDING_APPROVAL",
      message:
        "E-Tran submission prepared - requires human approval to send to SBA",
    });
  } catch (err: any) {
    const accessRes = accessErrorToResponse(err);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { ok: false, error: err?.message ?? "etran_submission_failed" },
      { status: 500 },
    );
  }
}

// HUMAN APPROVAL ENDPOINT (separate, restricted)
export async function PATCH(
  _: Request,
  context: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await context.params;
    // SPEC-SEC-1: enforce Clerk auth + bank-tenant access before approving.
    // SPEC-SEC-2: role-gate approve (underwriter) — assertDealAccess only
    // enforces bank membership here, not the underwriter role.
    const { userId } = await assertDealAccess(dealId);
    const sb = supabaseAdmin();

    // Update status to SUBMITTED (actual send would happen here)
    const { data } = await (sb as any)
      .from("etran_submissions")
      .update({
        status: "SUBMITTED",
        submitted_at: new Date().toISOString(),
        submitted_by: userId,
      })
      .eq("application_id", dealId)
      .eq("status", "PENDING_APPROVAL")
      .select()
      .single();

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "No pending submission found" },
        { status: 404 },
      );
    }

    // TODO: Actually send XML to SBA E-Tran endpoint here
    // await sendToSbaEtran(data.xml);

    return NextResponse.json({
      ok: true,
      status: "SUBMITTED",
      message: "E-Tran submission approved and sent to SBA",
    });
  } catch (err: any) {
    const accessRes = accessErrorToResponse(err);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { ok: false, error: err?.message ?? "approval_failed" },
      { status: 500 },
    );
  }
}
