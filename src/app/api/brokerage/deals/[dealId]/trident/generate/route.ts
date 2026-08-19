import "server-only";

/**
 * POST /api/brokerage/deals/[dealId]/trident/generate
 *
 * Manual trigger for bundle generation. Admin-only for v1 (brokerage tenant
 * member). Not exposed to borrowers directly — borrowers download via the
 * separate `/trident/download/[kind]` route which is gated by the
 * session-cookie-owns-this-deal check.
 */

import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createTridentBundleRun } from "@/lib/brokerage/trident/generateTridentBundle";
import { goldenTridentWorkflow } from "@/workflows/goldenTrident";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { getTridentReadiness } from "@/lib/brokerage/trident/tridentReadiness";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;
  try {
    await requireBrokerageStaff();
  } catch (error) {
    const message = error instanceof Error ? error.message : "forbidden";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "unauthorized" ? 401 : 403 },
    );
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data: deal } = await sb
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .eq("bank_id", brokerageBankId)
    .maybeSingle();
  if (!deal) {
    return NextResponse.json({ ok: false, error: "deal_not_found_for_brokerage" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    mode?: "preview" | "final";
  };
  const mode = body.mode ?? "preview";

  if (mode === "final") {
    const readiness = await getTridentReadiness({ sb, dealId, bankId: brokerageBankId });
    if (!readiness.ok) {
      return NextResponse.json(
        { ok: false, error: "trident_not_ready", reasons: readiness.reasons, evidence: readiness.evidence },
        { status: 409 },
      );
    }
  }

  const created = await createTridentBundleRun({ dealId, mode });
  if (!created.ok) return NextResponse.json(created, { status: 500 });

  if (!created.reused) {
    try {
      const run = await start(goldenTridentWorkflow, [{
        dealId,
        mode,
        bundleId: created.bundleId,
      }]);
      const { error: runPersistError } = await sb.from("buddy_trident_bundles").update({
        workflow_run_id: run.runId,
        last_heartbeat_at: new Date().toISOString(),
      }).eq("id", created.bundleId);
      if (runPersistError) throw new Error(`Workflow identity persistence failed: ${runPersistError.message}`);
      return NextResponse.json(
        { ok: true, accepted: true, bundleId: created.bundleId, runId: run.runId },
        { status: 202 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await sb.from("buddy_trident_bundles").update({
        status: "failed",
        generation_error: `Workflow start failed: ${message}`,
        stage_error_json: { stage: "workflow_start", message },
        generation_completed_at: new Date().toISOString(),
      }).eq("id", created.bundleId);
      return NextResponse.json({ ok: false, bundleId: created.bundleId, error: message }, { status: 500 });
    }
  }

  return NextResponse.json(
    { ok: true, accepted: true, bundleId: created.bundleId, alreadyRunning: true },
    { status: 202 },
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;
  try {
    await requireBrokerageStaff();
  } catch (error) {
    const message = error instanceof Error ? error.message : "forbidden";
    return NextResponse.json({ ok: false, error: message }, { status: message === "unauthorized" ? 401 : 403 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const { data: bundle, error } = await sb
    .from("buddy_trident_bundles")
    .select("id,status,current_stage,workflow_run_id,generation_error,stage_error_json,generation_started_at,generation_completed_at,last_heartbeat_at,release_gate_json,business_plan_pdf_path,projections_pdf_path,projections_xlsx_path,feasibility_pdf_path")
    .eq("deal_id", dealId)
    .eq("bank_id", brokerageBankId)
    .eq("mode", "final")
    .order("generation_started_at", { ascending: false, nullsFirst: false })
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const { data: stages, error: stagesError } = bundle?.id
    ? await sb.from("buddy_trident_bundle_stages")
        .select("stage,status,attempt_count,output_json,error_json,started_at,completed_at,updated_at")
        .eq("bundle_id", bundle.id).order("started_at", { ascending: true })
    : { data: [], error: null };
  if (stagesError) return NextResponse.json({ ok: false, error: stagesError.message }, { status: 500 });
  return NextResponse.json({ ok: true, bundle, stages: stages ?? [] });
}
